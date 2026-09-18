"""CSV Export / Import — Portfolio (export/import buttons), Trade Journal (export)."""
import csv
import io
from fastapi import APIRouter
from fastapi.responses import Response
from pydantic import BaseModel

from database import db_session, PortfolioPosition, TradeJournalEntry

router = APIRouter()

# ── CSV Export / Import ───────────────────────────────────────────────────────

@router.get("/api/portfolio/export")
def export_portfolio():
    with db_session() as db:
        positions = db.query(PortfolioPosition).order_by(PortfolioPosition.symbol).all()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Symbol", "Shares", "Avg Cost"])
    for p in positions:
        w.writerow([p.symbol, p.shares, p.avg_cost])
    return Response(content=buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": "attachment; filename=portfolio.csv"})


class CSVImportBody(BaseModel):
    csv_data: str


@router.post("/api/portfolio/import")
def import_portfolio(body: CSVImportBody):
    reader = csv.DictReader(io.StringIO(body.csv_data))
    imported = 0
    errors = []
    for i, row in enumerate(reader):
        try:
            sym    = (row.get("Symbol") or row.get("symbol") or "").strip().upper()
            shares = float(row.get("Shares") or row.get("shares") or row.get("Quantity") or 0)
            cost   = float(row.get("Avg Cost") or row.get("avg_cost") or row.get("Average Price") or row.get("Cost Basis") or 0)
            if not sym or shares <= 0:
                continue
            with db_session() as db:
                existing = db.query(PortfolioPosition).filter(PortfolioPosition.symbol == sym).first()
                if existing:
                    existing.shares = shares; existing.avg_cost = cost
                else:
                    db.add(PortfolioPosition(symbol=sym, shares=shares, avg_cost=cost))
            imported += 1
        except Exception as e:
            errors.append(f"Row {i+1}: {e}")
    return {"imported": imported, "errors": errors}


@router.get("/api/journal/export")
def export_journal():
    with db_session() as db:
        entries = db.query(TradeJournalEntry).order_by(TradeJournalEntry.trade_date.desc()).all()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Date", "Symbol", "Side", "Price", "Shares", "Strategy", "Notes"])
    for e in entries:
        w.writerow([e.trade_date, e.symbol, e.side, e.price, e.shares, e.strategy or "", e.notes or ""])
    return Response(content=buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": "attachment; filename=trade_journal.csv"})

