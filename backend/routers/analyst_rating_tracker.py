"""Analyst Rating Tracker — Research -> Analyst Ratings (multi-symbol tracker).

Consensus rating, price targets, and recent upgrade/downgrade history
with post-rating return tracking, across a list of symbols.

Cache key changed from "analyst:{symbol}" to "analyst_tracker:{symbol}"
during extraction — it used to collide with routers/analyst_ratings.py
(/api/analyst/{symbol}), a different, differently-shaped endpoint that
happened to use the exact same cache key, so whichever endpoint ran
first silently poisoned the cache for the other.
"""
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
import pandas as pd
import yfinance as yf
from fastapi import APIRouter

from database import cache_get, cache_set
from edgar_utils import _safe_float, _ANALYST_TTL

logger = logging.getLogger(__name__)
router = APIRouter()

_GRADE_POSITIVE = {
    'buy','strong buy','overweight','outperform','outperformer',
    'positive','accumulate','add','top pick','conviction buy',
    'sector outperform','market outperform',
}
_GRADE_NEGATIVE = {
    'sell','strong sell','underweight','underperform','underperformer',
    'negative','reduce','avoid','market underperform','sector underperform',
}

def _normalize_grade(grade: str | None) -> str:
    if not grade:
        return 'neutral'
    g = grade.lower().strip()
    if g in _GRADE_POSITIVE:
        return 'positive'
    if g in _GRADE_NEGATIVE:
        return 'negative'
    return 'neutral'


def _action_label(action: str) -> str:
    return {'up': 'Upgrade', 'down': 'Downgrade', 'init': 'Initiation',
            'reit': 'Reiteration', 'main': 'Maintained'}.get(str(action).lower(), action)


def _consensus_label(mean: float | None) -> str:
    if mean is None:
        return 'N/A'
    if mean <= 1.5: return 'Strong Buy'
    if mean <= 2.5: return 'Buy'
    if mean <= 3.5: return 'Hold'
    if mean <= 4.5: return 'Sell'
    return 'Strong Sell'


def _fetch_analyst_ratings(sym: str) -> dict | None:
    cache_key = f"analyst_tracker:{sym}"
    cached = cache_get(cache_key, _ANALYST_TTL)
    if cached:
        return cached
    try:
        t       = yf.Ticker(sym)
        info    = {}
        try:
            info = t.info or {}
        except Exception:
            pass

        name         = info.get('longName') or info.get('shortName') or sym
        cur_price    = _safe_float(info.get('currentPrice') or info.get('regularMarketPrice'))
        target_mean  = _safe_float(info.get('targetMeanPrice'))
        target_high  = _safe_float(info.get('targetHighPrice'))
        target_low   = _safe_float(info.get('targetLowPrice'))
        target_med   = _safe_float(info.get('targetMedianPrice'))
        rec_mean     = _safe_float(info.get('recommendationMean'))
        rec_key      = info.get('recommendationKey')
        analyst_cnt  = info.get('numberOfAnalystOpinions')

        upside_pct = None
        if cur_price and target_mean and cur_price > 0:
            upside_pct = round((target_mean / cur_price - 1) * 100, 1)

        # Price history for computing post-rating returns
        hist = None
        try:
            h = t.history(period='6mo')
            h.index = h.index.tz_localize(None) if h.index.tzinfo else h.index
            hist = h['Close'].dropna()
        except Exception:
            pass

        # Upgrades / downgrades
        recent_changes: list[dict] = []
        upgrade_ct = downgrade_ct = init_ct = reit_ct = 0
        cutoff = pd.Timestamp.now() - pd.Timedelta(days=90)

        try:
            ud = t.upgrades_downgrades
            if ud is not None and not ud.empty:
                ud.index = ud.index.tz_localize(None) if ud.index.tzinfo else ud.index
                recent = ud[ud.index >= cutoff].sort_index(ascending=False)

                for dt, row in recent.iterrows():
                    action     = str(row.get('Action', '')).lower()
                    from_grade = str(row.get('FromGrade', '')) or None
                    to_grade   = str(row.get('ToGrade', ''))   or None
                    firm       = str(row.get('Firm', ''))

                    if action == 'up':   upgrade_ct   += 1
                    elif action == 'down': downgrade_ct += 1
                    elif action == 'init': init_ct      += 1
                    elif action in ('reit', 'main'): reit_ct += 1

                    # Price at rating date and 5-day return afterward
                    price_at   = None
                    ret_5d     = None
                    ret_since  = None
                    if hist is not None:
                        idx = hist.index.searchsorted(dt, side='left')
                        if 0 <= idx < len(hist):
                            price_at = round(float(hist.iloc[idx]), 2)
                            # 5-day return
                            if idx + 5 < len(hist):
                                ret_5d = round((float(hist.iloc[idx + 5]) / price_at - 1) * 100, 2)
                            # Return since rating to now
                            if cur_price and price_at:
                                ret_since = round((cur_price / price_at - 1) * 100, 2)

                    recent_changes.append({
                        'date':      str(dt.date()),
                        'firm':      firm,
                        'action':    action,
                        'actionLabel': _action_label(action),
                        'fromGrade': from_grade,
                        'toGrade':   to_grade,
                        'sentiment': _normalize_grade(to_grade),
                        'priceAt':   price_at,
                        'ret5d':     ret_5d,
                        'retSince':  ret_since,
                    })
        except Exception as exc:
            logger.warning('analyst upgrades %s: %s', sym, exc)

        result = {
            'symbol':      sym,
            'name':        name,
            'currentPrice': cur_price,
            'consensus': {
                'rating':     rec_key,
                'label':      _consensus_label(rec_mean),
                'mean':       rec_mean,
                'count':      analyst_cnt,
                'targetMean': target_mean,
                'targetHigh': target_high,
                'targetLow':  target_low,
                'targetMed':  target_med,
                'upsidePct':  upside_pct,
            },
            'recentChanges': recent_changes,
            'summary': {
                'upgrades':   upgrade_ct,
                'downgrades': downgrade_ct,
                'initiations': init_ct,
                'reiterations': reit_ct,
                'netSentiment': upgrade_ct - downgrade_ct,
                'totalChanges': len(recent_changes),
            },
        }
        cache_set(cache_key, result)
        return result
    except Exception as exc:
        logger.warning('analyst ratings %s: %s', sym, exc)
        return None


@router.get('/api/market/analyst-ratings')
def get_analyst_ratings(symbols: str):
    syms = [s.strip().upper() for s in symbols.split(',') if s.strip()]
    if not syms:
        return []
    results: list[dict] = []
    with ThreadPoolExecutor(max_workers=min(len(syms), 6)) as pool:
        futures = {pool.submit(_fetch_analyst_ratings, sym): sym for sym in syms}
        for fut in as_completed(futures):
            r = fut.result()
            if r:
                results.append(r)
    results.sort(key=lambda x: -(x['summary'].get('totalChanges', 0)))
    return results


