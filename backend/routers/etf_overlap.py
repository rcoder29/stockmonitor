"""ETF Overlap Analyzer — Research → ETF Overlap.

Compares top holdings across up to 4 ETFs to find overlapping constituents
and their combined weight.
"""
import logging
from datetime import timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from fastapi import APIRouter, HTTPException
import yfinance as yf

from database import cache_get, cache_set

logger = logging.getLogger(__name__)
router = APIRouter()

# ── ETF Overlap Analyzer ──────────────────────────────────────────────────────

_ETF_OVERLAP_TTL = timedelta(hours=24)


def _fetch_etf_holdings(sym: str) -> dict | None:
    cache_key = f"etfhold:{sym}"
    cached = cache_get(cache_key, _ETF_OVERLAP_TTL)
    if cached:
        return cached
    try:
        t = yf.Ticker(sym)
        info = {}
        try:
            info = t.info or {}
        except Exception:
            pass

        name = info.get("longName") or info.get("shortName") or sym
        holdings_list: list[dict] = []

        try:
            fd = t.get_funds_data()
            if fd is not None and hasattr(fd, "top_holdings"):
                th = fd.top_holdings
                if th is not None and not th.empty:
                    for idx, row in th.iterrows():
                        ticker_sym = str(idx) if idx else None
                        pct = None
                        for col in ["holdingPercent", "Holding Percent", "value"]:
                            if col in row and row[col] is not None:
                                try:
                                    pct = float(row[col]) * 100
                                    break
                                except Exception:
                                    pass
                        holding_name = None
                        for col in ["holdingName", "Holding Name", "name"]:
                            if col in row:
                                holding_name = str(row[col])
                                break
                        if ticker_sym and pct is not None:
                            holdings_list.append({
                                "symbol": ticker_sym.upper(),
                                "name":   holding_name or ticker_sym,
                                "weight": round(pct, 4),
                            })
        except Exception:
            pass

        if not holdings_list:
            try:
                th = t.funds_data.top_holdings if hasattr(t, "funds_data") else None
                if th is not None and not th.empty:
                    for idx, row in th.iterrows():
                        ticker_sym = str(idx) if idx else None
                        pct = None
                        try:
                            pct = float(row.iloc[0]) * 100
                        except Exception:
                            pass
                        if ticker_sym and pct is not None:
                            holdings_list.append({
                                "symbol": ticker_sym.upper(),
                                "name":   ticker_sym,
                                "weight": round(pct, 4),
                            })
            except Exception:
                pass

        result = {"symbol": sym, "name": name, "holdings": holdings_list}
        cache_set(cache_key, result)
        return result
    except Exception as exc:
        logger.warning("ETF holdings %s: %s", sym, exc)
        return None


@router.get("/api/market/etf-overlap")
def get_etf_overlap(tickers: str):
    syms = [s.strip().upper() for s in tickers.split(",") if s.strip()][:4]
    if len(syms) < 2:
        raise HTTPException(400, "Need at least 2 ETF tickers")

    cache_key = f"etfoverlap:{'_'.join(sorted(syms))}"
    cached = cache_get(cache_key, _ETF_OVERLAP_TTL)
    if cached:
        return cached

    etf_data: list[dict] = []
    with ThreadPoolExecutor(max_workers=min(len(syms), 4)) as pool:
        futures = {pool.submit(_fetch_etf_holdings, sym): sym for sym in syms}
        for fut in as_completed(futures):
            r = fut.result()
            if r:
                etf_data.append(r)

    etf_data.sort(key=lambda x: syms.index(x["symbol"]) if x["symbol"] in syms else 99)

    holding_map: dict[str, dict] = {}
    for etf in etf_data:
        for h in etf.get("holdings", []):
            hs = h["symbol"]
            if hs not in holding_map:
                holding_map[hs] = {"symbol": hs, "name": h["name"], "appearsIn": [], "weights": {}}
            holding_map[hs]["appearsIn"].append(etf["symbol"])
            holding_map[hs]["weights"][etf["symbol"]] = h["weight"]

    all_holdings = list(holding_map.values())
    overlap = [h for h in all_holdings if len(h["appearsIn"]) >= 2]
    overlap.sort(key=lambda x: -sum(x["weights"].values()))

    result = {
        "etfs":    etf_data,
        "overlap": overlap[:50],
        "allHoldings": all_holdings,
        "overlapCount": len(overlap),
    }
    cache_set(cache_key, result)
    return result


