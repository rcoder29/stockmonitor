"""Options Strategy Builder — Chart Modal (Options tab, strategy suggestions).

Suggests common single/multi-leg strategies (Long Call/Put, Bull/Bear
spreads, Straddle, Cash-Secured Put) from the nearest options expiry,
keyed off the caller's directional view.
"""
import asyncio
import logging
from datetime import timedelta
from fastapi import APIRouter, HTTPException
import yfinance as yf

from database import cache_get, cache_set
from edgar_utils import _session

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Options Strategy Builder ───────────────────────────────────────────────────

_STRATEGY_TTL = timedelta(hours=1)


def _compute_strategies(symbol: str, view: str) -> dict:
    cache_key = f"strategies:{symbol}:{view}"
    cached = cache_get(cache_key, _STRATEGY_TTL)
    if cached is not None:
        return cached

    try:
        t    = yf.Ticker(symbol, session=_session)
        info = t.fast_info
        price = float(info.last_price)
        if not price:
            raise ValueError("no price")

        exps = t.options
        if not exps:
            raise ValueError("no options")
        expiry = exps[0]
        chain  = t.option_chain(expiry)
        calls  = chain.calls
        puts   = chain.puts

        def nearest_strike(df, target):
            idx = (df["strike"] - target).abs().idxmin()
            return df.loc[idx]

        def next_strike_above(df, target):
            above = df[df["strike"] > target]
            return above.iloc[0] if not above.empty else None

        def next_strike_below(df, target):
            below = df[df["strike"] < target]
            return below.iloc[-1] if not below.empty else None

        atm_call = nearest_strike(calls, price)
        atm_put  = nearest_strike(puts,  price)
        atm_strike = float(atm_call["strike"])

        otm_call = next_strike_above(calls, atm_strike)
        otm_put  = next_strike_below(puts,  atm_strike)

        def mid(row):
            b, a = float(row.get("bid", 0) or 0), float(row.get("ask", 0) or 0)
            lp   = float(row.get("lastPrice", 0) or 0)
            return round((b + a) / 2 if a > b > 0 else lp, 2)

        strategies = []

        if view in ("bullish", "neutral"):
            # Long Call
            c_mid = mid(atm_call)
            strategies.append({
                "name": "Long Call",
                "legs": [{"type": "call", "strike": atm_strike, "action": "buy", "cost": c_mid}],
                "max_profit": "unlimited",
                "max_loss": round(c_mid * 100, 2),
                "breakeven": round(atm_strike + c_mid, 2),
                "cost_debit": round(c_mid * 100, 2),
                "pop_pct": round(float(atm_call.get("inTheMoney", False)) * 0 + (1 - float(atm_call.get("delta", 0.5) or 0.5)) * 100, 1),
            })

        if view == "bullish" and otm_call is not None:
            # Bull Call Spread
            buy_cost  = mid(atm_call)
            sell_cost = mid(otm_call)
            net_debit = round(buy_cost - sell_cost, 2)
            width     = round(float(otm_call["strike"]) - atm_strike, 2)
            strategies.append({
                "name": "Bull Call Spread",
                "legs": [
                    {"type": "call", "strike": atm_strike, "action": "buy",  "cost": buy_cost},
                    {"type": "call", "strike": float(otm_call["strike"]), "action": "sell", "cost": sell_cost},
                ],
                "max_profit": round((width - net_debit) * 100, 2),
                "max_loss":   round(net_debit * 100, 2),
                "breakeven":  round(atm_strike + net_debit, 2),
                "cost_debit": round(net_debit * 100, 2),
                "pop_pct":    None,
            })

        if view in ("bearish", "neutral"):
            # Long Put
            p_mid = mid(atm_put)
            strategies.append({
                "name": "Long Put",
                "legs": [{"type": "put", "strike": atm_strike, "action": "buy", "cost": p_mid}],
                "max_profit": round((atm_strike - p_mid) * 100, 2),
                "max_loss":   round(p_mid * 100, 2),
                "breakeven":  round(atm_strike - p_mid, 2),
                "cost_debit": round(p_mid * 100, 2),
                "pop_pct":    None,
            })

        if view == "bearish" and otm_put is not None:
            # Bear Put Spread
            buy_cost  = mid(atm_put)
            sell_cost = mid(otm_put)
            net_debit = round(buy_cost - sell_cost, 2)
            width     = round(atm_strike - float(otm_put["strike"]), 2)
            strategies.append({
                "name": "Bear Put Spread",
                "legs": [
                    {"type": "put", "strike": atm_strike, "action": "buy",  "cost": buy_cost},
                    {"type": "put", "strike": float(otm_put["strike"]), "action": "sell", "cost": sell_cost},
                ],
                "max_profit": round((width - net_debit) * 100, 2),
                "max_loss":   round(net_debit * 100, 2),
                "breakeven":  round(atm_strike - net_debit, 2),
                "cost_debit": round(net_debit * 100, 2),
                "pop_pct":    None,
            })

        if view == "neutral":
            # Long Straddle
            c_mid = mid(atm_call)
            p_mid = mid(atm_put)
            total = round(c_mid + p_mid, 2)
            strategies.append({
                "name": "Long Straddle",
                "legs": [
                    {"type": "call", "strike": atm_strike, "action": "buy", "cost": c_mid},
                    {"type": "put",  "strike": atm_strike, "action": "buy", "cost": p_mid},
                ],
                "max_profit": "unlimited",
                "max_loss":   round(total * 100, 2),
                "breakeven":  f"${round(atm_strike - total, 2)} / ${round(atm_strike + total, 2)}",
                "cost_debit": round(total * 100, 2),
                "pop_pct":    None,
            })

        if view in ("bullish", "neutral"):
            # Cash-Secured Put (sell ATM put)
            p_mid = mid(atm_put)
            strategies.append({
                "name": "Cash-Secured Put",
                "legs": [{"type": "put", "strike": atm_strike, "action": "sell", "cost": p_mid}],
                "max_profit": round(p_mid * 100, 2),
                "max_loss":   round((atm_strike - p_mid) * 100, 2),
                "breakeven":  round(atm_strike - p_mid, 2),
                "cost_debit": round(-p_mid * 100, 2),
                "pop_pct":    None,
            })

        result = {
            "symbol": symbol,
            "price":  round(price, 2),
            "expiry": expiry,
            "view":   view,
            "strategies": strategies,
        }
        cache_set(cache_key, result)
        return result
    except Exception as e:
        logger.warning("strategies failed for %s: %s", symbol, e)
        raise HTTPException(500, f"Strategy computation failed: {e}")


@router.get("/api/options/strategies/{symbol}")
async def get_options_strategies(symbol: str, view: str = "bullish"):
    sym = symbol.upper().strip()
    if view not in ("bullish", "bearish", "neutral"):
        raise HTTPException(400, "view must be bullish, bearish, or neutral")
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, lambda: _compute_strategies(sym, view))


