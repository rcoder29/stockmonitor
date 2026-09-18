"""Shared SEC EDGAR helpers used across many feature areas (Fund Holdings
Explorer, SEC Filings, Corporate/Convertible Bond Research, IPO & Lockup
Calendar, Merger Arb, SPACs, Activist Tracker). Pulled out of main.py so it
can be imported by both main.py and the routers/ package without a circular
import — this module has no dependency on main.py or any router.
"""
import re
import math
import logging
import xml.etree.ElementTree as ET
from datetime import timedelta
from curl_cffi import requests as curl_requests
import yfinance as yf

from database import cache_get, cache_set

logger = logging.getLogger(__name__)

# Corporate proxy uses a self-signed cert — reuse one session with SSL disabled
_session = curl_requests.Session(verify=False, impersonate="chrome")

_EDGAR_UA = {'User-Agent': 'StockMonitor/1.0 raghuravuri@gmail.com'}
_EDGAR_TICKERMAP_TTL = timedelta(hours=24)

_EDGAR_ASSET_CATS = {
    'EC': 'Equity', 'DBT': 'Debt', 'DERIV': 'Derivative',
    'OTH': 'Other', 'ABS': 'ABS', 'MBS': 'MBS',
    'STIV': 'Short-Term', 'RE': 'Real Estate',
}


def _safe_float(val) -> float | None:
    try:
        f = float(val) if val is not None else None
        return None if (f is None or f != f) else f  # f != f catches NaN
    except (TypeError, ValueError):
        return None


def _finite_or_none(v):
    """Same idea as _safe_float, for a value already known to be numeric (or
    None) — used where a bare NaN/inf could otherwise leak into a JSON
    response (e.g. computed ratios). Shared by IPO & Lockup Calendar and
    Merger Arb."""
    return v if v is not None and math.isfinite(v) else None


def _edgar_req(url: str, timeout: int = 30) -> curl_requests.Response:
    return curl_requests.get(url, headers=_EDGAR_UA, timeout=timeout, impersonate='chrome')


def _localname_find(elem, localname: str):
    for child in elem:
        if child.tag.split('}')[-1] == localname:
            return child
    return None


def _localname_iter(root, localname: str):
    for el in root.iter():
        if el.tag.split('}')[-1] == localname:
            yield el


def _edgar_filing_xml(cik: str, accession: str) -> str | None:
    """Download the raw N-PORT XML from EDGAR. Shared by Fund Holdings Explorer
    (CIK-based lookup) and the bond fetchers (series-based lookup) — both need
    the same "find the XML file inside this accession" logic."""
    try:
        acc_nodash = accession.replace('-', '')
        base = f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc_nodash}"

        # The raw XML is always primary_doc.xml at the accession root,
        # even when submissions.json lists an XSL subdirectory path.
        for filename in ('primary_doc.xml', 'form.xml', 'nport.xml'):
            try:
                resp = _edgar_req(f"{base}/{filename}", timeout=90)
                if resp.status_code == 200 and resp.text.strip().startswith('<'):
                    return resp.text
            except Exception:
                continue

        # Fallback: parse filing index for any .xml link
        idx = _edgar_req(f"{base}/{accession}-index.htm", timeout=30)
        links = re.findall(r'href="(/Archives/edgar/data/\d+/[^"]+\.xml)"', idx.text, re.I)
        for link in links:
            try:
                r = _edgar_req(f"https://www.sec.gov{link}", timeout=90)
                if r.status_code == 200 and r.text.strip().startswith('<'):
                    return r.text
            except Exception:
                continue
        return None
    except Exception as exc:
        logger.warning('edgar xml %s/%s: %s', cik, accession, exc)
        return None


# ── Name → Ticker lookup (from SEC company_tickers_exchange.json) ─────────────

def _build_ticker_map() -> dict[str, str]:
    """Download SEC company ticker list and build normalized-name → ticker map."""
    cache_key = 'sec_ticker_name_map'
    cached = cache_get(cache_key, _EDGAR_TICKERMAP_TTL)
    if cached:
        return cached
    try:
        data   = _edgar_req('https://www.sec.gov/files/company_tickers_exchange.json').json()
        fields = data.get('fields', [])
        rows   = data.get('data', [])
        ni = fields.index('name')   if 'name'   in fields else 1
        ti = fields.index('ticker') if 'ticker' in fields else 2

        _STRIP_SUFFIXES = (
            ' INC.', ' INC', ' CORP.', ' CORP', ' CO.', ' CO',
            ' LTD.', ' LTD', ' LLC', ' LP', ' PLC', ' SA', ' AG',
            ' NV', ' SE', ' GROUP', ' HOLDINGS', ' HOLDING',
            ' TRUST', ' FUND', ' ETF', ' CLASS A', ' CLASS B', ' CLASS C',
        )

        ticker_map: dict[str, str] = {}
        for row in rows:
            if len(row) <= max(ni, ti):
                continue
            raw_name = str(row[ni]).strip()
            ticker   = str(row[ti]).strip().upper()
            if not raw_name or not ticker or len(ticker) > 6:
                continue
            # Store original normalized
            key = raw_name.upper().rstrip('.')
            ticker_map[key] = ticker
            # Strip suffixes progressively
            stripped = key
            for sfx in _STRIP_SUFFIXES:
                if stripped.endswith(sfx):
                    stripped = stripped[: -len(sfx)].rstrip(' ,')
            if stripped != key:
                ticker_map.setdefault(stripped, ticker)

        cache_set(cache_key, ticker_map)
        return ticker_map
    except Exception as exc:
        logger.warning('sec ticker map build: %s', exc)
        return {}


def _lookup_ticker_by_name(name: str, ticker_map: dict[str, str]) -> str | None:
    if not name or not ticker_map:
        return None
    _STRIP_SUFFIXES = (
        ' INC.', ' INC', ' CORP.', ' CORP', ' CO.', ' CO',
        ' LTD.', ' LTD', ' LLC', ' LP', ' PLC', ' SA', ' AG',
        ' NV', ' SE', ' GROUP', ' HOLDINGS', ' HOLDING',
        ' TRUST', ' FUND', ' ETF', ' CLASS A', ' CLASS B', ' CLASS C',
        ' THE',
    )
    key = name.upper().rstrip('.,')
    # Direct match
    if key in ticker_map:
        return ticker_map[key]
    # Strip common suffixes
    stripped = key
    for sfx in _STRIP_SUFFIXES:
        if stripped.endswith(sfx):
            stripped = stripped[: -len(sfx)].rstrip(' ,')
    if stripped in ticker_map:
        return ticker_map[stripped]
    return None


def _parse_nport_xml(xml_text: str, ticker_map: dict) -> tuple[dict, list[dict]]:
    """Parse N-PORT XML; enrich holding tickers via name lookup."""
    fund_info: dict = {'netAssets': None, 'totAssets': None, 'seriesName': None, 'period': None}
    holdings: list[dict] = []

    try:
        root = ET.fromstring(xml_text)

        # Fund-level metadata
        for tag, key in [('seriesName', 'seriesName'), ('regName', 'seriesName'),
                         ('repPdDate', 'period'), ('totAssets', 'totAssets'),
                         ('netAssets', 'netAssets')]:
            for el in _localname_iter(root, tag):
                val = el.text.strip() if el.text else None
                if not val or val == 'N/A':
                    break
                if key in ('totAssets', 'netAssets'):
                    fund_info[key] = _safe_float(val)
                elif not fund_info.get(key):
                    fund_info[key] = val
                break

        # Holdings — each <invstOrSec> element
        for sec in _localname_iter(root, 'invstOrSec'):
            def _txt(lname):
                el = _localname_find(sec, lname)
                return el.text.strip() if el is not None and el.text else None

            name = _txt('name')
            if not name:
                continue

            pct_val  = _safe_float(_txt('pctVal'))
            # N-PORT uses valUSD for USD fair value; older forms used fairValAmt
            fair_val = _safe_float(_txt('valUSD') or _txt('fairValAmt'))
            asset_cat = _txt('assetCat') or 'OTH'
            country  = _txt('invCountry')
            cusip    = _txt('cusip')
            balance  = _safe_float(_txt('balance'))
            issuer_cat = _txt('issuerCat')

            # Debt-specific schedule (coupon/maturity) — present when assetCat == 'DBT'
            debt_sec = _localname_find(sec, 'debtSec')
            maturity_date = coupon_type = coupon_rate = None
            is_default = None
            if debt_sec is not None:
                def _dtxt(lname):
                    el = _localname_find(debt_sec, lname)
                    return el.text.strip() if el is not None and el.text else None
                maturity_date = _dtxt('maturityDt')
                coupon_type   = _dtxt('couponKind')
                coupon_rate   = _safe_float(_dtxt('annualizedRt'))
                is_default    = _dtxt('isDefault') == 'Y'

            # Extract ISIN from <identifiers>
            isin = None
            ident_el = _localname_find(sec, 'identifiers')
            if ident_el is not None:
                for child in ident_el:
                    ltag = child.tag.split('}')[-1]
                    if ltag == 'isin':
                        isin = child.get('value') or (child.text.strip() if child.text else None)
                    # Some older filings have <ticker value="...">
                    # (rare in modern N-PORT but keep for compatibility)

            # Derive ticker: try name lookup in SEC ticker map
            ticker = _lookup_ticker_by_name(name, ticker_map)

            holdings.append({
                'name':       name,
                'ticker':     ticker,
                'cusip':      cusip,
                'isin':       isin,
                'weight':     round(pct_val, 4) if pct_val is not None else None,
                'fairValue':  round(fair_val, 2) if fair_val is not None else None,
                'assetCat':   _EDGAR_ASSET_CATS.get(asset_cat, asset_cat),
                'issuerCat':  issuer_cat,
                'country':    country,
                'balance':    balance,
                'maturityDate': maturity_date,
                'couponType':   coupon_type,
                'couponRate':   coupon_rate,
                'isDefault':    is_default,
                'price':      None,
                'high52w':    None,
                'low52w':     None,
                'perf1m':     None,
                'perf3m':     None,
                'perf6m':     None,
                'perf1y':     None,
                'pctFromHigh': None,
            })

    except Exception as exc:
        logger.warning('nport xml parse: %s', exc)

    holdings.sort(key=lambda h: -(h['weight'] or 0))
    return fund_info, holdings


# ── Ticker → CIK lookup (from SEC company_tickers.json) ───────────────────────

_TICKER_CIK_MAP: dict[str, str] = {}


def _get_cik(ticker: str) -> str | None:
    global _TICKER_CIK_MAP
    if not _TICKER_CIK_MAP:
        try:
            r = _session.get(
                "https://www.sec.gov/files/company_tickers.json",
                headers={"User-Agent": "StockMonitor raghuravuri@gmail.com"},
            )
            data = r.json()
            _TICKER_CIK_MAP = {
                v["ticker"]: str(v["cik_str"]).zfill(10) for v in data.values()
            }
        except Exception as e:
            logger.warning("Failed to load EDGAR ticker map: %s", e)
            return None
    return _TICKER_CIK_MAP.get(ticker.upper())


# Extracts the ticker(s) named in EDGAR's combined filer-listing display name
# (e.g. "BOEING CO (BA) (CIK 0000012927)"). Shared by IPO & Lockup Calendar,
# Activist Tracker, Merger Arb, and SPACs — all parse the same display-name
# format from EDGAR full-text search results.
_TICKER_RE = re.compile(r'\(([A-Z]{1,6}(?:,\s*[A-Z]{1,6})*)\)\s*\(CIK')


def _fetch_opp_quote(ticker: str) -> dict:
    """1-month price history + 5d/1mo % change for a ticker surfaced by an
    EDGAR filing scan. Shared by Merger Arb's Opportunity Scanner, Activist
    Tracker, and Reddit Trending Stocks."""
    try:
        hist = yf.Ticker(ticker).history(period='1mo')
        if hist.empty:
            return {}
        last = float(hist['Close'].iloc[-1])
        if not math.isfinite(last):
            return {}
        chg5d = None
        chg1mo = None
        if len(hist) > 5:
            prev5 = float(hist['Close'].iloc[-6])
            if math.isfinite(prev5) and prev5:
                chg5d = round((last / prev5 - 1) * 100, 2)
        if len(hist) > 1:
            prev1mo = float(hist['Close'].iloc[0])
            if math.isfinite(prev1mo) and prev1mo:
                chg1mo = round((last / prev1mo - 1) * 100, 2)
        return {'currentPrice': round(last, 2), 'priceChange5d': _finite_or_none(chg5d), 'priceChange1mo': _finite_or_none(chg1mo)}
    except Exception:
        return {}
