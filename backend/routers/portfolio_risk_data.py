"""Portfolio Risk Data — SPY volatility + risk-free rate estimate, used by
client-side risk calculators (e.g. Sharpe ratio inputs)."""
import logging
from fastapi import APIRouter
import yfinance as yf

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Portfolio Risk Data ───────────────────────────────────────────────────────

@router.get("/api/market/risk-data")
def get_risk_data():
    """Return SPY 90-day volatility and current risk-free rate estimate."""
    try:
        spy = yf.Ticker("SPY")
        hist = spy.history(period="3mo")
        daily_returns = hist["Close"].pct_change().dropna()
        daily_vol    = float(daily_returns.std())
        annual_vol   = daily_vol * (252 ** 0.5)
        spy_1yr_ret  = float((hist["Close"].iloc[-1] / hist["Close"].iloc[0]) - 1) if len(hist) > 1 else 0.0
        return {
            "spy_daily_vol":  daily_vol,
            "spy_annual_vol": annual_vol,
            "spy_1yr_return": spy_1yr_ret,
            "risk_free_rate": 0.045,   # ~4.5% — approximate 3-mo T-bill
            "error": None,
        }
    except Exception as e:
        logger.warning("risk-data fallback: %s", e)
        return {
            "spy_daily_vol":  0.0095,
            "spy_annual_vol": 0.155,
            "spy_1yr_return": 0.12,
            "risk_free_rate": 0.045,
            "error": str(e),
        }

