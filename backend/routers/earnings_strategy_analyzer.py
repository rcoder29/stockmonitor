"""Earnings Strategy Analyzer — Research -> Earnings Strategy.

Backtests four rules-based earnings-window strategies (pre-earnings run,
buy-the-beat, buy-the-dip, hold-through) against historical price
reactions and picks the best-performing one per symbol.
"""
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import timedelta
import pandas as pd
import yfinance as yf
from fastapi import APIRouter, HTTPException

from database import cache_get, cache_set
from edgar_utils import _safe_float

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Earnings Strategy Analyzer ───────────────────────────────────────────────

_EARN_STRAT_TTL = timedelta(hours=6)


def _nearest_trading_idx(price_idx: pd.DatetimeIndex, target: pd.Timestamp, after: bool = False) -> int | None:
    if after:
        pos = price_idx.searchsorted(target, side="left")
    else:
        pos = price_idx.searchsorted(target, side="right") - 1
    if 0 <= pos < len(price_idx):
        return int(pos)
    return None


def _period_ret(closes: pd.Series, start_idx: int, offset: int) -> float | None:
    end_idx = start_idx + offset
    if start_idx < 0 or end_idx < 0 or end_idx >= len(closes):
        return None
    s = float(closes.iloc[start_idx])
    e = float(closes.iloc[end_idx])
    return round((e / s - 1) * 100, 2) if s else None


def _analyze_earnings_strategy(sym: str) -> dict | None:
    cache_key = f"earnstrat:{sym}"
    cached = cache_get(cache_key, _EARN_STRAT_TTL)
    if cached:
        return cached

    try:
        t = yf.Ticker(sym)

        hist = t.history(period="3y")
        if hist.empty or len(hist) < 60:
            return None
        hist.index = hist.index.tz_localize(None) if hist.index.tzinfo else hist.index
        closes = hist["Close"].dropna()
        price_idx = closes.index

        info = {}
        try:
            info = t.info or {}
        except Exception:
            pass
        name   = info.get("longName") or info.get("shortName") or sym
        sector = info.get("sector")
        try:
            cur_price = float(closes.iloc[-1])
        except Exception:
            cur_price = None

        # Next earnings date
        next_earn_date = None
        days_to_earn   = None
        try:
            cal = t.calendar
            if cal is not None:
                if isinstance(cal, dict):
                    ed = cal.get("Earnings Date")
                    if isinstance(ed, (list, tuple)) and len(ed) > 0:
                        next_earn_date = str(ed[0])[:10]
                    elif ed is not None:
                        next_earn_date = str(ed)[:10]
                elif hasattr(cal, "iloc"):
                    try:
                        ed_row = cal.loc["Earnings Date"] if "Earnings Date" in cal.index else None
                        if ed_row is not None:
                            next_earn_date = str(ed_row.iloc[0])[:10]
                    except Exception:
                        pass
        except Exception:
            pass

        if next_earn_date:
            try:
                ndt = pd.Timestamp(next_earn_date)
                days_to_earn = (ndt - pd.Timestamp.now()).days
            except Exception:
                pass

        # EPS history
        eps_history: list[dict] = []
        try:
            eh = t.earnings_history
            if eh is not None and not eh.empty:
                for idx_val, row in eh.iterrows():
                    try:
                        dt  = pd.Timestamp(idx_val).normalize()
                        est = _safe_float(row.get("epsEstimate"))
                        act = _safe_float(row.get("epsActual"))
                        beat = (act >= est) if (est is not None and act is not None) else None
                        surp = round((act - est) / abs(est) * 100, 2) if (est and act and abs(est) > 1e-6) else None
                        eps_history.append({"date": str(dt.date()), "epsEstimate": est, "epsActual": act, "beat": beat, "surprisePct": surp})
                    except Exception:
                        pass
        except Exception:
            pass

        eps_history.sort(key=lambda x: x["date"], reverse=True)

        events: list[dict] = []
        for ep in eps_history:
            try:
                earn_dt = pd.Timestamp(ep["date"])
                ei = _nearest_trading_idx(price_idx, earn_dt, after=True)
                if ei is None or ei < 22:
                    continue
                pre1_idx    = ei - 1
                pre5d       = _period_ret(closes, pre1_idx - 4,  4)
                pre10d      = _period_ret(closes, pre1_idx - 9,  9)
                pre20d      = _period_ret(closes, pre1_idx - 19, 19)
                earn_react  = _period_ret(closes, pre1_idx,      2)   # day-before to day-after
                post_ref    = ei + 1
                if post_ref >= len(closes):
                    continue
                post1d      = _period_ret(closes, post_ref, 1)
                post5d      = _period_ret(closes, post_ref, 5)
                post10d     = _period_ret(closes, post_ref, 10)
                events.append({**ep, "pre5d": pre5d, "pre10d": pre10d, "pre20d": pre20d,
                                "earningsReaction": earn_react, "post1d": post1d,
                                "post5d": post5d, "post10d": post10d})
            except Exception:
                continue

        if len(events) < 3:
            return None

        def _strat_stats(returns: list) -> dict:
            if not returns:
                return {"n": 0, "winRate": None, "avgReturn": None, "bestReturn": None,
                        "worstReturn": None, "signal": "INSUFFICIENT_DATA", "expectedValue": None}
            wins  = sum(1 for r in returns if r > 0)
            n     = len(returns)
            avg   = round(sum(returns) / n, 2)
            wr    = round(wins / n * 100)
            ev    = round(wr / 100 * avg, 2)
            if n < 3:
                signal = "INSUFFICIENT_DATA"
            elif wr >= 70 and avg >= 2.0:
                signal = "STRONG_BUY"
            elif wr >= 60 and avg >= 1.0:
                signal = "BUY"
            elif wr <= 35 or avg <= -1.5:
                signal = "AVOID"
            elif wr <= 45 or avg <= 0:
                signal = "WEAK"
            else:
                signal = "NEUTRAL"
            return {"n": n, "winRate": wr, "avgReturn": avg,
                    "bestReturn": round(max(returns), 2), "worstReturn": round(min(returns), 2),
                    "signal": signal, "expectedValue": ev}

        pre10_rets = [e["pre10d"]  for e in events if e["pre10d"]  is not None]
        s_pre = _strat_stats(pre10_rets)
        s_pre["name"] = "Pre-Earnings Run"
        s_pre["description"] = "Enter 10 trading days before earnings, exit 1 day before. Captures the pre-earnings run-up without holding through the announcement."

        beat_post10 = [e["post10d"] for e in events if e["beat"] is True and e["post10d"] is not None]
        s_beat = _strat_stats(beat_post10)
        s_beat["name"] = "Buy the Beat"
        s_beat["description"] = "Enter 1 day after earnings ONLY on an EPS beat, hold 10 days. Captures post-beat continuation momentum."

        dip_post10 = [e["post10d"] for e in events if e.get("earningsReaction") is not None and e["earningsReaction"] < -3 and e["post10d"] is not None]
        s_dip = _strat_stats(dip_post10)
        s_dip["name"] = "Buy the Dip"
        s_dip["description"] = "Enter 1 day after earnings when stock dropped ≥3% on the announcement, hold 10 days. Mean-reversion play on over-reaction selling."

        hold_rets = []
        for e in events:
            if e["pre5d"] is not None and e["post5d"] is not None:
                total = round(e["pre5d"] + e["post5d"] * (1 + e["pre5d"] / 100), 2)
                hold_rets.append(total)
        s_hold = _strat_stats(hold_rets)
        s_hold["name"] = "Hold Through Earnings"
        s_hold["description"] = "Enter 5 days before, hold through announcement, exit 5 days after. Full earnings-window exposure."

        strategies = {"preRun": s_pre, "buyTheBeat": s_beat, "buyTheDip": s_dip, "holdThrough": s_hold}

        best_k = max(
            ["preRun", "buyTheBeat", "buyTheDip", "holdThrough"],
            key=lambda k: (strategies[k].get("expectedValue") or -99) if (strategies[k].get("n") or 0) >= 3 else -99
        )

        beats_with_data = [e for e in events if e["beat"] is not None]
        beat_rate  = round(sum(1 for e in beats_with_data if e["beat"]) / len(beats_with_data) * 100) if beats_with_data else None
        abs_moves  = [abs(e["earningsReaction"]) for e in events if e["earningsReaction"] is not None]
        avg_abs_move = round(sum(abs_moves) / len(abs_moves), 2) if abs_moves else None
        avg_pre10    = round(sum(pre10_rets) / len(pre10_rets), 2) if pre10_rets else None

        result = {
            "symbol": sym, "name": name, "sector": sector, "currentPrice": cur_price,
            "nextEarningsDate": next_earn_date, "daysToEarnings": days_to_earn,
            "events": events, "strategies": strategies, "bestStrategy": best_k,
            "beatRate": beat_rate, "avgAbsMove": avg_abs_move, "avgPre10d": avg_pre10,
            "totalEvents": len(events),
        }
        cache_set(cache_key, result)
        return result
    except Exception as exc:
        logger.warning("Earnings strategy %s: %s", sym, exc)
        return None


@router.get("/api/market/earnings-strategy")
def get_earnings_strategy(symbol: str):
    sym = symbol.strip().upper()
    result = _analyze_earnings_strategy(sym)
    if result is None:
        raise HTTPException(404, f"Insufficient earnings history for {sym}")
    return result


@router.get("/api/market/earnings-strategy-scan")
def get_earnings_strategy_scan(symbols: str):
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not syms:
        return []
    results: list[dict] = []
    with ThreadPoolExecutor(max_workers=min(len(syms), 6)) as pool:
        futures = {pool.submit(_analyze_earnings_strategy, sym): sym for sym in syms}
        for fut in as_completed(futures):
            r = fut.result()
            if r:
                strats = r.get("strategies", {})
                best_k = r.get("bestStrategy", "preRun")
                best_s = strats.get(best_k, {})
                results.append({
                    "symbol": r["symbol"], "name": r["name"], "sector": r["sector"],
                    "currentPrice": r["currentPrice"],
                    "nextEarningsDate": r.get("nextEarningsDate"),
                    "daysToEarnings":   r.get("daysToEarnings"),
                    "beatRate":         r.get("beatRate"),
                    "avgAbsMove":       r.get("avgAbsMove"),
                    "avgPre10d":        r.get("avgPre10d"),
                    "bestStrategy":     best_k,
                    "bestSignal":       best_s.get("signal"),
                    "bestWinRate":      best_s.get("winRate"),
                    "bestAvgReturn":    best_s.get("avgReturn"),
                    "totalEvents":      r.get("totalEvents"),
                })
    results.sort(key=lambda x: (x.get("daysToEarnings") or 9999))
    return results



