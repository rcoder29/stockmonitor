"""Watchlist — sidebar symbol list + named sub-watchlists (groups).

CRUD over WatchlistSymbol (the "default" list) and WatchlistGroup (named
sub-lists).
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from database import db_session, WatchlistSymbol, WatchlistGroup

router = APIRouter()

# ── Watchlist ─────────────────────────────────────────────────────────────────

class SymbolIn(BaseModel):
    symbol: str
    list:   str = "default"


@router.get("/api/watchlists")
def list_watchlists():
    """Return all watchlist names with symbol counts."""
    with db_session() as db:
        default_count = db.query(WatchlistSymbol).count()
        groups = db.query(WatchlistGroup.list_name).distinct().all()
    names = ["default"] + [g[0] for g in groups if g[0] != "default"]
    result = [{"name": "default", "count": default_count}]
    with db_session() as db:
        for name in names[1:]:
            cnt = db.query(WatchlistGroup).filter(WatchlistGroup.list_name == name).count()
            result.append({"name": name, "count": cnt})
    return result


@router.post("/api/watchlists", status_code=201)
def create_watchlist(body: dict):
    name = (body.get("name") or "").strip()
    if not name or name == "default":
        raise HTTPException(400, "Invalid list name")
    return {"name": name}


@router.delete("/api/watchlists/{name}", status_code=204)
def delete_watchlist(name: str):
    if name == "default":
        raise HTTPException(400, "Cannot delete default watchlist")
    with db_session() as db:
        db.query(WatchlistGroup).filter(WatchlistGroup.list_name == name).delete()


@router.get("/api/watchlist")
def get_watchlist(list: str = "default"):
    if list == "default":
        with db_session() as db:
            rows = db.query(WatchlistSymbol).order_by(WatchlistSymbol.added_at).all()
            return [r.symbol for r in rows]
    with db_session() as db:
        rows = db.query(WatchlistGroup).filter(WatchlistGroup.list_name == list).order_by(WatchlistGroup.added_at).all()
        return [r.symbol for r in rows]


@router.post("/api/watchlist", status_code=201)
def add_to_watchlist(body: SymbolIn):
    sym = body.symbol.strip().upper()
    if not sym:
        raise HTTPException(400, "Symbol required")
    list_name = body.list or "default"
    if list_name == "default":
        with db_session() as db:
            if not db.query(WatchlistSymbol).filter(WatchlistSymbol.symbol == sym).first():
                db.add(WatchlistSymbol(symbol=sym))
    else:
        with db_session() as db:
            if not db.query(WatchlistGroup).filter(WatchlistGroup.list_name == list_name, WatchlistGroup.symbol == sym).first():
                db.add(WatchlistGroup(list_name=list_name, symbol=sym))
    return {"symbol": sym}


@router.delete("/api/watchlist/{symbol}", status_code=204)
def remove_from_watchlist(symbol: str, list: str = "default"):
    symbol = symbol.upper()
    if list == "default":
        with db_session() as db:
            row = db.query(WatchlistSymbol).filter(WatchlistSymbol.symbol == symbol).first()
            if row:
                db.delete(row)
    else:
        with db_session() as db:
            row = db.query(WatchlistGroup).filter(WatchlistGroup.list_name == list, WatchlistGroup.symbol == symbol).first()
            if row:
                db.delete(row)
