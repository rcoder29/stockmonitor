"""Fed Watch — Markets -> Fed Watch.

FOMC meeting-level cut/hold/hike probabilities derived from 30-day Fed
Funds futures (ZQ), plus a rate-history sparkline via the 13-week
T-bill proxy.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
import yfinance as yf
from fastapi import APIRouter

from database import cache_get, cache_set
from edgar_utils import _session

router = APIRouter()

# ── Fed Watch ─────────────────────────────────────────────────────────────────

_FEDWATCH_TTL = timedelta(minutes=30)

# FOMC meeting dates — 2025 + 2026 schedule (decision day)
_FOMC_MEETINGS = [
    {"date": "2025-01-29", "nickname": "Jan '25"},
    {"date": "2025-03-19", "nickname": "Mar '25"},
    {"date": "2025-05-07", "nickname": "May '25"},
    {"date": "2025-06-18", "nickname": "Jun '25"},
    {"date": "2025-07-30", "nickname": "Jul '25"},
    {"date": "2025-09-17", "nickname": "Sep '25"},
    {"date": "2025-10-29", "nickname": "Oct '25"},
    {"date": "2025-12-10", "nickname": "Dec '25"},
    {"date": "2026-01-28", "nickname": "Jan '26"},
    {"date": "2026-03-18", "nickname": "Mar '26"},
    {"date": "2026-04-29", "nickname": "Apr '26"},
    {"date": "2026-06-17", "nickname": "Jun '26"},
    {"date": "2026-07-29", "nickname": "Jul '26"},
    {"date": "2026-09-16", "nickname": "Sep '26"},
    {"date": "2026-10-28", "nickname": "Oct '26"},
    {"date": "2026-12-09", "nickname": "Dec '26"},
]

# 30-day Fed Funds futures (ZQ) — month code map
_ZQ_MONTHS = {
    1:"F",2:"G",3:"H",4:"J",5:"K",6:"M",7:"N",8:"Q",9:"U",10:"V",11:"X",12:"Z"
}

# Current Fed Funds target — derived from live ^IRX (13-week T-bill) at startup
def _fetch_current_fed_rate() -> tuple[float, float, float]:
    """Return (low, high, mid) for the current Fed Funds target range.
    Derived from the 13-week T-bill (^IRX), which tracks the fed funds rate closely.
    FOMC targets are always in 25bps increments (e.g. 3.75-4.00%)."""
    try:
        hist = yf.Ticker("^IRX", session=_session).history(period="5d")
        if not hist.empty:
            irx = float(hist["Close"].iloc[-1])
            # T-bills trade ~12-20bps below fed funds; add 15bps adjustment
            adjusted = irx + 0.15
            # Round down to nearest 25bps for the lower bound of the target range
            low = round(int(adjusted / 0.25) * 0.25, 2)
            high = round(low + 0.25, 2)
            mid = round((low + high) / 2, 4)
            return low, high, mid
    except Exception:
        pass
    return 3.75, 4.00, 3.875   # fallback

_FED_TARGET_LOW, _FED_TARGET_HIGH, _FED_TARGET_MID = _fetch_current_fed_rate()


def _zq_ticker(year: int, month: int) -> str:
    return f"ZQ{_ZQ_MONTHS[month]}{str(year)[-2:]}.CBT"


def _fetch_zq_rate(year: int, month: int) -> float | None:
    ticker = _zq_ticker(year, month)
    try:
        data = yf.Ticker(ticker, session=_session).history(period="5d")
        if data.empty:
            return None
        price = float(data["Close"].iloc[-1])
        return round(100.0 - price, 4)   # implied rate %
    except Exception:
        return None


@router.get("/api/market/fed-watch")
async def fed_watch():
    cache_key = "market:fed-watch"
    cached = cache_get(cache_key, _FEDWATCH_TTL)
    if cached is not None:
        return cached

    today = datetime.utcnow().date()

    # Fetch 30-day futures for next 8 months
    futures_data: dict[str, float | None] = {}
    month_keys = []
    for i in range(9):
        dt = today.replace(day=1)
        month = (dt.month - 1 + i) % 12 + 1
        year = dt.year + (dt.month - 1 + i) // 12
        key = f"{year}-{month:02d}"
        month_keys.append((year, month, key))

    with ThreadPoolExecutor(max_workers=9) as pool:
        futures_map = {pool.submit(_fetch_zq_rate, y, m): k for y, m, k in month_keys}
        for fut, key in futures_map.items():
            futures_data[key] = fut.result()

    # Build meeting-level probabilities
    meetings = []
    for mtg in _FOMC_MEETINGS:
        mtg_date = datetime.strptime(mtg["date"], "%Y-%m-%d").date()
        days_to = (mtg_date - today).days
        status = "past" if days_to < 0 else ("upcoming" if days_to <= 90 else "future")

        # Find the futures month that best captures this meeting
        key = f"{mtg_date.year}-{mtg_date.month:02d}"
        implied_rate = futures_data.get(key)

        cut_prob = hold_prob = hike_prob = None
        if implied_rate is not None:
            diff = _FED_TARGET_MID - implied_rate    # positive = market pricing cuts
            cut_prob  = max(0, min(100, round(diff / 0.25 * 100)))
            hike_prob = max(0, min(100, round(-diff / 0.25 * 100)))
            hold_prob = max(0, 100 - cut_prob - hike_prob)

        meetings.append({
            **mtg,
            "daysTo":      days_to,
            "status":      status,
            "impliedRate": implied_rate,
            "cutProb":     cut_prob,
            "holdProb":    hold_prob,
            "hikeProb":    hike_prob,
        })

    # Rate history — fetch EFFR proxy (^IRX = 13-week T-bill annualised / 100 * some scaling)
    rate_history = []
    try:
        hist = yf.Ticker("^IRX", session=_session).history(period="1y")
        if not hist.empty:
            hist = hist.resample("W").last().dropna()
            rate_history = [
                {"date": str(d.date()), "rate": round(float(v), 3)}
                for d, v in zip(hist.index, hist["Close"])
            ]
    except Exception:
        pass

    result = {
        "currentTarget":    f"{_FED_TARGET_LOW}%–{_FED_TARGET_HIGH}%",
        "currentMidpoint":  _FED_TARGET_MID,
        "meetings":         meetings,
        "rateHistory":      rate_history,
        "futuresData":      futures_data,
        "asOf":             today.isoformat(),
    }
    cache_set(cache_key, result)
    return result


