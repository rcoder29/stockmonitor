"""Trade Journal — Portfolio → Trade Journal.

Log every trade by symbol/side/price/shares/strategy, with realized P&L
matched FIFO and a win-rate breakdown by strategy.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from database import db_session, TradeJournalEntry

router = APIRouter()

# ── Trade Journal ─────────────────────────────────────────────────────────────

class JournalEntryIn(BaseModel):
    symbol:     str
    side:       str       # 'buy' | 'sell'
    price:      float
    shares:     float
    strategy:   str | None = None
    trade_date: str       # YYYY-MM-DD
    notes:      str | None = None


def _entry_dict(e) -> dict:
    return {
        "id": e.id, "symbol": e.symbol, "side": e.side,
        "price": e.price, "shares": e.shares, "strategy": e.strategy,
        "trade_date": e.trade_date, "notes": e.notes,
    }


@router.get("/api/journal")
def list_journal():
    with db_session() as db:
        entries = (
            db.query(TradeJournalEntry)
            .order_by(TradeJournalEntry.trade_date.desc(), TradeJournalEntry.created_at.desc())
            .all()
        )
        return [_entry_dict(e) for e in entries]


@router.post("/api/journal", status_code=201)
def add_journal_entry(body: JournalEntryIn):
    with db_session() as db:
        e = TradeJournalEntry(
            symbol=body.symbol.upper(), side=body.side,
            price=body.price, shares=body.shares,
            strategy=body.strategy, trade_date=body.trade_date, notes=body.notes,
        )
        db.add(e)
        db.flush()
        return _entry_dict(e)


@router.delete("/api/journal/{entry_id}", status_code=204)
def delete_journal_entry(entry_id: int):
    with db_session() as db:
        e = db.query(TradeJournalEntry).filter(TradeJournalEntry.id == entry_id).first()
        if not e:
            raise HTTPException(404, "Not found")
        db.delete(e)


@router.get("/api/journal/stats")
def get_journal_stats():
    from collections import defaultdict
    with db_session() as db:
        entries = (
            db.query(TradeJournalEntry)
            .order_by(TradeJournalEntry.trade_date, TradeJournalEntry.created_at)
            .all()
        )
    if not entries:
        return {"totalPnl": 0, "winRate": None, "tradeCount": 0, "closedTrades": 0,
                "wins": 0, "losses": 0, "byStrategy": {}}

    buys = defaultdict(list)  # symbol -> [[price, remaining_shares]]
    closed = []

    for e in entries:
        if e.side == "buy":
            buys[e.symbol].append([e.price, e.shares])
        elif e.side == "sell":
            remaining = e.shares
            realized  = 0.0
            q = buys[e.symbol]
            while remaining > 1e-9 and q:
                bp, bq = q[0]
                matched = min(remaining, bq)
                realized  += matched * (e.price - bp)
                q[0][1]   -= matched
                remaining -= matched
                if q[0][1] < 1e-9:
                    q.pop(0)
            closed.append({"strategy": e.strategy or "Other", "pnl": round(realized, 2)})

    total_pnl = round(sum(t["pnl"] for t in closed), 2)
    wins   = sum(1 for t in closed if t["pnl"] > 0)
    losses = sum(1 for t in closed if t["pnl"] < 0)

    by_strat = defaultdict(lambda: {"pnl": 0.0, "wins": 0, "losses": 0, "trades": 0})
    for t in closed:
        s = t["strategy"]
        by_strat[s]["pnl"]    = round(by_strat[s]["pnl"] + t["pnl"], 2)
        by_strat[s]["trades"] += 1
        if t["pnl"] > 0: by_strat[s]["wins"]   += 1
        elif t["pnl"] < 0: by_strat[s]["losses"] += 1

    return {
        "totalPnl": total_pnl,
        "winRate":  round(wins / len(closed) * 100, 1) if closed else None,
        "tradeCount": len(entries), "closedTrades": len(closed),
        "wins": wins, "losses": losses,
        "byStrategy": dict(by_strat),
    }

