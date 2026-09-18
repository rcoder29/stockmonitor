"""Reddit Trending Stocks — Markets → Reddit Trending.

Most-mentioned tickers on Reddit's finance subreddits, via ApeWisdom's free
public aggregation API (Reddit itself blocks unauthenticated scraping).
ApeWisdom doesn't classify bullish/bearish sentiment — only mention volume
and rank vs. 24h ago — so this surfaces attention momentum (rising/cooling
chatter), not a long/short call.
"""
import html
import logging
from datetime import timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from fastapi import APIRouter

from database import cache_get, cache_set
from edgar_utils import _session, _fetch_opp_quote

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Reddit Trending Stocks ──────────────────────────────────────────────────────

_REDDIT_TTL = timedelta(minutes=30)
_REDDIT_FILTERS = {
    'all-stocks':      'All Stocks',
    'wallstreetbets':  'r/wallstreetbets',
    'stocks':          'r/stocks',
    'options':         'r/options',
}


@router.get('/api/reddit/trending')
def reddit_trending(source: str = 'all-stocks', limit: int = 75):
    """Most-mentioned tickers on Reddit's finance subreddits, via ApeWisdom's
    free public aggregation API (Reddit itself blocks unauthenticated scraping).
    ApeWisdom doesn't classify bullish/bearish sentiment -- only mention volume
    and rank vs. 24h ago -- so this surfaces attention momentum (rising/cooling
    chatter), not a long/short call."""
    if source not in _REDDIT_FILTERS:
        source = 'all-stocks'
    limit = max(1, min(limit, 200))

    cache_key = f'reddit_trending_{source}_{limit}'
    cached = cache_get(cache_key, _REDDIT_TTL)
    if cached:
        return cached

    raw = []
    try:
        page = 1
        while len(raw) < limit and page <= 3:
            resp = _session.get(f"https://apewisdom.io/api/v1.0/filter/{source}/page/{page}", timeout=15).json()
            batch = resp.get('results', [])
            if not batch:
                break
            raw.extend(batch)
            if page >= resp.get('pages', 1):
                break
            page += 1
    except Exception as exc:
        logger.warning('reddit trending: %s', exc)
        return []

    raw = raw[:limit]

    rows = []
    for r in raw:
        mentions      = r.get('mentions', 0) or 0
        mentions_prev = r.get('mentions_24h_ago', 0) or 0
        rank          = r.get('rank')
        rank_prev     = r.get('rank_24h_ago')
        mentions_change_pct = round((mentions - mentions_prev) / mentions_prev * 100, 1) if mentions_prev else None
        rank_change = (rank_prev - rank) if (rank is not None and rank_prev is not None) else None
        rows.append({
            'rank':               rank,
            'ticker':             r.get('ticker'),
            'name':               html.unescape(r.get('name', '') or ''),
            'mentions':           mentions,
            'mentionsPrev':       mentions_prev,
            'mentionsChangePct':  mentions_change_pct,
            'upvotes':            r.get('upvotes'),
            'rankPrev':           rank_prev,
            'rankChange':         rank_change,
        })

    tickers = sorted({r['ticker'] for r in rows if r['ticker']})
    quotes = {}
    if tickers:
        with ThreadPoolExecutor(max_workers=min(len(tickers), 10)) as pool:
            futures = {pool.submit(_fetch_opp_quote, t): t for t in tickers}
            for fut in as_completed(futures):
                t = futures[fut]
                try:
                    quotes[t] = fut.result()
                except Exception:
                    pass

    for r in rows:
        q = quotes.get(r['ticker'], {}) if r['ticker'] else {}
        r['currentPrice']   = q.get('currentPrice')
        r['priceChange5d']  = q.get('priceChange5d')
        r['priceChange1mo'] = q.get('priceChange1mo')

    cache_set(cache_key, rows)
    return rows

