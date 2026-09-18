"""SEC Filings — Chart Modal (Filings tab).

Recent 10-K/10-Q/8-K filings for a symbol via EDGAR submissions API.
"""
import logging
from datetime import timedelta
from fastapi import APIRouter

from database import cache_get, cache_set
from edgar_utils import _session, _get_cik

logger = logging.getLogger(__name__)
router = APIRouter()

# ── SEC Filings ───────────────────────────────────────────────────────────────
# _get_cik lives in edgar_utils.py (imported above) — shared by this section,
# Corporate/Convertible Bonds, and several other EDGAR-based features.

_EDGAR_TTL       = timedelta(hours=12)


@router.get("/api/filings/{symbol}")
def get_filings(symbol: str):
    symbol = symbol.upper()
    cache_key = f"filings:{symbol}"
    cached = cache_get(cache_key, _EDGAR_TTL)
    if cached is not None:
        return cached

    cik = _get_cik(symbol)
    if not cik:
        result = {"symbol": symbol, "filings": [], "error": "Ticker not found in EDGAR"}
        cache_set(cache_key, result)
        return result

    try:
        url = f"https://data.sec.gov/submissions/CIK{cik}.json"
        r = _session.get(url, headers={"User-Agent": "StockMonitor raghuravuri@gmail.com"})
        data = r.json()

        recent   = data.get("filings", {}).get("recent", {})
        forms    = recent.get("form", [])
        dates    = recent.get("filingDate", [])
        accnums  = recent.get("accessionNumber", [])
        docs     = recent.get("primaryDocument", [])
        descs    = recent.get("primaryDocDescription", [])

        target = {"10-K", "10-Q", "8-K", "10-K/A", "10-Q/A"}
        filings = []
        cik_int = int(cik)
        for form, date, acc, doc, desc in zip(forms, dates, accnums, docs, descs):
            if form not in target:
                continue
            acc_clean = acc.replace("-", "")
            filing_url = f"https://www.sec.gov/Archives/edgar/data/{cik_int}/{acc_clean}/{doc}"
            filings.append({
                "form":   form,
                "date":   date,
                "url":    filing_url,
                "desc":   desc or doc,
                "acc":    acc,
            })
            if len(filings) >= 25:
                break

        result = {
            "symbol":      symbol,
            "companyName": data.get("name", symbol),
            "cik":         cik,
            "filings":     filings,
        }
    except Exception as e:
        logger.warning("EDGAR filings failed %s: %s", symbol, e)
        result = {"symbol": symbol, "filings": [], "error": str(e)}

    cache_set(cache_key, result)
    return result

