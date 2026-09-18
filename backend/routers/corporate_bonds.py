"""Corporate Bond Research — Research → Corporate Bonds.

There's no free per-CUSIP bond pricing API (unlike yfinance for equities). The
two genuinely free, public sources used here:
  1. SEC N-PORT filings — funds must disclose every bond they hold (CUSIP,
     coupon, maturity, par balance, market value). We scan a curated list of
     large corporate bond ETFs (investment grade + high yield) for holdings
     matching a given issuer.
  2. SEC EDGAR full-text search — for issuers not currently held by any
     tracked fund, we fall back to their own 424B/FWP bond prospectuses
     (terms at issuance, not live pricing), and separately mine their own
     8-K/10-K/10-Q filings for credit-rating-action language (there is no
     free structured ratings-history API — NRSRO Rule 17g-7 disclosures only
     cover a rolling 12-24 month window and are not scriptable).
"""
import re
import logging
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from fastapi import APIRouter

from database import cache_get, cache_set
from edgar_utils import (
    _edgar_req, _edgar_filing_xml, _build_ticker_map, _lookup_ticker_by_name,
    _parse_nport_xml, _get_cik,
)
from routers.treasury import treasury_current

logger = logging.getLogger(__name__)
router = APIRouter()

_BOND_ETF_UNIVERSE = [
    ('LQD',  'iShares iBoxx $ Investment Grade Corporate Bond ETF', 'IG'),
    ('VCIT', 'Vanguard Intermediate-Term Corporate Bond ETF',       'IG'),
    ('VCSH', 'Vanguard Short-Term Corporate Bond ETF',              'IG'),
    ('USIG', 'iShares Broad USD Investment Grade Corporate Bond ETF', 'IG'),
    ('HYG',  'iShares iBoxx $ High Yield Corporate Bond ETF',       'HY'),
    ('JNK',  'SPDR Bloomberg High Yield Bond ETF',                  'HY'),
    ('USHY', 'iShares Broad USD High Yield Corporate Bond ETF',     'HY'),
]

_MF_TICKERMAP_TTL   = timedelta(days=7)
_BOND_FUND_TTL      = timedelta(hours=24)
_BOND_SEARCH_TTL    = timedelta(hours=6)
_BOND_PROSPECTUS_TTL = timedelta(hours=24)
_BOND_RATINGS_TTL   = timedelta(hours=24)


def _load_mf_ticker_map() -> dict:
    """Ticker → (cik, seriesId) for mutual funds/ETFs, from SEC's bulk reference file.

    This is the only free way to resolve an ETF ticker like LQD to the specific
    fund series it needs, since many ETFs share one filer CIK with hundreds of
    sibling funds under the same trust (e.g. all iShares funds file under CIK
    1100663) — the series ID is what lets us pull just that one fund's filings.
    """
    cache_key = 'mf_ticker_map'
    cached = cache_get(cache_key, _MF_TICKERMAP_TTL)
    if cached:
        return cached
    try:
        data = _edgar_req('https://www.sec.gov/files/company_tickers_mf.json', timeout=60).json()
        rows = data.get('data', [])
        m = {}
        for cik, series_id, _class_id, symbol in rows:
            m[str(symbol).upper()] = [str(cik), series_id]
        cache_set(cache_key, m)
        return m
    except Exception as exc:
        logger.warning('mf ticker map: %s', exc)
        return {}


def _series_latest_nport(series_id: str):
    """Latest (accession, filingDate) for one fund series, scoped via EDGAR's series filter."""
    try:
        url = (
            f"https://www.sec.gov/cgi-bin/browse-edgar?CIK={series_id}&action=getcompany"
            f"&owner=include&scd=filings&count=5&type=NPORT-P&output=atom"
        )
        text = _edgar_req(url, timeout=30).text
        acc_m  = re.search(r'<accession-number>([\d-]+)</accession-number>', text)
        date_m = re.search(r'<filing-date>([\d-]+)</filing-date>', text)
        if not acc_m:
            return None
        return acc_m.group(1), (date_m.group(1) if date_m else None)
    except Exception as exc:
        logger.warning('series nport lookup %s: %s', series_id, exc)
        return None


def _fetch_bond_fund_holdings(fund_ticker: str) -> list[dict]:
    """Debt holdings for one bond ETF, from its latest N-PORT filing. Cached 24h."""
    cache_key = f'bond_fund:{fund_ticker}'
    cached = cache_get(cache_key, _BOND_FUND_TTL)
    if cached is not None:
        return cached

    holdings: list[dict] = []
    try:
        mf_map = _load_mf_ticker_map()
        entry = mf_map.get(fund_ticker.upper())
        if not entry:
            cache_set(cache_key, [])
            return []
        cik, series_id = entry

        latest = _series_latest_nport(series_id)
        if not latest:
            cache_set(cache_key, [])
            return []
        accession, period = latest

        xml_text = _edgar_filing_xml(cik, accession)
        if not xml_text:
            cache_set(cache_key, [])
            return []

        _, parsed = _parse_nport_xml(xml_text, {})
        for h in parsed:
            if h.get('assetCat') != 'Debt' or h.get('maturityDate') is None:
                continue
            holdings.append({
                'cusip':        h.get('cusip'),
                'isin':         h.get('isin'),
                'issuerName':   h.get('name'),
                'couponRate':   h.get('couponRate'),
                'couponType':   h.get('couponType'),
                'maturityDate': h.get('maturityDate'),
                'balance':      h.get('balance'),
                'marketValue':  h.get('fairValue'),
                'weight':       h.get('weight'),
                'isDefault':    h.get('isDefault'),
                'country':      h.get('country'),
                'period':       period,
            })
    except Exception as exc:
        logger.warning('bond fund holdings %s: %s', fund_ticker, exc)

    cache_set(cache_key, holdings)
    return holdings


def _bond_price_per_100(h: dict):
    """Approximate clean price per $100 par, from N-PORT market value ÷ par balance."""
    bal = h.get('balance')
    val = h.get('marketValue')
    if not bal or not val:
        return None
    return round(val / bal * 100, 2)


def _bond_price_from_ytm(ytm_pct: float, coupon_pct: float, n_periods: int, face: float = 100.0) -> float:
    y = ytm_pct / 200  # per-period rate from an annualized %, semiannual compounding
    c = coupon_pct / 200 * face  # coupon cash flow per period
    pv = sum(c / (1 + y) ** t for t in range(1, n_periods + 1))
    pv += face / (1 + y) ** n_periods
    return pv


def _bond_ytm(price: float, coupon_pct: float, years: float, face: float = 100.0) -> float | None:
    """Approximate annualized yield-to-maturity (semiannual compounding) via
    bisection on the searched credit-spread page. Uses the same approximate
    clean price (N-PORT market value ÷ par) already shown elsewhere on this
    page, with no accrued-interest adjustment — a real bond math engine would
    need settlement-date accrued interest, but that's not available here."""
    if not price or not years or years <= 0 or coupon_pct is None:
        return None
    n = max(1, round(years * 2))
    lo, hi = -10.0, 50.0
    try:
        f_lo = _bond_price_from_ytm(lo, coupon_pct, n, face) - price
        f_hi = _bond_price_from_ytm(hi, coupon_pct, n, face) - price
    except (OverflowError, ZeroDivisionError):
        return None
    if f_lo * f_hi > 0:
        return None  # price not representable for this coupon/maturity in [-10%, 50%]
    for _ in range(60):
        mid = (lo + hi) / 2
        f_mid = _bond_price_from_ytm(mid, coupon_pct, n, face) - price
        if abs(f_mid) < 1e-5:
            return round(mid, 4)
        if (f_lo < 0) == (f_mid < 0):
            lo, f_lo = mid, f_mid
        else:
            hi = mid
    return round((lo + hi) / 2, 4)


def _interpolate_treasury_yield(years: float, treasury_rates: list[dict]) -> float | None:
    """Linear interpolation of the current Treasury par curve at an arbitrary
    maturity in years, for computing a credit spread vs. the nearest point on
    the government curve rather than only the 14 published tenors."""
    pts = sorted((r for r in treasury_rates if r.get('yield') is not None), key=lambda r: r['years'])
    if not pts:
        return None
    if years <= pts[0]['years']:
        return pts[0]['yield']
    if years >= pts[-1]['years']:
        return pts[-1]['yield']
    for a, b in zip(pts, pts[1:]):
        if a['years'] <= years <= b['years']:
            frac = (years - a['years']) / (b['years'] - a['years'])
            return round(a['yield'] + frac * (b['yield'] - a['yield']), 4)
    return None


@router.get('/api/bonds/search')
def bonds_search(q: str):
    """Search for an issuer's corporate bonds across major IG/HY bond ETF holdings,
    falling back to SEC prospectus filings for issuers no tracked fund currently holds."""
    q = q.strip()
    if not q:
        return {'query': q, 'bonds': [], 'source': None}

    cache_key = f'bond_search:{q.lower()}'
    cached = cache_get(cache_key, _BOND_SEARCH_TTL)
    if cached is not None:
        return cached

    # Build match terms. A short ticker-shaped query (e.g. "BA") is useless as a raw
    # substring against issuer names — resolve it to the registered company name first
    # and match on that instead; only use the raw query directly when it already looks
    # like a company name (longer, or contains a space).
    ticker_map = _build_ticker_map()
    looks_like_ticker = q.isalpha() and len(q) <= 5
    resolved_name = None
    if looks_like_ticker:
        for name, ticker in ticker_map.items():
            if ticker == q.upper():
                resolved_name = name
                break

    needles: set[str] = set()
    if resolved_name:
        needles.add(resolved_name.split(' ')[0])  # first word of registered name, e.g. "BOEING"
    elif not looks_like_ticker:
        needles.add(q.upper())

    # Resolve a ticker for the prospectus fallback (used only if no fund holds this issuer)
    ticker_for_prospectus = q.upper() if looks_like_ticker else _lookup_ticker_by_name(q, ticker_map)

    with ThreadPoolExecutor(max_workers=len(_BOND_ETF_UNIVERSE)) as pool:
        futures = {pool.submit(_fetch_bond_fund_holdings, sym): (sym, grade)
                   for sym, _label, grade in _BOND_ETF_UNIVERSE}
        fund_results = {}
        for fut in as_completed(futures):
            sym, grade = futures[fut]
            try:
                fund_results[sym] = (grade, fut.result())
            except Exception:
                fund_results[sym] = (grade, [])

    needle_res = [re.compile(r'\b' + re.escape(n) + r'\b') for n in needles]

    def _matches(name: str) -> bool:
        if not name:
            return False
        name_u = name.upper()
        return any(r.search(name_u) for r in needle_res)

    by_cusip: dict[str, dict] = {}
    for fund_ticker, (grade, holdings) in fund_results.items():
        for h in holdings:
            if not _matches(h.get('issuerName')):
                continue
            cusip = h.get('cusip') or f"{fund_ticker}:{h.get('issuerName')}:{h.get('maturityDate')}"
            bond = by_cusip.setdefault(cusip, {
                'cusip':        h.get('cusip'),
                'isin':         h.get('isin'),
                'issuerName':   h.get('issuerName'),
                'couponRate':   h.get('couponRate'),
                'couponType':   h.get('couponType'),
                'maturityDate': h.get('maturityDate'),
                'isDefault':    h.get('isDefault'),
                'grades':       set(),
                'heldBy':       [],
                'source':       'fund',
            })
            bond['grades'].add(grade)
            bond['heldBy'].append({
                'fund':        fund_ticker,
                'weight':      h.get('weight'),
                'marketValue': h.get('marketValue'),
                'price':       _bond_price_per_100(h),
            })

    bonds = []
    for bond in by_cusip.values():
        bond['grades'] = sorted(bond['grades'])
        bond['heldBy'].sort(key=lambda x: -(x.get('marketValue') or 0))
        bonds.append(bond)
    bonds.sort(key=lambda b: (b.get('maturityDate') or '9999'))

    source = 'fund' if bonds else None

    # Fallback: no fund currently holds this issuer's bonds — try prospectus filings
    if not bonds and ticker_for_prospectus:
        prospectus_bonds = _search_bond_prospectus(ticker_for_prospectus)
        if prospectus_bonds:
            bonds = prospectus_bonds
            source = 'prospectus'

    # Credit spread vs. the current Treasury curve — only for fund-held bonds,
    # since computing YTM needs a live price (prospectus-only bonds have none).
    treasury_rates = treasury_current().get('rates', [])
    today = datetime.utcnow().date()
    for bond in bonds:
        if bond.get('source') != 'fund' or not bond.get('heldBy'):
            continue
        price = bond['heldBy'][0].get('price')
        coupon = bond.get('couponRate')
        maturity = bond.get('maturityDate')
        if price is None or coupon is None or not maturity:
            continue
        try:
            years = (datetime.strptime(maturity, '%Y-%m-%d').date() - today).days / 365.25
        except ValueError:
            continue
        ytm = _bond_ytm(price, coupon, years)
        if ytm is None:
            continue
        treasury_yield = _interpolate_treasury_yield(years, treasury_rates)
        bond['ytm'] = ytm
        bond['treasuryYield'] = treasury_yield
        bond['spreadBps'] = round((ytm - treasury_yield) * 100) if treasury_yield is not None else None

    result = {
        'query':          q,
        'bonds':          bonds[:40],
        'source':         source,
        'resolvedTicker': ticker_for_prospectus,
        'treasuryCurve':  [{'years': r['years'], 'label': r['label'], 'yield': r['yield']} for r in treasury_rates],
    }
    cache_set(cache_key, result)
    return result


_COUPON_RE = re.compile(
    r'(\d+(?:\.\d{2,4})?)\s*%\s+([A-Za-z][A-Za-z \-]{0,30}?Notes|[A-Za-z][A-Za-z \-]{0,30}?Bonds|[A-Za-z][A-Za-z \-]{0,30}?Debentures)\s+due\s+(20\d{2}|19\d{2})',
    re.IGNORECASE,
)


def _search_bond_prospectus(ticker: str, require_convertible: bool = False) -> list[dict]:
    """Best-effort bond terms mined from an issuer's own SEC prospectus filings
    (424B2/424B3/424B5/FWP). These are terms AT ISSUANCE, not live pricing —
    used only when no tracked fund currently holds the issuer's bonds.

    require_convertible=True keeps only matches whose note-type phrase (the
    text between "X.XX%" and "due YYYY", e.g. "Convertible Senior Notes")
    mentions "convertible" — used by the Convertible Bonds search so it
    doesn't surface an issuer's plain, non-convertible debt."""
    cik = _get_cik(ticker)
    if not cik:
        return []
    q = ticker
    # Bias toward filings from the last ~12 years — most bonds issued before that
    # have already matured, and a matured bond isn't useful for research purposes.
    startdt = (datetime.utcnow() - timedelta(days=365 * 12)).strftime('%Y-%m-%d')
    enddt = datetime.utcnow().strftime('%Y-%m-%d')
    try:
        url = (
            "https://efts.sec.gov/LATEST/search-index"
            f"?q=%22notes+due%22&forms=424B2,424B3,424B5,FWP&ciks={cik}"
            f"&dateRange=custom&startdt={startdt}&enddt={enddt}"
        )
        resp = _edgar_req(url, timeout=30).json()
        hits = resp.get('hits', {}).get('hits', [])[:15]
    except Exception as exc:
        logger.warning('bond prospectus search %s: %s', q, exc)
        return []

    def _fetch_terms(hit):
        src = hit.get('_source', {})
        hit_id = hit.get('_id', '')
        if ':' not in hit_id:
            return None
        acc, filename = hit_id.split(':', 1)
        if not filename.lower().endswith(('.htm', '.html')):
            return None  # skip PDFs/txt from older filings — not worth parsing
        cik_i = int(cik)
        acc_nodash = acc.replace('-', '')
        try:
            doc_url = f"https://www.sec.gov/Archives/edgar/data/{cik_i}/{acc_nodash}/{filename}"
            text = _edgar_req(doc_url, timeout=30).text
            text_plain = re.sub(r'<[^>]+>', ' ', text[:200_000])
            text_plain = re.sub(r'&nbsp;|&#160;', ' ', text_plain)
            m = _COUPON_RE.search(text_plain)
            if not m:
                return None
            coupon, kind, year = m.groups()
            if require_convertible and 'convertible' not in kind.lower():
                return None
            display = (src.get('display_names') or [q])[0]
            issuer_name = display.split('  (')[0].strip() if display else q
            return {
                'cusip':        None,
                'isin':         None,
                'issuerName':   issuer_name,
                'couponRate':   float(coupon),
                'couponType':   'Fixed',
                'maturityDate': f"{year}-01-01",
                'isDefault':    None,
                'grades':       [],
                'heldBy':       [],
                'source':       'prospectus',
                'filingDate':   src.get('file_date'),
                'filingUrl':    doc_url,
                'noteType':     kind.strip(),
            }
        except Exception:
            return None

    bonds = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        futs = [pool.submit(_fetch_terms, h) for h in hits]
        for f in as_completed(futs):
            r = f.result()
            if r:
                bonds.append(r)

    # Drop bonds that have already matured — regex only recovers the maturity year,
    # so treat anything maturing this year or earlier as no longer outstanding.
    this_year = datetime.utcnow().year
    bonds = [b for b in bonds if int(b['maturityDate'][:4]) > this_year]

    # De-dupe by (coupon, maturity year) — the same bond is often referenced in multiple filings
    seen = set()
    unique = []
    for b in bonds:
        key = (b['couponRate'], b['maturityDate'])
        if key in seen:
            continue
        seen.add(key)
        unique.append(b)
    unique.sort(key=lambda b: b.get('maturityDate') or '9999')
    return unique


_RATING_SEARCH_PHRASES = ('downgraded', 'upgraded', 'credit rating agency', 'rating action')

# A sentence mentioning "upgraded" alone is meaningless noise (could be "upgraded our
# systems"); require it to also name a rating agency before treating it as a real
# rating-action excerpt.
_AGENCY_RE = re.compile(r"Moody'?s|S&P(?:\s+Global)?(?:\s+Ratings)?|Fitch(?:\s+Ratings)?|DBRS|Egan-Jones|Kroll", re.I)
_ACTION_RE = re.compile(r'downgrad|upgrad|affirm|placed on (?:credit)?watch|rating action', re.I)


def _find_rating_excerpt(text_plain: str) -> str | None:
    sentences = re.split(r'(?<=[.!?])\s+', text_plain)
    for s in sentences:
        if _AGENCY_RE.search(s) and _ACTION_RE.search(s):
            return s.strip()[:400]
    for s in sentences:
        if _AGENCY_RE.search(s) and 'rating' in s.lower():
            return s.strip()[:400]
    return None


@router.get('/api/bonds/ratings-mentions/{ticker}')
def bond_ratings_mentions(ticker: str):
    """Credit-rating-action mentions pulled from the issuer's own SEC filings.

    There's no free structured multi-year ratings-history API — S&P/Moody's/Fitch's
    Rule 17g-7 disclosures only cover a rolling 12-24 month window and aren't
    reliably scriptable. This instead full-text-searches the company's own 8-K/
    10-K/10-Q filings for rating-action language, which by regulation companies
    disclose when material — giving a real (if incomplete) multi-year timeline."""
    ticker = ticker.upper().strip()
    cache_key = f'bond_ratings_mentions:{ticker}'
    cached = cache_get(cache_key, _BOND_RATINGS_TTL)
    if cached is not None:
        return cached

    cik = _get_cik(ticker)
    if not cik:
        result = {'ticker': ticker, 'mentions': []}
        cache_set(cache_key, result)
        return result

    hits_by_acc: dict[str, dict] = {}
    for phrase in _RATING_SEARCH_PHRASES:
        try:
            url = (
                "https://efts.sec.gov/LATEST/search-index"
                f"?q=%22{phrase.replace(' ', '+')}%22&forms=8-K,10-K,10-Q&ciks={cik}"
            )
            resp = _edgar_req(url, timeout=30).json()
            for h in resp.get('hits', {}).get('hits', [])[:15]:
                hits_by_acc[h.get('_id', '')] = h
        except Exception as exc:
            logger.warning('ratings mentions search %s/%s: %s', ticker, phrase, exc)

    ranked = sorted(hits_by_acc.values(), key=lambda h: h.get('_source', {}).get('file_date', ''), reverse=True)[:12]

    def _extract_excerpt(hit):
        src = hit.get('_source', {})
        hit_id = hit.get('_id', '')
        if ':' not in hit_id:
            return None
        acc, filename = hit_id.split(':', 1)
        if not filename.lower().endswith(('.htm', '.html')):
            return None  # skip PDFs/txt from older filings — not worth parsing
        cik_i = int(cik)
        acc_nodash = acc.replace('-', '')
        doc_url = f"https://www.sec.gov/Archives/edgar/data/{cik_i}/{acc_nodash}/{filename}"
        try:
            text = _edgar_req(doc_url, timeout=30).text
            text_plain = re.sub(r'<[^>]+>', ' ', text[:300_000])
            text_plain = re.sub(r'&#\d+;|&\w+;', ' ', text_plain)
            text_plain = re.sub(r'\s+', ' ', text_plain)
            excerpt = _find_rating_excerpt(text_plain)
            if not excerpt:
                return None
            return {
                'formType':   src.get('form_type') or src.get('root_forms', [''])[0],
                'filingDate': src.get('file_date'),
                'filingUrl':  doc_url,
                'excerpt':    excerpt,
            }
        except Exception:
            return None

    mentions = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        futs = [pool.submit(_extract_excerpt, h) for h in ranked]
        for f in as_completed(futs):
            r = f.result()
            if r:
                mentions.append(r)
    mentions.sort(key=lambda m: m.get('filingDate') or '', reverse=True)

    result = {'ticker': ticker, 'mentions': mentions}
    cache_set(cache_key, result)
    return result
