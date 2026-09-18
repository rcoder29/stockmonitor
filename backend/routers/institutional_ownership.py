"""Institutional Ownership — Chart Modal (Institutional tab).

Major/institutional/mutual-fund holders for a symbol, via yfinance.
"""
import logging
from datetime import timedelta
from fastapi import APIRouter
import pandas as pd
import yfinance as yf

from database import cache_get, cache_set
from edgar_utils import _session

logger = logging.getLogger(__name__)
router = APIRouter()

_INST_TTL = timedelta(hours=4)

# ── Institutional Ownership ───────────────────────────────────────────────────

_INST_TTL = timedelta(hours=4)


@router.get("/api/institutional/{symbol}")
def get_institutional(symbol: str):
    symbol = symbol.upper()
    cache_key = f"institutional:{symbol}"
    cached = cache_get(cache_key, _INST_TTL)
    if cached is not None:
        return cached

    try:
        t = yf.Ticker(symbol, session=_session)

        major: dict = {}
        try:
            mh = t.major_holders
            if mh is not None and not mh.empty:
                for _, row in mh.iterrows():
                    val = row.iloc[0]
                    lbl = str(row.iloc[1]).lower()
                    try:
                        fval = float(str(val).strip("%")) / 100 if "%" in str(val) else float(val)
                    except (ValueError, TypeError):
                        fval = None
                    if "insider" in lbl and "institution" not in lbl:
                        major["insiderPct"] = fval
                    elif "institution" in lbl and "float" not in lbl:
                        major["institutionPct"] = fval
                    elif "float" in lbl and "institution" in lbl:
                        major["institutionFloatPct"] = fval
        except Exception as e:
            logger.warning("major holders failed %s: %s", symbol, e)

        def parse_holders(df, limit):
            rows = []
            if df is None or df.empty:
                return rows
            for _, row in df.head(limit).iterrows():
                shares = row.get("Shares")
                value  = row.get("Value")
                pct    = row.get("% Out")
                date   = row.get("Date Reported")
                rows.append({
                    "holder":       str(row.get("Holder", "")),
                    "shares":       int(shares) if pd.notna(shares) else None,
                    "value":        int(value)  if pd.notna(value)  else None,
                    "pctHeld":      round(float(pct) * 100, 2) if pd.notna(pct) else None,
                    "dateReported": str(date.date()) if pd.notna(date) and hasattr(date, "date") else str(date) if pd.notna(date) else None,
                })
            return rows

        inst_rows  = []
        fund_rows  = []
        try:
            inst_rows = parse_holders(t.institutional_holders, 15)
        except Exception as e:
            logger.warning("inst holders failed %s: %s", symbol, e)
        try:
            fund_rows = parse_holders(t.mutualfund_holders, 10)
        except Exception as e:
            logger.warning("fund holders failed %s: %s", symbol, e)

        result = {
            "symbol":        symbol,
            "major":         major,
            "institutional": inst_rows,
            "mutualFunds":   fund_rows,
        }
    except Exception as e:
        logger.warning("institutional failed %s: %s", symbol, e)
        result = {"symbol": symbol, "error": str(e), "major": {}, "institutional": [], "mutualFunds": []}

    cache_set(cache_key, result)
    return result

