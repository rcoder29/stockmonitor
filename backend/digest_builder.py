"""Digest data collection — turns live market data plus the user's own
portfolio / watchlist / alerts into one structured dict for the daily and
weekly digests.

Pure data: rendering lives in digest_render.py, delivery in digest_channels.py,
scheduling in digest_service.py. Every section is built independently so one
failing data source (e.g. a Yahoo rate limit) drops that section and is
reported in `errors` instead of sinking the whole digest.

Prices and period returns all come from main._fetch_perf_one, memoized per run
so a symbol that is a holding, a watchlist entry, and an alert target is only
fetched once.
"""
import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from database import db_session, WatchlistSymbol, PortfolioPosition, PriceAlert, PriceTarget

logger = logging.getLogger(__name__)

INDEX_SYMS = {"SPY": "S&P 500", "QQQ": "Nasdaq 100", "DIA": "Dow", "IWM": "Russell 2000"}
SECTOR_ETFS = {
    "XLK": "Technology", "XLF": "Financials", "XLE": "Energy", "XLV": "Health Care",
    "XLC": "Comm Services", "XLI": "Industrials", "XLRE": "Real Estate",
    "XLY": "Consumer Disc", "XLP": "Consumer Staples", "XLU": "Utilities", "XLB": "Materials",
}
MAX_WATCHLIST = 40      # bounds the number of Yahoo calls per digest
NEAR_PCT = 3.0          # a price alert this close to its target is "near"
TARGET_NEAR_PCT = 5.0   # same, for user price targets
AI_MODEL = "claude-haiku-4-5-20251001"

_AI_SYSTEM = (
    "You write the opening summary of a personal investor's market digest. "
    "In 3-4 plain sentences, say what mattered most in the data provided: the market tone, "
    "how the user's own portfolio did, and the one or two things to watch next. "
    "Use only numbers present in the data. No headings, no bullet points, no advice or predictions."
)


class _PerfBook:
    """Per-run memo over a `sym -> {price, 1d, 5d, ...}` fetcher."""

    def __init__(self, fetch):
        self._fetch = fetch
        self._memo: dict[str, dict] = {}

    def _safe(self, sym):
        try:
            return self._fetch(sym) or {}
        except Exception as exc:
            logger.warning("Digest price fetch failed for %s: %s", sym, exc)
            return {}

    def prefetch(self, syms):
        todo = [s for s in dict.fromkeys(syms) if s not in self._memo]
        if not todo:
            return
        with ThreadPoolExecutor(max_workers=8) as pool:
            for sym, data in zip(todo, pool.map(self._safe, todo)):
                self._memo[sym] = data

    def get(self, sym) -> dict:
        if sym not in self._memo:
            self._memo[sym] = self._safe(sym)
        return self._memo[sym]


class _Ctx:
    pass


def _default_perf_fetch(sym):
    from main import _fetch_perf_one  # deferred: main imports the router that imports this module
    return _fetch_perf_one(sym)


def _default_earnings_fetch(sym):
    from routers.earnings_calendar import _fetch_earnings
    return _fetch_earnings(sym)


def _default_econ_fetch():
    from routers.economic_calendar import get_economic_calendar
    return get_economic_calendar()


def _load_ctx(kind, now, perf_fetch, earnings_fetch, econ_fetch) -> _Ctx:
    ctx = _Ctx()
    ctx.kind = kind
    ctx.metric = "1d" if kind == "daily" else "5d"
    ctx.now = now
    ctx.perf = _PerfBook(perf_fetch or _default_perf_fetch)
    ctx.earnings_fetch = earnings_fetch or _default_earnings_fetch
    ctx.econ_fetch = econ_fetch or _default_econ_fetch

    # DB timestamps are naive UTC (datetime.utcnow), so compare in naive UTC.
    since = now.astimezone(timezone.utc).replace(tzinfo=None) - timedelta(days=1 if kind == "daily" else 7)
    with db_session() as db:
        ctx.positions = [(p.symbol, p.shares, p.avg_cost) for p in db.query(PortfolioPosition).all()]
        ctx.watch = [w.symbol for w in db.query(WatchlistSymbol).order_by(WatchlistSymbol.added_at).limit(MAX_WATCHLIST).all()]
        ctx.alerts_active = [
            {"symbol": a.symbol, "condition": a.condition, "target": a.target_price, "note": a.note or "", "type": a.alert_type or "price"}
            for a in db.query(PriceAlert).filter(PriceAlert.status == "active").all()
        ]
        ctx.alerts_recent = [
            {"symbol": a.symbol, "condition": a.condition, "target": a.target_price, "note": a.note or "",
             "triggered_at": a.triggered_at.isoformat() if a.triggered_at else None}
            for a in db.query(PriceAlert).filter(PriceAlert.status == "triggered", PriceAlert.triggered_at >= since).all()
        ]
        ctx.targets = [
            {"symbol": t.symbol, "target": t.target_price, "date": t.target_date, "note": t.note or ""}
            for t in db.query(PriceTarget).all()
        ]
    ctx.held = {s for s, _, _ in ctx.positions}
    return ctx


# ── Sections ──────────────────────────────────────────────────────────────────

def _market(ctx):
    k = ctx.metric
    indices = []
    for sym, name in INDEX_SYMS.items():
        d = ctx.perf.get(sym)
        if d.get("price") is not None:
            indices.append({"symbol": sym, "name": name, "price": d["price"], "chg": d.get(k)})

    vix = ctx.perf.get("^VIX")
    vix_price = vix.get("price")
    vix_out = None
    if vix_price is not None:
        vix_out = {
            "price": vix_price, "chg": vix.get(k),
            "label": "Low" if vix_price < 15 else "Elevated" if vix_price < 25 else "High",
        }

    sectors = [{"symbol": s, "name": n, "chg": ctx.perf.get(s).get(k)} for s, n in SECTOR_ETFS.items()]
    sectors = sorted((s for s in sectors if s["chg"] is not None), key=lambda s: s["chg"], reverse=True)
    return {
        "indices": indices,
        "vix": vix_out,
        "tnx": ctx.perf.get("^TNX").get("price"),
        "sectors_top": sectors[:3],
        "sectors_bottom": list(reversed(sectors[3:][-3:])),   # worst first; never overlaps the top
    }


def _portfolio(ctx):
    if not ctx.positions:
        return None
    k = ctx.metric
    agg: dict[str, dict] = {}
    for sym, shares, cost in ctx.positions:
        a = agg.setdefault(sym, {"shares": 0.0, "cost": 0.0})
        a["shares"] += shares
        a["cost"] += shares * cost

    holdings = []
    total_value = total_cost = period_pnl = prior_value = 0.0
    unpriced: list[str] = []
    for sym, a in agg.items():
        total_cost += a["cost"]
        d = ctx.perf.get(sym)
        price, chg = d.get("price"), d.get(k)
        if price is None:
            unpriced.append(sym)
            total_value += a["cost"]        # carry at cost, same convention as the Home summary
            continue
        value = a["shares"] * price
        total_value += value
        pnl = None
        if chg is not None and chg > -100:
            prior = price / (1 + chg / 100)
            pnl = a["shares"] * (price - prior)
            period_pnl += pnl
            prior_value += a["shares"] * prior
        holdings.append({
            "symbol": sym, "value": value, "chg": chg, "pnl": pnl,
            "unrealized_pct": (value / a["cost"] - 1) * 100 if a["cost"] else None,
        })

    with_pnl = [h for h in holdings if h["pnl"] is not None]
    ranked = sorted((h for h in holdings if h["chg"] is not None), key=lambda h: h["chg"], reverse=True)
    period_pct = period_pnl / prior_value * 100 if prior_value else None
    spy = ctx.perf.get("SPY").get(k)
    return {
        "count": len(agg),
        "unpriced": sorted(unpriced),
        "total_value": total_value,
        "unrealized_pnl": total_value - total_cost,
        "unrealized_pct": (total_value / total_cost - 1) * 100 if total_cost else None,
        "period_pnl": period_pnl if with_pnl else None,
        "period_pct": period_pct,
        "vs_spy": period_pct - spy if period_pct is not None and spy is not None else None,
        "movers": sorted(with_pnl, key=lambda h: abs(h["pnl"]), reverse=True)[:3],
        "best": ranked[:2],
        "worst": list(reversed(ranked[-2:])) if len(ranked) > 2 else [],
    }


def _watchlist(ctx):
    if not ctx.watch:
        return None
    k = ctx.metric
    rows = [{"symbol": s, "price": ctx.perf.get(s).get("price"), "chg": ctx.perf.get(s).get(k)} for s in ctx.watch]
    rows = [r for r in rows if r["chg"] is not None]
    rows.sort(key=lambda r: r["chg"], reverse=True)
    return {
        "count": len(ctx.watch),
        "gainers": [r for r in rows[:3] if r["chg"] > 0],
        "losers": [r for r in reversed(rows[-3:]) if r["chg"] < 0],
    }


def _events(ctx):
    window = 2 if ctx.kind == "daily" else 7
    econ = [
        {"date": e["date"], "event": e["event"], "type": e.get("type"), "daysUntil": e["daysUntil"]}
        for e in ctx.econ_fetch() if 0 <= e.get("daysUntil", -1) <= window
    ]

    syms = list(dict.fromkeys(list(ctx.held) + ctx.watch))

    def _safe_earn(sym):
        try:
            return ctx.earnings_fetch(sym)
        except Exception as exc:
            logger.warning("Digest earnings fetch failed for %s: %s", sym, exc)
            return None

    earnings = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        for sym, e in zip(syms, pool.map(_safe_earn, syms)):
            if e and e.get("daysUntil") is not None and 0 <= e["daysUntil"] <= window:
                earnings.append({
                    "symbol": sym, "date": e.get("date"), "daysUntil": e["daysUntil"],
                    "epsEstimate": e.get("epsEstimate"), "held": sym in ctx.held,
                })
    earnings.sort(key=lambda e: (e["daysUntil"], not e["held"], e["symbol"]))
    return {"window_days": window, "economic": econ, "earnings": earnings}


def _alerts(ctx):
    crossed, near = [], []
    price_alerts = [a for a in ctx.alerts_active if a["type"] == "price"]
    for a in price_alerts:
        price = ctx.perf.get(a["symbol"]).get("price")
        if price is None:
            continue
        # gap_pct > 0: still short of the target; <= 0: already through it.
        gap = (a["target"] - price) / price * 100 if a["condition"] == "above" else (price - a["target"]) / price * 100
        item = {**a, "price": price, "gap_pct": gap}
        if gap <= 0:
            crossed.append(item)
        elif gap <= NEAR_PCT:
            near.append(item)
    near.sort(key=lambda a: a["gap_pct"])
    if not (crossed or near or ctx.alerts_recent):
        return None
    return {"crossed": crossed, "near": near, "triggered": ctx.alerts_recent, "active_total": len(ctx.alerts_active)}


def _targets(ctx):
    if ctx.kind != "weekly" or not ctx.targets:
        return None
    today = ctx.now.date()
    out = []
    for t in ctx.targets:
        price = ctx.perf.get(t["symbol"]).get("price")
        if price is None:
            continue
        gap = (t["target"] - price) / price * 100
        days_left = None
        if t["date"]:
            try:
                days_left = (datetime.strptime(t["date"], "%Y-%m-%d").date() - today).days
            except ValueError:
                pass
        if abs(gap) <= TARGET_NEAR_PCT or (days_left is not None and 0 <= days_left <= 14):
            out.append({**t, "price": price, "gap_pct": gap, "days_left": days_left})
    out.sort(key=lambda t: abs(t["gap_pct"]))
    return out or None


_SECTIONS = [
    ("market", _market), ("portfolio", _portfolio), ("watchlist", _watchlist),
    ("events", _events), ("alerts", _alerts), ("targets", _targets),
]


def build_digest(kind: str, now: datetime | None = None, tz_name: str = "America/New_York",
                 perf_fetch=None, earnings_fetch=None, econ_fetch=None) -> dict:
    """Collect one digest. `kind` is 'daily' or 'weekly'. The fetch arguments
    exist so tests can run without touching Yahoo."""
    if kind not in ("daily", "weekly"):
        raise ValueError(f"unknown digest kind {kind!r}")
    now = now or datetime.now(timezone.utc)
    ctx = _load_ctx(kind, now, perf_fetch, earnings_fetch, econ_fetch)

    symbols = list(INDEX_SYMS) + ["^VIX", "^TNX"] + list(SECTOR_ETFS) + ctx.watch + sorted(ctx.held)
    symbols += [a["symbol"] for a in ctx.alerts_active if a["type"] == "price"]
    symbols += [t["symbol"] for t in ctx.targets] if kind == "weekly" else []
    ctx.perf.prefetch(symbols)

    sections, errors = {}, {}
    for name, fn in _SECTIONS:
        try:
            sections[name] = fn(ctx)
        except Exception as exc:
            logger.exception("Digest section %s failed", name)
            sections[name] = None
            errors[name] = f"{type(exc).__name__}: {exc}"[:200]

    local = now.astimezone(ZoneInfo(tz_name))
    return {
        "kind": kind,
        "generated_at": now.isoformat(),
        "as_of": f"{local:%a %b} {local.day}",
        "period": ctx.metric,
        "sections": sections,
        "errors": errors,
        "ai_summary": None,
    }


def generate_ai_summary(digest: dict) -> str | None:
    """Optional 3-4 sentence opener. Returns None on any failure (missing or
    invalid key, network, empty reply) — the digest is complete without it."""
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not key:
        return None
    try:
        from anthropic import Anthropic
        facts = json.dumps({"kind": digest["kind"], "period": digest["period"], **{k: v for k, v in digest["sections"].items() if v}}, default=str)
        msg = Anthropic(api_key=key).messages.create(
            model=AI_MODEL, max_tokens=350, system=_AI_SYSTEM,
            messages=[{"role": "user", "content": facts[:12000]}],
        )
        text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text").strip()
        return text or None
    except Exception as exc:
        logger.warning("Digest AI summary skipped: %s: %s", type(exc).__name__, exc)
        return None
