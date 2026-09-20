"""Digest rendering — structured digest dict → message text.

Two formats from one code path: 'html' (Telegram's HTML parse mode, every
dynamic value escaped) and 'text' (plain, for the in-app preview and history).
"""
import html

_ECON_NAMES = {"fomc": "FOMC", "cpi": "CPI", "ppi": "PPI", "jobs": "Jobs", "pce": "PCE", "gdp": "GDP"}


class _Fmt:
    def __init__(self, fmt):
        if fmt not in ("html", "text"):
            raise ValueError(f"unknown format {fmt!r}")
        self.html = fmt == "html"

    def esc(self, s):
        return html.escape(str(s)) if self.html else str(s)

    def b(self, s):
        return f"<b>{html.escape(str(s))}</b>" if self.html else str(s)


def _pct(v, digits=2):
    if v is None:
        return "n/a"
    if round(abs(v), digits) == 0:
        return f"{0:.{digits}f}%"      # flat: no arrow for a move that rounds to zero
    return f"{'▲' if v >= 0 else '▼'}{abs(v):.{digits}f}%"


def _money(v, signed=False):
    if v is None:
        return "n/a"
    sign = ("+" if v >= 0 else "-") if signed else ("-" if v < 0 else "")
    return f"{sign}${abs(v):,.0f}"


def _when(days):
    return "today" if days == 0 else "tomorrow" if days == 1 else f"in {days}d"


def _market_lines(m, f, period):
    lines = [f.b("Markets")]
    idx = "  ".join(f"{f.esc(i['name'])} {_pct(i['chg'])}" for i in m["indices"])
    if idx:
        lines.append(idx)
    extras = []
    if m.get("vix"):
        extras.append(f"VIX {m['vix']['price']:.1f} ({f.esc(m['vix']['label'])})")
    if m.get("tnx") is not None:
        extras.append(f"10Y {m['tnx']:.2f}%")
    if extras:
        lines.append(" · ".join(extras))
    if m["sectors_top"]:
        lines.append("Leaders: " + ", ".join(f"{f.esc(s['name'])} {_pct(s['chg'], 1)}" for s in m["sectors_top"]))
    if m["sectors_bottom"]:
        lines.append("Laggards: " + ", ".join(f"{f.esc(s['name'])} {_pct(s['chg'], 1)}" for s in m["sectors_bottom"]))
    return lines


def _portfolio_lines(p, f, period):
    # A morning digest runs before the open, so "today" would be wrong; the 1d
    # figure is the last completed session.
    label = "Last session" if period == "1d" else "Past 5 sessions"
    lines = [f.b("Your portfolio"), f"Value {_money(p['total_value'])}  ·  unrealized {_money(p['unrealized_pnl'], True)} ({_pct(p['unrealized_pct'], 1)})"]
    if p["period_pnl"] is not None:
        vs = f"  ·  {p['vs_spy']:+.2f} pts vs SPY" if p.get("vs_spy") is not None else ""
        lines.append(f"{label} {_money(p['period_pnl'], True)} ({_pct(p['period_pct'])}){vs}")
    if period == "1d" and p["movers"]:
        lines.append("Movers: " + ", ".join(f"{f.esc(h['symbol'])} {_pct(h['chg'], 1)} ({_money(h['pnl'], True)})" for h in p["movers"]))
    if period == "5d":
        if p["best"]:
            lines.append("Best: " + ", ".join(f"{f.esc(h['symbol'])} {_pct(h['chg'], 1)}" for h in p["best"]))
        if p["worst"]:
            lines.append("Worst: " + ", ".join(f"{f.esc(h['symbol'])} {_pct(h['chg'], 1)}" for h in p["worst"]))
    if p["unpriced"]:
        shown = ", ".join(f.esc(s) for s in p["unpriced"][:6])
        more = f" +{len(p['unpriced']) - 6} more" if len(p["unpriced"]) > 6 else ""
        lines.append(f"No live price (carried at cost): {shown}{more}")
    return lines


def _watchlist_lines(w, f, period):
    lines = [f.b("Watchlist movers")]
    if w["gainers"]:
        lines.append("Up: " + ", ".join(f"{f.esc(r['symbol'])} {_pct(r['chg'], 1)}" for r in w["gainers"]))
    if w["losers"]:
        lines.append("Down: " + ", ".join(f"{f.esc(r['symbol'])} {_pct(r['chg'], 1)}" for r in w["losers"]))
    if len(lines) == 1:
        lines.append("No significant moves.")
    return lines


def _events_lines(e, f, period):
    lines = [f.b("Coming up" if e["window_days"] > 2 else "Next few days")]
    for ev in e["economic"]:
        lines.append(f"• {f.esc(ev['event'])} — {_when(ev['daysUntil'])} ({f.esc(ev['date'])})")
    for er in e["earnings"]:
        eps = f", est. EPS {er['epsEstimate']:.2f}" if isinstance(er.get("epsEstimate"), (int, float)) else ""
        lines.append(f"• {f.esc(er['symbol'])} earnings — {_when(er['daysUntil'])} ({f.esc(er['date'])}){eps}{' · held' if er['held'] else ''}")
    if len(lines) == 1:
        lines.append("Nothing major on the calendar.")
    return lines


def _alerts_lines(a, f, period):
    lines = [f.b("Alerts")]
    for x in a["crossed"]:
        lines.append(f"• {f.esc(x['symbol'])} is {'above' if x['condition'] == 'above' else 'below'} your ${x['target']:,.2f} alert (now ${x['price']:,.2f}) — crossed while you were away")
    for x in a["near"]:
        lines.append(f"• {f.esc(x['symbol'])} is {x['gap_pct']:.1f}% from your ${x['target']:,.2f} alert (now ${x['price']:,.2f})")
    for x in a["triggered"]:
        lines.append(f"• {f.esc(x['symbol'])} alert triggered: {'above' if x['condition'] == 'above' else 'below'} ${x['target']:,.2f}")
    return lines


def _targets_lines(targets, f, period):
    lines = [f.b("Price targets")]
    for t in targets:
        side = f"{abs(t['gap_pct']):.1f}% {'below' if t['gap_pct'] > 0 else 'above'} target"
        dl = f", deadline {_when(t['days_left'])}" if t.get("days_left") is not None and t["days_left"] >= 0 else ""
        lines.append(f"• {f.esc(t['symbol'])} ${t['price']:,.2f} — {side} ${t['target']:,.2f}{dl}")
    return lines


_RENDERERS = [
    ("market", _market_lines), ("portfolio", _portfolio_lines), ("watchlist", _watchlist_lines),
    ("events", _events_lines), ("alerts", _alerts_lines), ("targets", _targets_lines),
]


def render(digest: dict, fmt: str = "text") -> str:
    """Render to 'html' (Telegram) or 'text'. Sections with no data are omitted;
    sections that failed to build are named in a closing footnote."""
    f = _Fmt(fmt)
    kind = digest["kind"]
    title = f"{'Daily' if kind == 'daily' else 'Weekly'} Digest — {digest['as_of']}"
    blocks = [[f.b(title)]]
    if digest.get("ai_summary"):
        blocks.append([f.esc(digest["ai_summary"])])
    for name, fn in _RENDERERS:
        data = digest["sections"].get(name)
        if data:
            blocks.append(fn(data, f, digest["period"]))
    if digest.get("errors"):
        blocks.append([f.esc("Unavailable right now: " + ", ".join(sorted(digest["errors"])))])
    return "\n\n".join("\n".join(b) for b in blocks)
