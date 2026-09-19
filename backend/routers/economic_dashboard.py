"""Economic Dashboard — Markets -> Economic Indicators.

Live macro tickers (yields, DXY, VIX, commodities) plus optional FRED
series (CPI, unemployment, GDP, etc.) when FRED_API_KEY is set.
"""
import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
import yfinance as yf
from fastapi import APIRouter

from database import cache_get, cache_set
from edgar_utils import _session, _safe_float

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Economic Dashboard ────────────────────────────────────────────────────────

_ECON_TTL = timedelta(minutes=30)

_MACRO_TICKERS: list[dict] = [
    {"sym": "^IRX",     "name": "3M T-Bill",     "unit": "%",       "group": "yields"},
    {"sym": "^FVX",     "name": "5Y Yield",       "unit": "%",       "group": "yields"},
    {"sym": "^TNX",     "name": "10Y Yield",      "unit": "%",       "group": "yields"},
    {"sym": "^TYX",     "name": "30Y Yield",      "unit": "%",       "group": "yields"},
    {"sym": "DX-Y.NYB", "name": "Dollar Index",   "unit": "",        "group": "macro"},
    {"sym": "^VIX",     "name": "VIX",            "unit": "",        "group": "macro"},
    {"sym": "GC=F",     "name": "Gold",           "unit": "$/oz",    "group": "commodities"},
    {"sym": "CL=F",     "name": "WTI Oil",        "unit": "$/bbl",   "group": "commodities"},
    {"sym": "HG=F",     "name": "Copper",         "unit": "$/lb",    "group": "commodities"},
    {"sym": "NG=F",     "name": "Nat Gas",        "unit": "$/MMBtu", "group": "commodities"},
]

_FRED_SERIES: dict[str, dict] = {
    "FEDFUNDS": {"name": "Fed Funds Rate",       "unit": "%",   "freq": "M", "mode": "level",   "hib": None},
    "CPIAUCSL": {"name": "CPI Inflation",        "unit": "%",   "freq": "M", "mode": "yoy",     "hib": False},
    "CPILFESL": {"name": "Core CPI",             "unit": "%",   "freq": "M", "mode": "yoy",     "hib": False},
    "PCEPILFE": {"name": "Core PCE",             "unit": "%",   "freq": "M", "mode": "yoy",     "hib": False},
    "UNRATE":   {"name": "Unemployment Rate",    "unit": "%",   "freq": "M", "mode": "level",   "hib": False},
    "PAYEMS":   {"name": "Nonfarm Payrolls",     "unit": "K",   "freq": "M", "mode": "mom_abs", "hib": True},
    "ICSA":     {"name": "Initial Claims",       "unit": "K",   "freq": "W", "mode": "level",   "hib": False},
    "GDPC1":    {"name": "Real GDP Growth",      "unit": "%",   "freq": "Q", "mode": "yoy",     "hib": True},
    "UMCSENT":  {"name": "Consumer Sentiment",   "unit": "",    "freq": "M", "mode": "level",   "hib": True},
    "HOUST":    {"name": "Housing Starts",       "unit": "K",   "freq": "M", "mode": "level",   "hib": True},
    "RSXFS":    {"name": "Retail Sales",         "unit": "%",   "freq": "M", "mode": "yoy",     "hib": True},
    "INDPRO":   {"name": "Indust. Production",   "unit": "%",   "freq": "M", "mode": "yoy",     "hib": True},
}


def _fetch_macro_ticker(item: dict) -> dict | None:
    try:
        sym = item["sym"]
        t = yf.Ticker(sym, session=_session)
        fi = t.fast_info
        price = _safe_float(fi.last_price)
        prev  = _safe_float(fi.previous_close)
        if price is None:
            return None
        chg_pct = (price - prev) / prev * 100 if prev else None
        return {
            "sym":       sym,
            "name":      item["name"],
            "unit":      item["unit"],
            "group":     item["group"],
            "price":     round(price, 4),
            "changePct": round(chg_pct, 2) if chg_pct is not None else None,
        }
    except Exception:
        return None


def _fetch_fred_obs(api_key: str, sid: str, limit: int = 26) -> list[dict]:
    import urllib.request as _ur
    url = (
        f"https://api.stlouisfed.org/fred/series/observations"
        f"?series_id={sid}&api_key={api_key}&limit={limit}"
        f"&sort_order=desc&file_type=json"
    )
    try:
        with _ur.urlopen(url, timeout=10) as r:
            data = json.loads(r.read())
        return [o for o in data.get("observations", []) if o.get("value") not in (".", None, "")]
    except Exception as e:
        logger.warning("FRED %s: %s", sid, e)
        return []


def _process_fred(sid: str, obs: list[dict], meta: dict) -> dict:
    base = {"sid": sid, "name": meta["name"], "unit": meta["unit"],
            "freq": meta["freq"], "mode": meta["mode"], "hib": meta["hib"]}
    if not obs:
        return {**base, "error": "no data"}

    vals  = [float(o["value"]) for o in obs]
    dates = [o["date"] for o in obs]
    mode  = meta["mode"]
    freq  = meta["freq"]

    # periods for YoY comparison
    yoy_n = {"M": 12, "Q": 4, "W": 52}.get(freq, 12)

    if mode == "yoy":
        # compute rolling YoY % change series
        yoy_series = []
        for i in range(len(vals)):
            j = i + yoy_n
            if j < len(vals) and vals[j] != 0:
                yoy_series.append(round((vals[i] / vals[j] - 1) * 100, 2))
            else:
                break
        display  = yoy_series[0] if yoy_series else None
        prev_val = yoy_series[1] if len(yoy_series) > 1 else None
        change   = round(display - prev_val, 2) if display is not None and prev_val is not None else None
        spark    = list(reversed(yoy_series[:12]))

    elif mode == "mom_abs":
        # absolute MoM change (payrolls: jobs added in K)
        changes = [round(vals[i] - vals[i + 1], 0) for i in range(len(vals) - 1)]
        display  = changes[0] if changes else None
        prev_val = changes[1] if len(changes) > 1 else None
        change   = None
        spark    = list(reversed(changes[:12]))

    else:  # level
        display  = round(vals[0], 2)
        prev_val = round(vals[1], 2) if len(vals) > 1 else None
        change   = round(display - prev_val, 2) if prev_val is not None else None
        spark    = list(reversed([round(v, 2) for v in vals[:12]]))

    return {
        **base,
        "value":     display,
        "prev":      prev_val,
        "change":    change,
        "date":      dates[0],
        "sparkline": spark,
    }


@router.get("/api/market/economic")
def get_economic_dashboard():
    cache_key = "market:economic"
    cached = cache_get(cache_key, _ECON_TTL)
    if cached is not None:
        return cached

    # Market macro from yfinance (parallel)
    macro: list[dict] = []
    with ThreadPoolExecutor(max_workers=len(_MACRO_TICKERS)) as pool:
        futures = {pool.submit(_fetch_macro_ticker, item): item["sym"] for item in _MACRO_TICKERS}
        for fut in as_completed(futures):
            r = fut.result()
            if r:
                macro.append(r)
    sym_order = [item["sym"] for item in _MACRO_TICKERS]
    macro.sort(key=lambda x: sym_order.index(x["sym"]) if x["sym"] in sym_order else 99)

    # Yield curve
    ym = {m["sym"]: m["price"] for m in macro}
    y3m, y5y, y10y, y30y = ym.get("^IRX"), ym.get("^FVX"), ym.get("^TNX"), ym.get("^TYX")
    spread_10_3 = round(y10y - y3m, 2) if y10y and y3m else None

    # FRED economic series (optional)
    fred_key = os.getenv("FRED_API_KEY", "").strip()
    fred: dict[str, dict] = {}
    if fred_key:
        limits = {"Q": 10, "W": 18, "M": 26}
        with ThreadPoolExecutor(max_workers=6) as pool:
            futs = {pool.submit(_fetch_fred_obs, fred_key, sid,
                                limits.get(meta["freq"], 26)): sid
                    for sid, meta in _FRED_SERIES.items()}
            for fut in as_completed(futs):
                sid = futs[fut]
                obs = fut.result()
                fred[sid] = _process_fred(sid, obs, _FRED_SERIES[sid])

    result = {
        "macro":   macro,
        "fred":    fred,
        "hasFred": bool(fred_key),
        "yields": {
            "3M": y3m, "5Y": y5y, "10Y": y10y, "30Y": y30y,
            "spread10y3m": spread_10_3,
            "inverted": spread_10_3 is not None and spread_10_3 < 0,
        },
        "asOf": datetime.now().strftime("%H:%M"),
    }
    cache_set(cache_key, result)
    return result


