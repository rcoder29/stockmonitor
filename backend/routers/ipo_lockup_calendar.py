"""IPO & Lockup Calendar — Markets -> IPO & Lockups.

Live EDGAR-sourced (424B4 = priced IPOs with a lockup-expiration
countdown; S-1 = pre-pricing pipeline). SPACs excluded — they have their
own Discovery feed.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
import logging
import pandas as pd
import yfinance as yf
from fastapi import APIRouter

from database import cache_get, cache_set
from edgar_utils import _edgar_req, _TICKER_RE, _safe_float, _finite_or_none

logger = logging.getLogger(__name__)
router = APIRouter()

# ── IPO & Lockup Calendar ─────────────────────────────────────────────────────
#
# Live EDGAR-sourced (previously a hand-maintained static list, which meant it
# silently went stale). 424B4 = final prospectus filed at pricing -> feeds the
# lockup tracker below. S-1 = registration filed pre-pricing -> the "not yet
# priced" pipeline in ipo_pipeline(). SPACs are excluded (SIC 6770 / name
# pattern) since they're covered by their own Discovery feed.

_IPO_TTL = timedelta(hours=1)
_LOCKUP_DAYS = 180  # standard underwriting lockup; not disclosed in EDGAR full-text search metadata

_SIC_SECTOR_RANGES = (
    (2800, 2836, 'Healthcare / Biotech'), (8000, 8099, 'Healthcare / Biotech'),
    (3570, 3579, 'Technology'), (3600, 3699, 'Technology'), (7370, 7379, 'Technology'),
    (6000, 6299, 'Financials'), (6300, 6499, 'Insurance'), (6500, 6599, 'Real Estate'),
    (4800, 4899, 'Communications / Media'), (4900, 4999, 'Utilities'),
    (1000, 1499, 'Energy / Mining'), (2900, 2999, 'Energy / Mining'),
    (4000, 4799, 'Transportation'),
    (2000, 2799, 'Consumer'), (5000, 5999, 'Consumer'),
    (3000, 3999, 'Industrials'),
)


def _sic_to_sector(sic: str | None) -> str:
    try:
        code = int(sic)
    except (TypeError, ValueError):
        return 'Other'
    for lo, hi, label in _SIC_SECTOR_RANGES:
        if lo <= code <= hi:
            return label
    return 'Other'


def _is_likely_spac(name: str, sic: str | None) -> bool:
    if sic == '6770':
        return True
    n = (name or '').upper()
    return 'ACQUISITION CORP' in n or 'ACQUISITION CO' in n or 'BLANK CHECK' in n


def _edgar_ipo_scan(form: str, days_back: int) -> list[dict]:
    from datetime import date as _date
    today_str = _date.today().strftime('%Y-%m-%d')
    cutoff = (_date.today() - pd.Timedelta(days=days_back)).strftime('%Y-%m-%d')
    out = []
    try:
        url = (
            f"https://efts.sec.gov/LATEST/search-index"
            f"?q=&forms={form}&dateRange=custom&startdt={cutoff}&enddt={today_str}"
        )
        resp = _edgar_req(url).json()
        for h in resp.get('hits', {}).get('hits', [])[:100]:
            src = h.get('_source', {})
            display = (src.get('display_names') or [''])[0]
            sic = (src.get('sics') or [None])[0]
            m = _TICKER_RE.search(display)
            ticker = m.group(1).split(',')[0].strip() if m else None
            name = display.split('  (')[0].strip() if display else src.get('entity_name', '')
            if _is_likely_spac(name, sic):
                continue
            out.append({
                'accession': src.get('adsh') or h.get('_id', '').split(':')[0],
                'ticker':    ticker,
                'company':   name,
                'sector':    _sic_to_sector(sic),
                'fileDate':  src.get('file_date', ''),
                'cik':       (src.get('ciks') or [''])[0],
                'formType':  src.get('form', form),
            })
    except Exception as exc:
        logger.warning('ipo scan %s: %s', form, exc)
    return out


def _fetch_ipo_reference_price(ticker: str, ipo_date: str) -> dict:
    """First trading day's open (proxy for offer price) plus current price."""
    try:
        t = yf.Ticker(ticker)
        start = datetime.strptime(ipo_date, '%Y-%m-%d').date()
        hist = t.history(start=start.isoformat(), end=(start + timedelta(days=10)).isoformat())
        if hist.empty:
            return {}
        ref_price = _finite_or_none(round(float(hist['Open'].iloc[0]), 2))
        current = yf.Ticker(ticker).fast_info
        current_price = _finite_or_none(_safe_float(getattr(current, 'last_price', None)))
        return {'ipoPrice': ref_price, 'currentPrice': current_price}
    except Exception:
        return {}


@router.get("/api/market/ipo-calendar")
def ipo_calendar():
    """Recently-priced IPOs (from 424B4 filings) with a live lockup-expiration
    countdown. ipoPrice is the first trading day's open (a proxy -- the actual
    underwriting offer price isn't in EDGAR's full-text search metadata)."""
    cache_key = "market:ipo-calendar:v2"
    cached = cache_get(cache_key, _IPO_TTL)
    if cached is not None:
        return cached

    today = datetime.utcnow().date()
    # Look back far enough to still catch lockups expiring soon after pricing this long ago.
    filings = [f for f in _edgar_ipo_scan('424B4', days_back=_LOCKUP_DAYS + 45) if f['ticker']]

    tickers = sorted({f['ticker'] for f in filings})
    quotes = {}
    if tickers:
        with ThreadPoolExecutor(max_workers=min(len(tickers), 10)) as pool:
            futures = {pool.submit(_fetch_ipo_reference_price, f['ticker'], f['fileDate']): f['ticker'] for f in filings}
            for fut in as_completed(futures):
                t = futures[fut]
                try:
                    quotes[t] = fut.result()
                except Exception:
                    pass

    results = []
    for f in filings:
        q = quotes.get(f['ticker'], {})
        ipo_price = q.get('ipoPrice')
        current_price = q.get('currentPrice')
        if ipo_price is None or current_price is None:
            continue  # can't build a meaningful row without a price anchor
        ipo_date = datetime.strptime(f['fileDate'], '%Y-%m-%d').date()
        lockup_date = ipo_date + timedelta(days=_LOCKUP_DAYS)
        days_to_lockup = (lockup_date - today).days
        perf_pct = round((current_price - ipo_price) / ipo_price * 100, 1) if ipo_price else None

        results.append({
            "symbol":        f['ticker'],
            "company":       f['company'],
            "sector":        f['sector'],
            "ipoDate":       f['fileDate'],
            "ipoPrice":      ipo_price,
            "currentPrice":  current_price,
            "perfPct":       perf_pct,
            "lockupDate":    lockup_date.isoformat(),
            "daysSinceIpo":  (today - ipo_date).days,
            "daysToLockup":  days_to_lockup,
            "lockupExpired": days_to_lockup < 0,
        })

    results.sort(key=lambda x: x["daysToLockup"] if x["daysToLockup"] >= 0 else 999999)
    cache_set(cache_key, results)
    return results


@router.get("/api/market/ipo-pipeline")
def ipo_pipeline():
    """Companies that have filed to go public (S-1) but haven't priced yet --
    the forward-looking counterpart to the lockup tracker above."""
    cache_key = "market:ipo-pipeline"
    cached = cache_get(cache_key, _IPO_TTL)
    if cached is not None:
        return cached

    filings = _edgar_ipo_scan('S-1', days_back=60)
    # Dedupe by CIK, keeping the most recent filing (S-1/A amendments common).
    by_cik = {}
    for f in filings:
        cik = f['cik']
        if cik not in by_cik or f['fileDate'] > by_cik[cik]['fileDate']:
            by_cik[cik] = f
    results = sorted(by_cik.values(), key=lambda f: f['fileDate'], reverse=True)

    for r in results:
        r['edgarUrl'] = f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&filenum=&State=0&SIC=&dateb=&owner=include&count=1&search_text=&accession={r['accession'].replace('-', '')}"

    cache_set(cache_key, results)
    return results


