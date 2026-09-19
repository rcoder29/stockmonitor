"""Insider Transactions — Chart Modal (Insider tab, per-symbol view).

Recent insider buy/sell transactions for a single symbol, straight from
yfinance's insider_transactions table.
"""
import pandas as pd
import yfinance as yf
from fastapi import APIRouter, HTTPException

from database import cache_get, cache_set
from edgar_utils import _session, _INSIDER_TTL

router = APIRouter()



@router.get("/api/insider/{symbol}")
def get_insider_transactions(symbol: str):
    sym = symbol.upper()
    key = f"insider:{sym}"
    cached = cache_get(key, _INSIDER_TTL)
    if cached is not None:
        return cached
    try:
        df = yf.Ticker(sym, session=_session).insider_transactions
        if df is None or len(df) == 0:
            result = {"symbol": sym, "transactions": []}
            cache_set(key, result)
            return result

        rows = []
        for _, row in df.iterrows():
            date_val = (row.get("Start Date") or row.get("startDate")
                        or row.get("Date") or row.get("date"))
            date_str = None
            if date_val is not None:
                try:
                    date_str = str(pd.Timestamp(date_val).date())
                except Exception:
                    date_str = str(date_val)

            shares = row.get("Shares") or row.get("shares")
            value  = row.get("Value") or row.get("value")
            text   = (row.get("Text") or row.get("Transaction")
                      or row.get("transaction") or "")
            insider   = row.get("Insider") or row.get("insider")
            position  = row.get("Position") or row.get("Title") or ""

            shares_v = int(shares) if shares is not None and not pd.isna(shares) else None
            value_v  = round(float(value), 0) if value is not None and not pd.isna(value) else None

            rows.append({
                "date":     date_str,
                "insider":  str(insider) if insider else None,
                "position": str(position) if position else None,
                "transaction": str(text),
                "shares":   shares_v,
                "value":    value_v,
            })

        result = {"symbol": sym, "transactions": rows[:40]}
        cache_set(key, result)
        return result
    except Exception as e:
        raise HTTPException(500, str(e))


