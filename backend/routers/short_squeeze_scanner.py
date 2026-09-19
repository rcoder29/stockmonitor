"""Short Squeeze Scanner — Markets -> Short Squeeze.

Composite squeeze score (short % of float, days to cover, momentum, MoM
short-interest change) across a curated high-short-interest universe.
"""
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import timedelta
import yfinance as yf
from fastapi import APIRouter

from database import cache_get, cache_set
from edgar_utils import _session, _safe_float

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Short Squeeze Scanner ─────────────────────────────────────────────────────

_SQUEEZE_TTL = timedelta(minutes=30)

_SQUEEZE_UNIVERSE = [
    # Meme / high retail interest
    "GME","AMC","BBBY","MVIS","CLOV","WKHS","GOEV","NKLA","SPCE","SDC",
    # EV / clean energy
    "RIVN","LCID","NKLA","GOEV","FFIE","PSNY","ARVL","SOLO","CIIC","EVGO",
    "PLUG","FCEL","BE","BLDP","RUN","NOVA","ENPH","ARRY","SPWR","STEM",
    # Biotech volatility
    "NVAX","SAVA","VKTX","ACAD","SAGE","SRPT","MDGL","RVNC","ARWR","KRYS",
    # High-growth tech
    "COIN","HOOD","SOFI","AFRM","UPST","LC","OPEN","RDFN","CPNG","DDOG",
    "SNAP","PINS","RDDT","LYFT","DASH","ABNB","RBLX","MTTR","AI","PATH",
    # Retail / consumer
    "CVNA","M","KSS","JWN","GPS","EXPR","ANF","BBWI","PRTY","CATO",
    # Crypto / blockchain
    "MARA","RIOT","HUT","CLSK","BTBT","CIFR","IREN","WULF","SMLR","MSTR",
    # Cannabis
    "SNDL","ACB","TLRY","CGC","CRON","HEXO","OGI","GRWG","IIPR","APHA",
    # China ADR
    "BABA","NIO","XPEV","LI","FUTU","TIGR","GRAB","SE","BILI","PDD",
    # Speculative / special situation
    "BYND","PTON","HTZ","PARA","WBD","DISH","AMC","VTRS","MP","UWMC",
    "DKNG","PENN","RDFN","WYNN","MGM","CZR","NCLH","CCL","RCL","UAL",
]
_SQUEEZE_UNIVERSE = list(dict.fromkeys(_SQUEEZE_UNIVERSE))  # dedupe, preserve order


def _fetch_squeeze_data(sym: str) -> dict | None:
    try:
        info = yf.Ticker(sym, session=_session).info
        short_pct = _safe_float(info.get("shortPercentOfFloat"))
        short_ratio = _safe_float(info.get("shortRatio"))       # days to cover
        shares_short = _safe_float(info.get("sharesShort"))
        shares_short_prior = _safe_float(info.get("sharesShortPriorMonth"))
        price = _safe_float(info.get("regularMarketPrice"))
        chg_pct = _safe_float(info.get("regularMarketChangePercent"))
        w52_chg = _safe_float(info.get("52WeekChange"))
        name = info.get("shortName") or info.get("longName") or sym
        mkt_cap = _safe_float(info.get("marketCap"))

        if not short_pct or short_pct < 0.05:   # skip < 5% short interest
            return None

        # Short interest change (MoM)
        si_change = None
        if shares_short and shares_short_prior and shares_short_prior > 0:
            si_change = (shares_short - shares_short_prior) / shares_short_prior * 100

        # Squeeze score (0–100)
        score_si   = min(short_pct / 0.40, 1.0) * 40   # 40 pts: short % of float (capped at 40%)
        score_dtc  = min((short_ratio or 0) / 10.0, 1.0) * 30  # 30 pts: days to cover (capped at 10)
        score_mom  = max(0, min((chg_pct or 0) / 20.0, 1.0)) * 20  # 20 pts: positive momentum
        score_acc  = max(0, min((si_change or 0) / 50.0, 1.0)) * 10  # 10 pts: SI increasing
        score = round(score_si + score_dtc + score_mom + score_acc, 1)

        if score < 10:
            return None

        if score >= 70:
            level = "EXTREME"
        elif score >= 50:
            level = "HIGH"
        elif score >= 30:
            level = "MEDIUM"
        else:
            level = "LOW"

        return {
            "symbol":          sym,
            "name":            name,
            "price":           price,
            "changePercent":   chg_pct,
            "shortPctFloat":   round(short_pct * 100, 1) if short_pct else None,
            "daysToCover":     round(short_ratio, 1) if short_ratio else None,
            "siChangePct":     round(si_change, 1) if si_change is not None else None,
            "w52Change":       round((w52_chg or 0) * 100, 1),
            "marketCap":       mkt_cap,
            "squeezeScore":    score,
            "squeezeLevel":    level,
        }
    except Exception as exc:
        logger.debug("Squeeze fetch %s: %s", sym, exc)
        return None


@router.get("/api/market/short-squeeze")
async def short_squeeze(extra: str = ""):
    cache_key = "market:short-squeeze"
    cached = cache_get(cache_key, _SQUEEZE_TTL)
    if cached is not None:
        return cached

    universe = list(_SQUEEZE_UNIVERSE)
    if extra:
        universe = list(dict.fromkeys([s.strip().upper() for s in extra.split(",") if s.strip()] + universe))

    results = []
    with ThreadPoolExecutor(max_workers=20) as pool:
        futures = {pool.submit(_fetch_squeeze_data, sym): sym for sym in universe}
        for fut in as_completed(futures):
            r = fut.result()
            if r:
                results.append(r)

    results.sort(key=lambda x: x["squeezeScore"], reverse=True)
    results = results[:50]
    cache_set(cache_key, results)
    return results


