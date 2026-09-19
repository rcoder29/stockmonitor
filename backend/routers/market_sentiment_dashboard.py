"""Market Sentiment Dashboard — Markets -> Sentiment.

A composite fear/greed score from VIX, put/call ratio, momentum,
breadth, junk-bond demand, and safe-haven demand.

Renamed _SENTIMENT_TTL -> _MARKET_SENTIMENT_TTL during extraction (see
routers/ai_news_sentiment.py docstring for why). This was the
definition that had been silently winning at runtime for all three
reused-name sections, since it's the last one assigned in the
original file — so this one alone keeps its original 30-minute value
unchanged.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import pandas as pd
import yfinance as yf
from fastapi import APIRouter

from database import cache_get, cache_set

router = APIRouter()

_MARKET_SENTIMENT_TTL = timedelta(minutes=30)


_SP500_SAMPLE = [
    'AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','JPM',
    'JNJ','V','UNH','HD','PG','MA','XOM','BAC','MRK',
    'ABBV','CVX','KO','PEP','COST','AVGO','WMT','LLY',
    'CSCO','MCD','TMO','CRM','NFLX',
]


def _score_label(score: float) -> str:
    if score <= 25: return "Extreme Fear"
    if score <= 45: return "Fear"
    if score <= 55: return "Neutral"
    if score <= 75: return "Greed"
    return "Extreme Greed"


def _vix_score(vix: float) -> float:
    """High VIX = fear = low score."""
    if vix <= 10:  return 95
    if vix <= 13:  return 85
    if vix <= 16:  return 72
    if vix <= 20:  return 55
    if vix <= 25:  return 40
    if vix <= 30:  return 28
    if vix <= 40:  return 15
    return 5


def _pc_score(ratio: float) -> float:
    """High put/call = fear = low score."""
    if ratio <= 0.40: return 95
    if ratio <= 0.55: return 80
    if ratio <= 0.70: return 62
    if ratio <= 0.85: return 50
    if ratio <= 1.00: return 38
    if ratio <= 1.20: return 25
    return 12


@router.get("/api/market/sentiment")
def get_market_sentiment():
    cache_key = "mkt_sentiment_v1"
    cached = cache_get(cache_key, _MARKET_SENTIMENT_TTL)
    if cached:
        return cached

    indicators: list[dict] = []
    fetch_errors: list[str] = []

    # ── 1. VIX ────────────────────────────────────────────────────────────────
    vix_score_val = None
    vix_data = {}
    try:
        vix_hist = yf.Ticker("^VIX").history(period="1y")
        vix_hist.index = vix_hist.index.tz_localize(None) if vix_hist.index.tzinfo else vix_hist.index
        vix_closes = vix_hist["Close"].dropna()
        cur_vix   = float(vix_closes.iloc[-1])
        ma50_vix  = float(vix_closes.iloc[-50:].mean())
        vs_ma_pct = round((cur_vix / ma50_vix - 1) * 100, 1)
        vix_score_val = _vix_score(cur_vix)

        # VIX term structure
        vix3m_cur = None
        try:
            v3h = yf.Ticker("^VIX3M").history(period="5d")
            if not v3h.empty:
                vix3m_cur = round(float(v3h["Close"].dropna().iloc[-1]), 2)
        except Exception:
            pass

        term_structure = None
        if vix3m_cur:
            term_structure = "contango" if cur_vix < vix3m_cur else "backwardation"

        # 90-day history for chart
        history_90 = [
            {"date": str(d.date()), "value": round(float(v), 2)}
            for d, v in zip(vix_closes.index[-90:], vix_closes.values[-90:])
        ]

        vix_data = {
            "current": round(cur_vix, 2),
            "ma50":    round(ma50_vix, 2),
            "vsMa50Pct": vs_ma_pct,
            "vix3m":   vix3m_cur,
            "termStructure": term_structure,
            "history": history_90,
        }
        indicators.append({
            "id": "vix", "name": "Market Volatility (VIX)",
            "score": round(vix_score_val),
            "label": _score_label(vix_score_val),
            "reading": f"{cur_vix:.1f}",
            "readingUnit": "pts",
            "context": f"VIX {'+' if vs_ma_pct >= 0 else ''}{vs_ma_pct}% vs 50d avg ({ma50_vix:.1f})"
                       + (f" · {term_structure}" if term_structure else ""),
            "extra": vix_data,
        })
    except Exception as e:
        fetch_errors.append(f"VIX: {e}")

    # ── 2. Put/Call Ratio ─────────────────────────────────────────────────────
    pc_score_val = None
    try:
        spy = yf.Ticker("SPY")
        exps = spy.options
        if exps:
            chain = spy.option_chain(exps[0])
            put_vol  = int(chain.puts["volume"].fillna(0).sum())
            call_vol = int(chain.calls["volume"].fillna(0).sum())
            pc_ratio = round(put_vol / call_vol, 3) if call_vol > 0 else None
            if pc_ratio is not None:
                pc_score_val = _pc_score(pc_ratio)
                indicators.append({
                    "id": "putCall", "name": "Put/Call Ratio",
                    "score": round(pc_score_val),
                    "label": _score_label(pc_score_val),
                    "reading": f"{pc_ratio:.2f}",
                    "readingUnit": "ratio",
                    "context": f"{put_vol:,} puts / {call_vol:,} calls on SPY ({exps[0]})",
                    "extra": {"ratio": pc_ratio, "putVol": put_vol, "callVol": call_vol, "expiry": exps[0]},
                })
    except Exception as e:
        fetch_errors.append(f"PutCall: {e}")

    # ── 3. Market Momentum (SPY vs 200MA + ROC) ────────────────────────────────
    momentum_score_val = None
    try:
        spy_hist = yf.Ticker("SPY").history(period="2y")
        spy_hist.index = spy_hist.index.tz_localize(None) if spy_hist.index.tzinfo else spy_hist.index
        spy_c = spy_hist["Close"].dropna()
        cur_spy  = float(spy_c.iloc[-1])
        ma200    = float(spy_c.iloc[-200:].mean())
        above200 = cur_spy > ma200
        pct_vs200 = round((cur_spy / ma200 - 1) * 100, 2)

        # 125-day rate of change
        roc125 = round((cur_spy / float(spy_c.iloc[-126]) - 1) * 100, 2) if len(spy_c) >= 126 else None

        if roc125 is not None:
            # Score: above 200MA baseline + ROC bonus
            base = 60 if above200 else 35
            roc_adj = max(-25, min(25, roc125 * 1.2))
            momentum_score_val = max(5, min(95, base + roc_adj))
        else:
            momentum_score_val = 60 if above200 else 35

        ret1m = round((cur_spy / float(spy_c.iloc[-21]) - 1) * 100, 2) if len(spy_c) >= 21 else None
        ret3m = round((cur_spy / float(spy_c.iloc[-63]) - 1) * 100, 2) if len(spy_c) >= 63 else None

        indicators.append({
            "id": "momentum", "name": "Market Momentum",
            "score": round(momentum_score_val),
            "label": _score_label(momentum_score_val),
            "reading": f"{'Above' if above200 else 'Below'} 200MA",
            "readingUnit": "",
            "context": f"SPY {'+' if pct_vs200 >= 0 else ''}{pct_vs200}% vs 200d MA"
                       + (f" · 125d ROC: {'+' if roc125 >= 0 else ''}{roc125}%" if roc125 is not None else ""),
            "extra": {"aboveMA200": above200, "pctVsMA200": pct_vs200, "roc125d": roc125,
                      "ret1m": ret1m, "ret3m": ret3m, "currentPrice": round(cur_spy, 2), "ma200": round(ma200, 2)},
        })
    except Exception as e:
        fetch_errors.append(f"Momentum: {e}")

    # ── 4. Market Breadth (% of S&P sample above 50MA) ────────────────────────
    breadth_score_val = None
    try:
        above_ma50: list[bool] = []

        def _check_above50(sym: str) -> bool | None:
            try:
                h = yf.Ticker(sym).history(period="3mo")
                if h.empty or len(h) < 52:
                    return None
                c = h["Close"].dropna()
                return float(c.iloc[-1]) > float(c.iloc[-50:].mean())
            except Exception:
                return None

        with ThreadPoolExecutor(max_workers=10) as pool:
            for result in pool.map(_check_above50, _SP500_SAMPLE):
                if result is not None:
                    above_ma50.append(result)

        if above_ma50:
            pct_above = round(sum(above_ma50) / len(above_ma50) * 100)
            breadth_score_val = pct_above  # 0-100 directly
            indicators.append({
                "id": "breadth", "name": "Market Breadth",
                "score": round(breadth_score_val),
                "label": _score_label(breadth_score_val),
                "reading": f"{pct_above}%",
                "readingUnit": "above 50MA",
                "context": f"{sum(above_ma50)}/{len(above_ma50)} of S&P sample stocks above their 50-day MA",
                "extra": {"pctAbove50MA": pct_above, "sampleSize": len(above_ma50), "aboveCount": sum(above_ma50)},
            })
    except Exception as e:
        fetch_errors.append(f"Breadth: {e}")

    # ── 5. Junk Bond Demand (HYG vs LQD) ──────────────────────────────────────
    credit_score_val = None
    try:
        def _etf_ret(sym, days):
            h = yf.Ticker(sym).history(period="3mo")
            c = h["Close"].dropna()
            if len(c) < days + 1:
                return None
            return round((float(c.iloc[-1]) / float(c.iloc[-days - 1]) - 1) * 100, 2)

        hyg_ret = _etf_ret("HYG", 21)
        lqd_ret = _etf_ret("LQD", 21)

        if hyg_ret is not None and lqd_ret is not None:
            spread = round(hyg_ret - lqd_ret, 2)
            # Positive spread = junk bonds outperforming = risk appetite = greed
            base = 50
            credit_score_val = max(5, min(95, base + spread * 6))
            indicators.append({
                "id": "credit", "name": "Junk Bond Demand",
                "score": round(credit_score_val),
                "label": _score_label(credit_score_val),
                "reading": f"{'+' if spread >= 0 else ''}{spread}%",
                "readingUnit": "HYG vs LQD",
                "context": f"HYG 1M: {'+' if hyg_ret >= 0 else ''}{hyg_ret}%  ·  LQD 1M: {'+' if lqd_ret >= 0 else ''}{lqd_ret}%"
                           + (" → Risk appetite elevated" if spread > 0.5 else " → Credit stress" if spread < -0.5 else ""),
                "extra": {"hygRet1m": hyg_ret, "lqdRet1m": lqd_ret, "spread": spread},
            })
    except Exception as e:
        fetch_errors.append(f"Credit: {e}")

    # ── 6. Safe Haven Demand (SPY vs TLT) ─────────────────────────────────────
    safe_haven_score_val = None
    try:
        def _ret21(sym):
            h = yf.Ticker(sym).history(period="2mo")
            c = h["Close"].dropna()
            if len(c) < 22:
                return None
            return round((float(c.iloc[-1]) / float(c.iloc[-22]) - 1) * 100, 2)

        spy_ret = _ret21("SPY")
        tlt_ret = _ret21("TLT")
        gld_ret = _ret21("GLD")

        if spy_ret is not None and tlt_ret is not None:
            spread = round(spy_ret - tlt_ret, 2)
            # Stocks outperforming bonds = greed; bonds outperforming = fear
            safe_haven_score_val = max(5, min(95, 50 + spread * 2.5))
            context = f"SPY 1M: {'+' if spy_ret >= 0 else ''}{spy_ret}%  ·  TLT 1M: {'+' if tlt_ret >= 0 else ''}{tlt_ret}%"
            if gld_ret is not None:
                context += f"  ·  GLD 1M: {'+' if gld_ret >= 0 else ''}{gld_ret}%"
            if spread > 3:
                context += " → Stocks dominating bonds"
            elif spread < -3:
                context += " → Flight to safety"

            indicators.append({
                "id": "safeHaven", "name": "Safe Haven Demand",
                "score": round(safe_haven_score_val),
                "label": _score_label(safe_haven_score_val),
                "reading": f"{'Stocks' if spread >= 0 else 'Bonds'} leading",
                "readingUnit": "",
                "context": context,
                "extra": {"spyRet1m": spy_ret, "tltRet1m": tlt_ret, "gldRet1m": gld_ret, "spread": spread},
            })
    except Exception as e:
        fetch_errors.append(f"SafeHaven: {e}")

    # ── Overall score ──────────────────────────────────────────────────────────
    scored = [ind for ind in indicators if ind.get("score") is not None]
    overall = round(sum(ind["score"] for ind in scored) / len(scored)) if scored else 50

    result = {
        "timestamp":    pd.Timestamp.now().isoformat()[:19],
        "overallScore": overall,
        "overallLabel": _score_label(overall),
        "indicators":   indicators,
        "errors":       fetch_errors,
        "vixHistory":   vix_data.get("history", []),
    }
    cache_set(cache_key, result)
    return result

