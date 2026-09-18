"""Convertible Bond Research — Research → Convertible Bonds.

Same "search an issuer's bonds" pattern as Corporate Bonds, but for
convertible debt, which needs a third data source on top of the two reused
from Corporate Bonds (N-PORT fund holdings, prospectus fallback):
  3. SEC XBRL company facts — conversion economics (conversion price/ratio,
     call-trigger thresholds, if-converted value) are a defined part of the
     US-GAAP taxonomy (unlike credit ratings, which aren't), so an issuer
     that tagged them exposes real structured terms for free. Coverage is
     inconsistent — many issuers only tag the balance-sheet carrying value,
     not the conversion terms — so this is shown as best-effort, sourced
     straight from each concept's originating filing.
"""
import re
import logging
from datetime import timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from fastapi import APIRouter

from database import cache_get, cache_set
from edgar_utils import _edgar_req, _build_ticker_map, _lookup_ticker_by_name, _get_cik
from routers.corporate_bonds import (
    _fetch_bond_fund_holdings, _bond_price_per_100, _search_bond_prospectus,
)

logger = logging.getLogger(__name__)
router = APIRouter()

_CONVERT_ETF_UNIVERSE = [
    ('ICVT', 'iShares Convertible Bond ETF'),
    ('CWB',  'SPDR Bloomberg Convertible Securities ETF'),
    ('FCVT', 'First Trust SSI Strategic Convertible Securities ETF'),
]

_CONVERT_SEARCH_TTL = timedelta(hours=6)
_CONVERT_XBRL_TTL   = timedelta(hours=24)

# (concept, display label, display priority — lower shows first). Curated allowlist,
# not every us-gaap tag containing "Convertible" (e.g. convertible *preferred stock*
# concepts are deliberately excluded — this page is about convertible bonds).
_CONVERT_XBRL_CONCEPTS = [
    ('DebtInstrumentConvertibleConversionPrice1',                        'Conversion Price',                        0),
    ('DebtInstrumentConvertibleConversionRatio1',                        'Conversion Ratio',                        1),
    ('DebtInstrumentConvertibleNumberOfEquityInstruments',               'Shares Issuable on Conversion',           2),
    ('DebtInstrumentConvertibleIfConvertedValueInExcessOfPrincipal',     'If-Converted Value Over Principal',       3),
    ('DebtInstrumentConvertibleThresholdPercentageOfStockPriceTrigger',  'Call Trigger — Stock Price % of Conversion Price', 4),
    ('DebtInstrumentConvertibleThresholdTradingDays',                    'Call Trigger — Trading Days',             5),
    ('DebtInstrumentConvertibleThresholdConsecutiveTradingDays1',        'Call Trigger — Consecutive Trading Days', 6),
    ('DebtInstrumentConvertibleCarryingAmountOfTheEquityComponent',      'Equity Component (Carrying Value)',       7),
    ('ConvertibleDebtCurrent',                                           'Convertible Debt Outstanding (Current)',  8),
    ('ConvertibleDebtNoncurrent',                                        'Convertible Debt Outstanding (Long-Term)', 9),
    ('ConvertibleDebt',                                                  'Convertible Debt Outstanding',            10),
    ('ConvertibleLongTermNotesPayable',                                  'Convertible Notes Payable (Long-Term)',   11),
    ('ProceedsFromConvertibleDebt',                                      'Proceeds From Issuance',                  12),
    ('RepaymentsOfConvertibleDebt',                                      'Repayments / Redemptions',                13),
    ('StockIssuedDuringPeriodValueConversionOfConvertibleSecurities',    'Value Converted to Equity',               14),
]


def _fetch_convertible_xbrl_terms(cik: str) -> list[dict]:
    """Best-effort convertible-note economics from the issuer's own US-GAAP XBRL
    tags, pulled from a single companyfacts call rather than one request per
    concept (most concepts 404 for a given issuer since tagging varies)."""
    cache_key = f'convert_xbrl:{cik}'
    cached = cache_get(cache_key, _CONVERT_XBRL_TTL)
    if cached is not None:
        return cached

    try:
        url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{int(cik):010d}.json"
        facts = _edgar_req(url, timeout=30).json().get('facts', {}).get('us-gaap', {})
    except Exception as exc:
        logger.warning('convertible xbrl facts %s: %s', cik, exc)
        facts = {}

    terms = []
    for concept, label, priority in _CONVERT_XBRL_CONCEPTS:
        units = facts.get(concept, {}).get('units', {})
        if not units:
            continue
        # Prefer the most informative unit when a concept is tagged more than one
        # way (e.g. both "shares" and dimensionless "pure" for the same fact).
        unit, points = max(units.items(), key=lambda kv: len(kv[1]))
        if not points:
            continue
        latest = sorted(points, key=lambda p: p.get('end') or p.get('filed') or '')[-1]
        accn = latest.get('accn', '')
        filing_url = None
        if accn:
            acc_nodash = accn.replace('-', '')
            filing_url = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc_nodash}/{accn}-index.htm"
        terms.append({
            'concept':    concept,
            'label':      label,
            'priority':   priority,
            'value':      latest.get('val'),
            'unit':       unit,
            'asOf':       latest.get('end'),
            'formType':   latest.get('form'),
            'filingDate': latest.get('filed'),
            'filingUrl':  filing_url,
        })

    terms.sort(key=lambda t: t['priority'])
    cache_set(cache_key, terms)
    return terms


@router.get('/api/convertibles/search')
def convertibles_search(q: str):
    """Search for an issuer's convertible bonds across major convertible bond
    ETF holdings, falling back to SEC prospectus filings, plus best-effort
    conversion economics mined from the issuer's own XBRL filings."""
    q = q.strip()
    if not q:
        return {'query': q, 'bonds': [], 'source': None, 'xbrlTerms': []}

    cache_key = f'convert_search:{q.lower()}'
    cached = cache_get(cache_key, _CONVERT_SEARCH_TTL)
    if cached is not None:
        return cached

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
        needles.add(resolved_name.split(' ')[0])
    elif not looks_like_ticker:
        needles.add(q.upper())

    ticker_for_prospectus = q.upper() if looks_like_ticker else _lookup_ticker_by_name(q, ticker_map)

    with ThreadPoolExecutor(max_workers=len(_CONVERT_ETF_UNIVERSE)) as pool:
        futures = {pool.submit(_fetch_bond_fund_holdings, sym): sym
                   for sym, _label in _CONVERT_ETF_UNIVERSE}
        fund_results = {}
        for fut in as_completed(futures):
            sym = futures[fut]
            try:
                fund_results[sym] = fut.result()
            except Exception:
                fund_results[sym] = []

    needle_res = [re.compile(r'\b' + re.escape(n) + r'\b') for n in needles]

    def _matches(name: str) -> bool:
        if not name:
            return False
        name_u = name.upper()
        return any(r.search(name_u) for r in needle_res)

    by_cusip: dict[str, dict] = {}
    for fund_ticker, holdings in fund_results.items():
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
                'heldBy':       [],
                'source':       'fund',
            })
            bond['heldBy'].append({
                'fund':        fund_ticker,
                'weight':      h.get('weight'),
                'marketValue': h.get('marketValue'),
                'price':       _bond_price_per_100(h),
            })

    bonds = []
    for bond in by_cusip.values():
        bond['heldBy'].sort(key=lambda x: -(x.get('marketValue') or 0))
        bonds.append(bond)
    bonds.sort(key=lambda b: (b.get('maturityDate') or '9999'))

    source = 'fund' if bonds else None

    if not bonds and ticker_for_prospectus:
        prospectus_bonds = _search_bond_prospectus(ticker_for_prospectus, require_convertible=True)
        if prospectus_bonds:
            bonds = prospectus_bonds
            source = 'prospectus'

    xbrl_terms = []
    if ticker_for_prospectus:
        cik = _get_cik(ticker_for_prospectus)
        if cik:
            try:
                xbrl_terms = _fetch_convertible_xbrl_terms(cik)
            except Exception as exc:
                logger.warning('convertible xbrl terms %s: %s', ticker_for_prospectus, exc)

    result = {
        'query':         q,
        'bonds':         bonds[:40],
        'source':        source,
        'resolvedTicker': ticker_for_prospectus,
        'xbrlTerms':     xbrl_terms,
    }
    cache_set(cache_key, result)
    return result
