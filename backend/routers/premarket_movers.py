"""Pre-Market Movers — Day Trader (pre-market movers panel).

Scans a fixed liquid-symbol universe for pre/post-market price moves >= 1%.
"""
import logging
from datetime import timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from fastapi import APIRouter
import yfinance as yf

from database import cache_get, cache_set
from edgar_utils import _session

logger = logging.getLogger(__name__)
router = APIRouter()

_PREMARKET_TTL = timedelta(minutes=5)

# ── Pre-Market Movers ─────────────────────────────────────────────────────────

_PREMARKET_TTL = timedelta(minutes=5)
_PREMARKET_UNIVERSE = [
    "AAPL","MSFT","GOOGL","AMZN","NVDA","META","TSLA","AMD","NFLX","CRM",
    "ORCL","ADBE","INTC","CSCO","QCOM","AMAT","LRCX","KLAC","MU","PANW",
    "UBER","LYFT","ABNB","SHOP","SNAP","SPOT","RBLX","COIN","HOOD","PLTR",
    "GME","AMC","BBBY","SPCE","RIVN","LCID","NIO","XPEV","LI","SOFI",
]


def _fetch_premarket(sym: str):
    try:
        t  = yf.Ticker(sym, session=_session)
        fi = t.fast_info
        pre  = getattr(fi, "pre_market_price",  None) or getattr(fi, "preMarketPrice",  None)
        post = getattr(fi, "post_market_price", None) or getattr(fi, "postMarketPrice", None)
        prev = getattr(fi, "previous_close", None)    or getattr(fi, "previousClose",   None)
        last = getattr(fi, "last_price", None)        or getattr(fi, "lastPrice",        None)
        mkt_price = pre or post
        base_price = prev or last
        if not mkt_price or not base_price or base_price <= 0:
            return None
        chg_pct = (mkt_price / base_price - 1) * 100
        if abs(chg_pct) < 1.0:  # skip small moves
            return None
        info = t.info
        return {
            "symbol":       sym,
            "name":         info.get("shortName") or info.get("longName") or sym,
            "preMarketPrice": round(float(mkt_price), 2),
            "previousClose":  round(float(base_price), 2),
            "changePercent":  round(float(chg_pct), 2),
            "isPreMarket":    pre is not None,
        }
    except Exception:
        return None


@router.get("/api/market/premarket-movers")
def get_premarket_movers():
    cache_key = "market:premarket"
    cached = cache_get(cache_key, _PREMARKET_TTL)
    if cached is not None:
        return cached

    movers = []
    with ThreadPoolExecutor(max_workers=10) as ex:
        futures = {ex.submit(_fetch_premarket, sym): sym for sym in _PREMARKET_UNIVERSE}
        for f in as_completed(futures):
            data = f.result()
            if data:
                movers.append(data)

    movers.sort(key=lambda x: abs(x["changePercent"]), reverse=True)
    result = {"gainers": [m for m in movers if m["changePercent"] > 0][:10],
              "losers":  [m for m in movers if m["changePercent"] < 0][:10]}
    cache_set(cache_key, result)
    return result

