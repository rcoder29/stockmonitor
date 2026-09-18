"""Treasury Bonds — Research → Treasury Bonds.

Unlike corporate/convertible bonds, Treasury yields have a genuinely free,
no-API-key, official daily source: home.treasury.gov's own "Daily Treasury
Par Yield Curve Rates" CSV — the same data FRED's DGS* series are derived
from, straight from the source, published as one CSV per calendar year.
"""
import csv
import io
import logging
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter, HTTPException

from database import cache_get, cache_set
from edgar_utils import _session, _safe_float

logger = logging.getLogger(__name__)
router = APIRouter()

_TREASURY_MATURITIES = [
    {'key': '1mo',   'label': '1 Month',  'years': 1 / 12,  'col': '1 Mo'},
    {'key': '1.5mo', 'label': '6 Week',   'years': 1.5 / 12, 'col': '1.5 Month'},
    {'key': '2mo',   'label': '2 Month',  'years': 2 / 12,  'col': '2 Mo'},
    {'key': '3mo',   'label': '3 Month',  'years': 3 / 12,  'col': '3 Mo'},
    {'key': '4mo',   'label': '4 Month',  'years': 4 / 12,  'col': '4 Mo'},
    {'key': '6mo',   'label': '6 Month',  'years': 6 / 12,  'col': '6 Mo'},
    {'key': '1yr',   'label': '1 Year',   'years': 1,       'col': '1 Yr'},
    {'key': '2yr',   'label': '2 Year',   'years': 2,       'col': '2 Yr'},
    {'key': '3yr',   'label': '3 Year',   'years': 3,       'col': '3 Yr'},
    {'key': '5yr',   'label': '5 Year',   'years': 5,       'col': '5 Yr'},
    {'key': '7yr',   'label': '7 Year',   'years': 7,       'col': '7 Yr'},
    {'key': '10yr',  'label': '10 Year',  'years': 10,      'col': '10 Yr'},
    {'key': '20yr',  'label': '20 Year',  'years': 20,      'col': '20 Yr'},
    {'key': '30yr',  'label': '30 Year',  'years': 30,      'col': '30 Yr'},
]
_TREASURY_COL_TO_KEY  = {m['col']: m['key'] for m in _TREASURY_MATURITIES}
_TREASURY_KEY_TO_META = {m['key']: m for m in _TREASURY_MATURITIES}

_TREASURY_CSV_TTL_CURRENT = timedelta(hours=6)
_TREASURY_CSV_TTL_PAST    = timedelta(days=30)
_TREASURY_RANGE_YEARS = {'1m': 1, '6m': 1, '1y': 1, '5y': 5, '10y': 10, 'max': 35}


def _fetch_treasury_year_csv(year: int) -> list[dict]:
    """One calendar year of daily par yield curve rates, keyed by our internal
    maturity keys. Cached per year — past years never change; the current
    year gets a short TTL since today's row is added intraday/next morning."""
    cache_key = f'treasury_csv:{year}'
    ttl = _TREASURY_CSV_TTL_CURRENT if year == datetime.utcnow().year else _TREASURY_CSV_TTL_PAST
    cached = cache_get(cache_key, ttl)
    if cached is not None:
        return cached

    url = (
        "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
        f"daily-treasury-rates.csv/{year}/all?type=daily_treasury_yield_curve"
        f"&field_tdr_date_value={year}&page&_format=csv"
    )
    rows = []
    try:
        text = _session.get(url, timeout=20).text
        reader = csv.DictReader(io.StringIO(text))
        for row in reader:
            date_raw = row.get('Date')
            if not date_raw:
                continue
            try:
                iso_date = datetime.strptime(date_raw, '%m/%d/%Y').strftime('%Y-%m-%d')
            except ValueError:
                continue
            parsed = {'date': iso_date}
            for col, key in _TREASURY_COL_TO_KEY.items():
                val = row.get(col)
                parsed[key] = _safe_float(val) if val not in (None, '', 'N/A') else None
            rows.append(parsed)
    except Exception as exc:
        logger.warning('treasury csv %s: %s', year, exc)

    rows.sort(key=lambda r: r['date'])
    cache_set(cache_key, rows)
    return rows


def _fetch_treasury_rows(start_year: int, end_year: int) -> list[dict]:
    years = list(range(start_year, end_year + 1))
    with ThreadPoolExecutor(max_workers=min(8, len(years))) as pool:
        results = list(pool.map(_fetch_treasury_year_csv, years))
    rows = [r for yr_rows in results for r in yr_rows]
    rows.sort(key=lambda r: r['date'])
    return rows


@router.get('/api/treasury/current')
def treasury_current():
    """Latest available par yield for every tracked maturity, with the
    day-over-day change vs. the previous trading day."""
    cache_key = 'treasury_current'
    cached = cache_get(cache_key, _TREASURY_CSV_TTL_CURRENT)
    if cached is not None:
        return cached

    this_year = datetime.utcnow().year
    rows = _fetch_treasury_rows(this_year - 1, this_year)
    if not rows:
        result = {'date': None, 'prevDate': None, 'rates': []}
        cache_set(cache_key, result)
        return result

    latest, prev = rows[-1], (rows[-2] if len(rows) > 1 else None)
    rates = []
    for m in _TREASURY_MATURITIES:
        val = latest.get(m['key'])
        if val is None:
            continue
        prev_val = prev.get(m['key']) if prev else None
        rates.append({
            'key':    m['key'],
            'label':  m['label'],
            'years':  m['years'],
            'yield':  val,
            'change': round(val - prev_val, 3) if prev_val is not None else None,
        })

    # 2s10s — the classic recession-watch spread (10Y minus 2Y par yield).
    # Negative means the curve is inverted at that segment.
    y2, y10 = latest.get('2yr'), latest.get('10yr')
    spreads = []
    if y2 is not None and y10 is not None:
        spread_val = round(y10 - y2, 3)
        spreads.append({
            'key':      '2s10s',
            'label':    '2s10s (10Y − 2Y)',
            'value':    spread_val,
            'inverted': spread_val < 0,
        })

    result = {'date': latest['date'], 'prevDate': prev['date'] if prev else None, 'rates': rates, 'spreads': spreads}
    cache_set(cache_key, result)
    return result


@router.get('/api/treasury/history')
def treasury_history(maturity: str, rng: str = '1y'):
    """Historical yield series for one maturity, for trend charting."""
    maturity = maturity.lower().strip()
    if maturity not in _TREASURY_KEY_TO_META:
        raise HTTPException(400, f'Unknown maturity "{maturity}"')
    rng = rng.lower().strip()
    years_back = _TREASURY_RANGE_YEARS.get(rng, 1)

    cache_key = f'treasury_history:{maturity}:{rng}'
    cached = cache_get(cache_key, _TREASURY_CSV_TTL_CURRENT)
    if cached is not None:
        return cached

    this_year = datetime.utcnow().year
    rows = _fetch_treasury_rows(this_year - years_back, this_year)
    series = [{'date': r['date'], 'yield': r[maturity]} for r in rows if r.get(maturity) is not None]

    if rng == '1m':
        cutoff = (datetime.utcnow() - timedelta(days=31)).strftime('%Y-%m-%d')
        series = [s for s in series if s['date'] >= cutoff]
    elif rng == '6m':
        cutoff = (datetime.utcnow() - timedelta(days=183)).strftime('%Y-%m-%d')
        series = [s for s in series if s['date'] >= cutoff]

    meta = _TREASURY_KEY_TO_META[maturity]
    result = {'maturity': maturity, 'label': meta['label'], 'range': rng, 'series': series}
    cache_set(cache_key, result)
    return result


@router.get('/api/treasury/yield-curve')
def treasury_yield_curve():
    """Full yield curve (yield vs. maturity) for today, overlaid with the
    curve from ~1 month ago and ~1 year ago — the standard "how has the
    curve's shape shifted" view, e.g. watching an inversion resolve."""
    cache_key = 'treasury_yield_curve'
    cached = cache_get(cache_key, _TREASURY_CSV_TTL_CURRENT)
    if cached is not None:
        return cached

    this_year = datetime.utcnow().year
    rows = _fetch_treasury_rows(this_year - 1, this_year)
    if not rows:
        result = {'curves': []}
        cache_set(cache_key, result)
        return result

    latest = rows[-1]
    latest_date = datetime.strptime(latest['date'], '%Y-%m-%d')

    def _nearest_row_on_or_before(target: datetime):
        target_iso = target.strftime('%Y-%m-%d')
        candidates = [r for r in rows if r['date'] <= target_iso]
        return candidates[-1] if candidates else None

    month_ago = _nearest_row_on_or_before(latest_date - timedelta(days=30))
    year_ago  = _nearest_row_on_or_before(latest_date - timedelta(days=365))

    def _to_points(row):
        pts = []
        for m in _TREASURY_MATURITIES:
            v = row.get(m['key'])
            if v is not None:
                pts.append({'key': m['key'], 'label': m['label'], 'years': m['years'], 'yield': v})
        return pts

    curves = [{'label': 'Today', 'date': latest['date'], 'points': _to_points(latest)}]
    if month_ago and month_ago['date'] != latest['date']:
        curves.append({'label': '1 Month Ago', 'date': month_ago['date'], 'points': _to_points(month_ago)})
    if year_ago and year_ago['date'] not in (latest['date'], (month_ago or {}).get('date')):
        curves.append({'label': '1 Year Ago', 'date': year_ago['date'], 'points': _to_points(year_ago)})

    result = {'curves': curves}
    cache_set(cache_key, result)
    return result
