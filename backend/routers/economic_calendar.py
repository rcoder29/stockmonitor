"""Economic Calendar — Markets → Macro Calendar.

Hand-maintained schedule of high-impact economic events (FOMC, CPI, PPI,
jobs, PCE, GDP), filtered to a -7..+120 day window.
"""
from datetime import datetime
from fastapi import APIRouter

router = APIRouter()

# ── Economic Calendar ─────────────────────────────────────────────────────────

_ECON_EVENTS = [
    # FOMC decisions — 2026
    {"date": "2026-06-17", "event": "FOMC Rate Decision",  "type": "fomc", "description": "Federal Reserve interest rate decision and press conference"},
    {"date": "2026-07-29", "event": "FOMC Rate Decision",  "type": "fomc", "description": "Federal Reserve interest rate decision"},
    {"date": "2026-09-16", "event": "FOMC Rate Decision",  "type": "fomc", "description": "Federal Reserve interest rate decision and press conference"},
    {"date": "2026-10-28", "event": "FOMC Rate Decision",  "type": "fomc", "description": "Federal Reserve interest rate decision"},
    {"date": "2026-12-09", "event": "FOMC Rate Decision",  "type": "fomc", "description": "Federal Reserve interest rate decision and press conference"},
    # CPI — approximate BLS release schedule
    {"date": "2026-06-10", "event": "CPI Release",          "type": "cpi",  "description": "Consumer Price Index — May 2026"},
    {"date": "2026-07-14", "event": "CPI Release",          "type": "cpi",  "description": "Consumer Price Index — June 2026"},
    {"date": "2026-08-12", "event": "CPI Release",          "type": "cpi",  "description": "Consumer Price Index — July 2026"},
    {"date": "2026-09-10", "event": "CPI Release",          "type": "cpi",  "description": "Consumer Price Index — August 2026"},
    {"date": "2026-10-13", "event": "CPI Release",          "type": "cpi",  "description": "Consumer Price Index — September 2026"},
    # PPI
    {"date": "2026-06-11", "event": "PPI Release",          "type": "ppi",  "description": "Producer Price Index — May 2026"},
    {"date": "2026-07-15", "event": "PPI Release",          "type": "ppi",  "description": "Producer Price Index — June 2026"},
    {"date": "2026-08-13", "event": "PPI Release",          "type": "ppi",  "description": "Producer Price Index — July 2026"},
    {"date": "2026-09-11", "event": "PPI Release",          "type": "ppi",  "description": "Producer Price Index — August 2026"},
    # Jobs reports — first Friday of month
    {"date": "2026-06-05", "event": "Jobs Report",          "type": "jobs", "description": "Non-Farm Payrolls — May 2026"},
    {"date": "2026-07-02", "event": "Jobs Report",          "type": "jobs", "description": "Non-Farm Payrolls — June 2026"},
    {"date": "2026-08-07", "event": "Jobs Report",          "type": "jobs", "description": "Non-Farm Payrolls — July 2026"},
    {"date": "2026-09-04", "event": "Jobs Report",          "type": "jobs", "description": "Non-Farm Payrolls — August 2026"},
    {"date": "2026-10-02", "event": "Jobs Report",          "type": "jobs", "description": "Non-Farm Payrolls — September 2026"},
    # PCE inflation
    {"date": "2026-05-29", "event": "PCE Inflation",        "type": "pce",  "description": "Personal Consumption Expenditures — April 2026"},
    {"date": "2026-06-26", "event": "PCE Inflation",        "type": "pce",  "description": "Personal Consumption Expenditures — May 2026"},
    {"date": "2026-07-31", "event": "PCE Inflation",        "type": "pce",  "description": "Personal Consumption Expenditures — June 2026"},
    {"date": "2026-08-28", "event": "PCE Inflation",        "type": "pce",  "description": "Personal Consumption Expenditures — July 2026"},
    # GDP advance estimates
    {"date": "2026-06-25", "event": "GDP (Advance)",        "type": "gdp",  "description": "Q1 2026 GDP advance estimate"},
    {"date": "2026-09-25", "event": "GDP (Advance)",        "type": "gdp",  "description": "Q2 2026 GDP advance estimate"},
]


@router.get("/api/market/economic-calendar")
def get_economic_calendar():
    today = datetime.utcnow().date()
    events = []
    for e in _ECON_EVENTS:
        ev_date = datetime.strptime(e["date"], "%Y-%m-%d").date()
        days_until = (ev_date - today).days
        if -7 <= days_until <= 120:
            events.append({**e, "daysUntil": days_until})
    return sorted(events, key=lambda x: x["daysUntil"])

