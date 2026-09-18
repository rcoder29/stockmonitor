"""13D/13G Activist Tracker — Research → Activist Tracker.

Scans EDGAR for Schedule 13D (activist / control-intent) and 13G (passive)
beneficial ownership filings — new 5%+ stakes and amendments to existing
ones. 13D is filed by investors who may seek to influence the company and
is far lower-volume/higher-signal than 13G, which is dominated by routine
index-fund threshold crossings.
"""
import logging
import urllib.parse
from datetime import timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from fastapi import APIRouter
import pandas as pd

from database import cache_get, cache_set
from edgar_utils import _edgar_req, _TICKER_RE, _fetch_opp_quote

logger = logging.getLogger(__name__)
router = APIRouter()

# ── 13D/13G Activist Tracker ───────────────────────────────────────────────────

_ACTIVIST_TTL = timedelta(hours=4)
_ACTIVIST_FORMS = (
    ('SCHEDULE 13D', 'Activist (13D)'),
    ('SCHEDULE 13G', 'Institutional/Passive (13G)'),
)


@router.get('/api/activist/tracker')
def activist_tracker(days: int = 30):
    """Scan EDGAR for Schedule 13D (activist / control-intent) and 13G (passive)
    beneficial ownership filings -- new 5%+ stakes and amendments to existing
    ones. 13D is filed by investors who may seek to influence the company and
    is far lower-volume/higher-signal than 13G, which is dominated by routine
    index-fund threshold crossings."""
    cache_key = f'activist_tracker_{days}'
    cached = cache_get(cache_key, _ACTIVIST_TTL)
    if cached:
        return cached

    from datetime import date as _date
    today_str = _date.today().strftime('%Y-%m-%d')
    cutoff = (_date.today() - pd.Timedelta(days=days)).strftime('%Y-%m-%d')

    raw = {}
    for form_token, category in _ACTIVIST_FORMS:
        try:
            url = (
                f"https://efts.sec.gov/LATEST/search-index"
                f"?q=&forms={urllib.parse.quote(form_token)}"
                f"&dateRange=custom&startdt={cutoff}&enddt={today_str}"
            )
            resp = _edgar_req(url).json()
            hits = resp.get('hits', {}).get('hits', [])
            for h in hits[:60]:
                src = h.get('_source', {})
                acc = src.get('adsh') or h.get('_id', '').split(':')[0]
                if acc in raw:
                    continue
                display_names   = src.get('display_names') or []
                subject_display = display_names[0] if len(display_names) > 0 else ''
                filer_display    = display_names[1] if len(display_names) > 1 else ''
                m = _TICKER_RE.search(subject_display)
                ticker       = m.group(1).split(',')[0].strip() if m else None
                company_name = subject_display.split('  (')[0].strip() if subject_display else ''
                filer_name   = filer_display.split('  (')[0].strip() if filer_display else ''
                form = src.get('form', form_token)
                raw[acc] = {
                    'accession':   acc,
                    'ticker':      ticker,
                    'companyName': company_name,
                    'filerName':   filer_name,
                    'formType':    form,
                    'category':    category,
                    'isAmendment': '/A' in form,
                    'fileDate':    src.get('file_date', ''),
                    'cik':         (src.get('ciks') or [''])[0],
                    'edgarUrl':    f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&filenum=&State=0&SIC=&dateb=&owner=include&count=1&search_text=&accession={acc.replace('-', '')}",
                }
        except Exception as exc:
            logger.warning('activist tracker %s: %s', form_token, exc)

    results = list(raw.values())

    tickers = sorted({r['ticker'] for r in results if r['ticker']})
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

    for r in results:
        q = quotes.get(r['ticker'], {}) if r['ticker'] else {}
        r['currentPrice']  = q.get('currentPrice')
        r['priceChange5d'] = q.get('priceChange5d')

    results.sort(key=lambda r: r.get('fileDate', ''), reverse=True)
    cache_set(cache_key, results)
    return results

