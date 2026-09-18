"""EDGAR Fund Holdings Explorer — Research → Fund Holdings.

Pulls official portfolio holdings directly from SEC EDGAR N-PORT filings — the
mandatory monthly disclosure all registered ETFs and mutual funds submit to
the SEC.
"""
import re
import logging
from datetime import timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from fastapi import APIRouter, HTTPException
import yfinance as yf

from database import cache_get, cache_set
from edgar_utils import _edgar_req, _safe_float, _build_ticker_map, _parse_nport_xml, _edgar_filing_xml

logger = logging.getLogger(__name__)
router = APIRouter()

_EDGAR_SEARCH_TTL   = timedelta(hours=12)
_EDGAR_HOLDINGS_TTL = timedelta(hours=6)

# Filing types used by EDGAR for monthly portfolio reports (no hyphen variant is current)
_NPORT_FORMS = {'NPORT-P', 'N-PORT-P', 'NPORT-P/A', 'N-PORT-P/A', 'N-PORT', 'NPORT'}

_POPULAR_FUNDS = [
    {'ticker': 'SPY',  'name': 'SPDR S&P 500 ETF Trust',          'cik': '884394'},
    {'ticker': 'QQQ',  'name': 'Invesco QQQ Trust',                'cik': '1067839'},
    {'ticker': 'IVV',  'name': 'iShares Core S&P 500 ETF',         'cik': '1100663'},
    {'ticker': 'VTI',  'name': 'Vanguard Total Stock Market ETF',  'cik': '1075817'},
    {'ticker': 'ARKK', 'name': 'ARK Innovation ETF',               'cik': '1579982'},
    {'ticker': 'XLK',  'name': 'Technology Select Sector SPDR',    'cik': '1064642'},
    {'ticker': 'XLF',  'name': 'Financial Select Sector SPDR',     'cik': '1064641'},
    {'ticker': 'IWM',  'name': 'iShares Russell 2000 ETF',         'cik': '1100624'},
    {'ticker': 'GLD',  'name': 'SPDR Gold Shares',                 'cik': '1222333'},
    {'ticker': 'VOO',  'name': 'Vanguard S&P 500 ETF',             'cik': '1479240'},
]


# ── EDGAR fund search ─────────────────────────────────────────────────────────

def _edgar_search_funds(query: str) -> list[dict]:
    cache_key = f"edgar_search:{query.lower().strip()}"
    cached = cache_get(cache_key, _EDGAR_SEARCH_TTL)
    if cached:
        return cached

    results: list[dict] = []
    seen: set[str] = set()
    q = query.strip()

    try:
        # 1) Try direct CIK/ticker search — works for known tickers like SPY, QQQ
        url_cik = (
            f"https://www.sec.gov/cgi-bin/browse-edgar"
            f"?company=&CIK={q}&type=NPORT-P&dateb=&owner=include&count=10"
            f"&search_text=&action=getcompany"
        )
        html_cik = _edgar_req(url_cik).text

        # When EDGAR finds one exact match it shows company details (no table row), extract CIK
        single = re.search(
            r'CIK[#\s]*:.*?CIK=0*(\d+)[^"]*">0*(\d+)\s*\(see all',
            html_cik, re.IGNORECASE | re.DOTALL
        )
        if single:
            cik = single.group(1)
            name_m = re.search(r'<span class="companyName">([^<]+)', html_cik)
            name = name_m.group(1).strip() if name_m else q.upper()
            # Strip the CIK# suffix that EDGAR appends
            name = re.sub(r'\s*CIK.*', '', name).strip()
            if cik not in seen:
                seen.add(cik)
                results.append({'cik': cik, 'name': name})
        else:
            # Multiple results in tableFile2
            rows = re.findall(
                r'CIK=0*(\d+)[^"]*">\s*0*\1\s*</a>\s*</td>\s*<td[^>]*>\s*<a[^>]+>([^<]+)</a>',
                html_cik, re.IGNORECASE
            )
            for cik, name in rows[:8]:
                if cik not in seen:
                    seen.add(cik)
                    results.append({'cik': cik, 'name': name.strip()})

        # 2) Company name search (catches fund families like "iShares", "Vanguard")
        if not results or len(results) < 3:
            url_name = (
                f"https://www.sec.gov/cgi-bin/browse-edgar"
                f"?company={q.replace(' ', '+')}&CIK=&type=NPORT-P&dateb=&owner=include&count=15"
                f"&search_text=&action=getcompany"
            )
            html_name = _edgar_req(url_name).text
            rows2 = re.findall(
                r'CIK=0*(\d+)[^"]*">\s*0*\1\s*</a>\s*</td>\s*<td[^>]*>\s*<a[^>]+>([^<]+)</a>',
                html_name, re.IGNORECASE
            )
            for cik, name in rows2[:10]:
                if cik not in seen:
                    seen.add(cik)
                    results.append({'cik': cik, 'name': name.strip()})

    except Exception as exc:
        logger.warning('edgar fund search %s: %s', q, exc)

    cache_set(cache_key, results[:15])
    return results[:15]


# ── Latest N-PORT filing ──────────────────────────────────────────────────────

def _edgar_latest_nport(cik: str):
    """Return (accession, period, entity_name) for the latest NPORT-P filing."""
    try:
        padded = cik.zfill(10)
        data = _edgar_req(f"https://data.sec.gov/submissions/CIK{padded}.json").json()
        entity_name = data.get('name', '')

        filings = data.get('filings', {}).get('recent', {})
        forms   = filings.get('form', [])
        accnums = filings.get('accessionNumber', [])
        periods = filings.get('reportDate', [])
        dates   = filings.get('filingDate', [])

        for i, form in enumerate(forms):
            if form.upper() in _NPORT_FORMS:
                acc    = accnums[i] if i < len(accnums) else ''
                period = (periods[i] if i < len(periods) and periods[i]
                          else dates[i][:10] if i < len(dates) else '')
                return acc, period, entity_name
        return None
    except Exception as exc:
        logger.warning('edgar submissions %s: %s', cik, exc)
        return None


# _edgar_filing_xml / _parse_nport_xml live in edgar_utils.py (imported above)
# — shared with Corporate/Convertible Bond Research's fund-holdings fetchers.


def _enrich_edgar_holding(h: dict) -> None:
    ticker = (h.get('ticker') or '').strip().upper()
    if not ticker or len(ticker) > 6 or not ticker.replace('.', '').isalpha():
        return
    try:
        t  = yf.Ticker(ticker)
        fi = t.fast_info
        price   = _safe_float(getattr(fi, 'last_price', None))
        high52w = _safe_float(getattr(fi, 'year_high', None))
        low52w  = _safe_float(getattr(fi, 'year_low', None))
        if not price:
            return
        h['price']   = round(price, 2)
        h['high52w'] = round(high52w, 2) if high52w else None
        h['low52w']  = round(low52w,  2) if low52w  else None
        if high52w and price:
            h['pctFromHigh'] = round((price / high52w - 1) * 100, 1)
        hist = t.history(period='1y')
        if hist.empty:
            return
        hist.index = hist.index.tz_localize(None) if hist.index.tzinfo else hist.index
        closes = hist['Close'].dropna()
        n = len(closes)
        def _ret(days: int):
            idx = max(0, n - days - 1)
            ref = float(closes.iloc[idx])
            return round((price / ref - 1) * 100, 1) if ref else None
        h['perf1m'] = _ret(21)
        h['perf3m'] = _ret(63)
        h['perf6m'] = _ret(126)
        h['perf1y'] = _ret(252)
    except Exception:
        pass


@router.get('/api/edgar/fund-search')
def edgar_fund_search(q: str = ''):
    if not q.strip():
        return []
    return _edgar_search_funds(q.strip())


@router.get('/api/edgar/fund-holdings')
def edgar_fund_holdings(cik: str, enrich: int = 50):
    cache_key = f"edgar_holdings2:{cik}:{enrich}"
    cached = cache_get(cache_key, _EDGAR_HOLDINGS_TTL)
    if cached:
        return cached

    nport = _edgar_latest_nport(cik)
    if not nport:
        raise HTTPException(404, 'No NPORT-P filing found for this CIK')

    accession, period, entity_name = nport
    xml_text = _edgar_filing_xml(cik, accession)
    if not xml_text:
        raise HTTPException(502, 'Could not retrieve N-PORT XML from EDGAR')

    # Build name→ticker map once (cached 24h)
    ticker_map = _build_ticker_map()

    fund_info, holdings = _parse_nport_xml(xml_text, ticker_map)
    if not fund_info.get('period'):
        fund_info['period'] = period
    if not fund_info.get('seriesName'):
        fund_info['seriesName'] = entity_name

    # Enrich top N holdings that resolved a ticker
    to_enrich = [h for h in holdings if h.get('ticker')][:max(1, enrich)]
    with ThreadPoolExecutor(max_workers=10) as pool:
        futs = [pool.submit(_enrich_edgar_holding, h) for h in to_enrich]
        for f in as_completed(futs):
            f.result()

    result = {
        'fund':         fund_info,
        'cik':          cik,
        'accession':    accession,
        'holdings':     holdings,
        'holdingCount': len(holdings),
    }
    cache_set(cache_key, result)
    return result


@router.get('/api/edgar/popular-funds')
def edgar_popular_funds():
    return _POPULAR_FUNDS


