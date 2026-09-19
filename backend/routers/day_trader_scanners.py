"""Day Trader Scanners — Trading -> Day Trader.

Gainers/losers/most-active scanners plus a news feed seeded from those
symbols.

_fetch_screener_quotes and _fetch_feed are still in main.py (shared by
several other not-yet-extracted sections) — imported with a
function-scoped deferred import since main.py imports this router to
register it, which would otherwise cycle.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from fastapi import APIRouter

from database import cache_get, cache_set

router = APIRouter()

# ── Day Trader scanners ───────────────────────────────────────────────────────

_DAY_TRADER_TTL = timedelta(minutes=5)


@router.get("/api/day-trader/scanners")
def get_day_trader_scanners():
    from main import _fetch_screener_quotes

    cached = cache_get("day_trader:scanners", _DAY_TRADER_TTL)
    if cached is not None:
        return cached

    with ThreadPoolExecutor(max_workers=3) as pool:
        f_gainers = pool.submit(_fetch_screener_quotes, "day_gainers")
        f_losers  = pool.submit(_fetch_screener_quotes, "day_losers")
        f_active  = pool.submit(_fetch_screener_quotes, "most_actives")
        result = {
            "gainers":    f_gainers.result(),
            "losers":     f_losers.result(),
            "mostActive": f_active.result(),
        }

    cache_set("day_trader:scanners", result)
    return result


@router.get("/api/day-trader/news")
def get_day_trader_news():
    from main import _fetch_feed

    cached = cache_get("day_trader:news", _DAY_TRADER_TTL)
    if cached is not None:
        return cached

    # Pull symbols from the scanner cache (or fall back to liquid defaults)
    scan = cache_get("day_trader:scanners", _DAY_TRADER_TTL) or {}
    seen_syms: set[str] = set()
    symbols: list[str] = []
    for key in ("gainers", "losers", "mostActive"):
        for s in (scan.get(key) or [])[:4]:
            sym = s.get("symbol", "")
            if sym and sym not in seen_syms:
                seen_syms.add(sym)
                symbols.append(sym)
    if not symbols:
        symbols = ["SPY", "QQQ", "AAPL", "NVDA", "TSLA", "META", "AMZN"]

    def _fetch_sym_news(sym: str) -> list[dict]:
        return [{"symbol": sym, **a} for a in _fetch_feed(sym)[:4]]

    raw: list[dict] = []
    with ThreadPoolExecutor(max_workers=min(len(symbols), 8)) as pool:
        for articles in pool.map(_fetch_sym_news, symbols):
            raw.extend(articles)

    # Deduplicate by link
    seen_links: set[str] = set()
    articles: list[dict] = []
    for a in raw:
        if a["link"] not in seen_links:
            seen_links.add(a["link"])
            articles.append(a)

    articles.sort(key=lambda a: a.get("publishedAt") or "", reverse=True)
    result = articles[:20]
    cache_set("day_trader:news", result)
    return result


