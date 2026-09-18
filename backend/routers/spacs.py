"""SPACs — SPACs → Overview / Tracker / Discovery / Deal Analyzer / Portfolio
/ Alerts / Risk Matrix.
"""
import json
import logging
import urllib.parse
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import pandas as pd
import yfinance as yf

from database import cache_get, cache_set, db_session, SpacDeal, SpacPosition, SpacAlertRule
from edgar_utils import _edgar_req, _safe_float, _TICKER_RE
# SPAC discovery reuses Merger Arb's EDGAR-search cache TTL (same 4h cadence,
# same underlying full-text-search endpoint) — kept as one shared constant
# rather than a second copy that could drift out of sync.
from routers.merger_arb import _MERGER_EDGAR_TTL

logger = logging.getLogger(__name__)
router = APIRouter()


_SPAC_STATUSES = {
    'searching':         'Searching for Target',
    'deal_announced':    'Deal Announced',
    'shareholder_vote':  'Pending Shareholder Vote',
    'redemption_period': 'Redemption Period',
    'closing':           'Closing',
    'completed':         'Completed (De-SPAC)',
    'liquidated':        'Liquidated',
}


class SpacDealCreate(BaseModel):
    ticker:                str
    company_name:          str = ''
    sponsor:                str = ''
    warrant_ticker:         str = ''
    warrant_strike:         float = 11.5
    warrant_ratio:          float = 0.5
    ipo_date:               str = ''
    trust_value_per_share:  float = 10.0
    trust_value_date:       str = ''
    deadline_date:          str = ''
    status:                 str = 'searching'
    target_name:            str = ''
    deal_announce_date:     str = ''
    pipe_amount_mn:         float | None = None
    notes:                  str = ''
    source:                 str = 'manual'
    edgar_accession:        str = ''


def _enrich_spac(deal: SpacDeal) -> dict:
    """Add live price, discount/premium to trust, annualized capture yield to
    deadline, and warrant metrics to a tracked SPAC."""
    from datetime import date as _date
    today = _date.today()

    row = {
        'id':                 deal.id,
        'ticker':             deal.ticker.upper(),
        'companyName':        deal.company_name or deal.ticker.upper(),
        'sponsor':            deal.sponsor,
        'warrantTicker':      deal.warrant_ticker.upper() if deal.warrant_ticker else '',
        'warrantStrike':      deal.warrant_strike,
        'warrantRatio':       deal.warrant_ratio,
        'ipoDate':            deal.ipo_date,
        'trustValuePerShare': deal.trust_value_per_share,
        'trustValueDate':     deal.trust_value_date,
        'deadlineDate':       deal.deadline_date,
        'status':             deal.status,
        'statusLabel':        _SPAC_STATUSES.get(deal.status, deal.status),
        'targetName':         deal.target_name,
        'dealAnnounceDate':   deal.deal_announce_date,
        'pipeAmountMn':       deal.pipe_amount_mn,
        'notes':              deal.notes,
        'source':             deal.source,
        'edgarAccession':     deal.edgar_accession,
        'currentPrice':       None,
        'discountPct':        None,
        'captureYieldPct':    None,
        'daysToDeadline':     None,
        'annualizedYieldPct': None,
        'warrantPrice':       None,
        'warrantIntrinsic':   None,
        'warrantBreakeven':   None,
    }

    days_to_deadline = None
    if deal.deadline_date:
        try:
            dl = datetime.strptime(deal.deadline_date, '%Y-%m-%d').date()
            days_to_deadline = (dl - today).days
            row['daysToDeadline'] = days_to_deadline
        except ValueError:
            pass

    try:
        fi = yf.Ticker(deal.ticker).fast_info
        price = _safe_float(getattr(fi, 'last_price', None))
        if price:
            row['currentPrice'] = round(price, 2)
            if deal.trust_value_per_share:
                # Discount/premium to trust: standard SPAC-arb framing, relative to trust.
                row['discountPct'] = round((price - deal.trust_value_per_share) / deal.trust_value_per_share * 100, 2)
                # Capture yield: return on your actual cost basis if you buy now and
                # redeem for trust value at the deadline (the arb trade's floor).
                capture = (deal.trust_value_per_share - price) / price * 100
                row['captureYieldPct'] = round(capture, 2)
                if days_to_deadline and days_to_deadline > 0:
                    row['annualizedYieldPct'] = round(capture / days_to_deadline * 365, 1)
    except Exception:
        pass

    if deal.warrant_ticker:
        try:
            wfi = yf.Ticker(deal.warrant_ticker).fast_info
            wprice = _safe_float(getattr(wfi, 'last_price', None))
            if wprice:
                row['warrantPrice'] = round(wprice, 2)
                if row['currentPrice'] is not None:
                    row['warrantIntrinsic'] = round(max(0, row['currentPrice'] - deal.warrant_strike) * deal.warrant_ratio, 2)
                if deal.warrant_ratio:
                    row['warrantBreakeven'] = round(deal.warrant_strike + wprice / deal.warrant_ratio, 2)
        except Exception:
            pass

    return row


@router.get('/api/spac/deals')
def get_spac_deals(include_completed: bool = False):
    with db_session() as db:
        q = db.query(SpacDeal)
        if not include_completed:
            q = q.filter(SpacDeal.status.notin_(['completed', 'liquidated']))
        deals = q.order_by(SpacDeal.created_at.desc()).all()

    if not deals:
        return []

    results = []
    with ThreadPoolExecutor(max_workers=min(len(deals), 8)) as pool:
        futures = {pool.submit(_enrich_spac, d): d for d in deals}
        for fut in as_completed(futures):
            try:
                results.append(fut.result())
            except Exception as exc:
                logger.warning('enrich spac: %s', exc)

    results.sort(key=lambda r: r.get('annualizedYieldPct') if r.get('annualizedYieldPct') is not None else -999, reverse=True)
    return results


@router.post('/api/spac/deals')
def create_spac_deal(body: SpacDealCreate):
    with db_session() as db:
        deal = SpacDeal(
            ticker                = body.ticker.strip().upper(),
            company_name          = body.company_name.strip(),
            sponsor                = body.sponsor.strip(),
            warrant_ticker         = body.warrant_ticker.strip().upper(),
            warrant_strike         = body.warrant_strike,
            warrant_ratio          = body.warrant_ratio,
            ipo_date               = body.ipo_date,
            trust_value_per_share  = body.trust_value_per_share,
            trust_value_date       = body.trust_value_date,
            deadline_date          = body.deadline_date,
            status                 = body.status,
            target_name            = body.target_name.strip(),
            deal_announce_date     = body.deal_announce_date,
            pipe_amount_mn         = body.pipe_amount_mn,
            notes                  = body.notes.strip(),
            source                 = body.source,
            edgar_accession        = body.edgar_accession,
        )
        db.add(deal)
        db.flush()
        return {'id': deal.id}


@router.put('/api/spac/deals/{deal_id}')
def update_spac_deal(deal_id: int, body: SpacDealCreate):
    with db_session() as db:
        deal = db.query(SpacDeal).filter(SpacDeal.id == deal_id).first()
        if not deal:
            raise HTTPException(404, 'SPAC not found')
        deal.ticker                = body.ticker.strip().upper()
        deal.company_name          = body.company_name.strip()
        deal.sponsor                = body.sponsor.strip()
        deal.warrant_ticker         = body.warrant_ticker.strip().upper()
        deal.warrant_strike         = body.warrant_strike
        deal.warrant_ratio          = body.warrant_ratio
        deal.ipo_date               = body.ipo_date
        deal.trust_value_per_share  = body.trust_value_per_share
        deal.trust_value_date       = body.trust_value_date
        deal.deadline_date          = body.deadline_date
        deal.status                 = body.status
        deal.target_name            = body.target_name.strip()
        deal.deal_announce_date     = body.deal_announce_date
        deal.pipe_amount_mn         = body.pipe_amount_mn
        deal.notes                  = body.notes.strip()
        return {'ok': True}


@router.delete('/api/spac/deals/{deal_id}')
def delete_spac_deal(deal_id: int):
    with db_session() as db:
        deal = db.query(SpacDeal).filter(SpacDeal.id == deal_id).first()
        if not deal:
            raise HTTPException(404, 'SPAC not found')
        db.delete(deal)
    return {'ok': True}


_SPAC_DISCOVERY_QUERIES = (
    ('S-1',     'blank check',   'New SPAC IPO'),
    ('425',     'trust account', 'De-SPAC Announcement'),
    ('DEFM14A', 'trust account', 'De-SPAC Merger Proxy'),
    ('S-4',     'trust account', 'De-SPAC Registration'),
)


def _parse_spac_tickers(display_name: str) -> tuple[str | None, str | None]:
    """SPAC filings list common/units/warrant tickers together, e.g.
    'Compass Digital Acquisition Corp. (CDAQF, CDAUF, CDAWF)'. Units conventionally
    end in U, warrants in W; whatever's left is the common ticker."""
    m = _TICKER_RE.search(display_name)
    if not m:
        return None, None
    tickers = [t.strip() for t in m.group(1).split(',')]
    warrant = next((t for t in tickers if t.endswith('W') and len(t) > 1), None)
    units   = next((t for t in tickers if t.endswith('U') and len(t) > 1), None)
    common  = next((t for t in tickers if t not in (warrant, units)), tickers[0] if tickers else None)
    return common, warrant


def _fetch_spac_quote(ticker: str) -> dict:
    try:
        fi = yf.Ticker(ticker).fast_info
        price = _safe_float(getattr(fi, 'last_price', None))
        return {'currentPrice': round(price, 2)} if price else {}
    except Exception:
        return {}


@router.get('/api/spac/discovery')
def spac_discovery():
    """Scan EDGAR for new SPAC IPO filings (S-1 mentioning 'blank check') and
    de-SPAC merger announcements (425 / DEFM14A / S-4 mentioning 'trust account')."""
    cache_key = 'spac_discovery_scan'
    cached = cache_get(cache_key, _MERGER_EDGAR_TTL)
    if cached:
        return cached

    from datetime import date as _date
    today_str = _date.today().strftime('%Y-%m-%d')
    cutoff = (_date.today() - pd.Timedelta(days=60)).strftime('%Y-%m-%d')

    raw = {}
    for form, keyword, label in _SPAC_DISCOVERY_QUERIES:
        try:
            q = urllib.parse.quote(f'"{keyword}"')
            url = (
                f"https://efts.sec.gov/LATEST/search-index"
                f"?q={q}&forms={form.replace(' ', '+')}"
                f"&dateRange=custom&startdt={cutoff}&enddt={today_str}"
            )
            resp = _edgar_req(url).json()
            hits = resp.get('hits', {}).get('hits', [])
            for h in hits[:30]:
                src = h.get('_source', {})
                acc = src.get('adsh') or h.get('_id', '').split(':')[0]
                if acc in raw:
                    continue
                display = (src.get('display_names') or [''])[0]
                common, warrant = _parse_spac_tickers(display)
                name = display.split('  (')[0].strip() if display else src.get('entity_name', '')
                raw[acc] = {
                    'accession':     acc,
                    'ticker':        common,
                    'warrantTicker': warrant,
                    'companyName':   name,
                    'formType':      src.get('form', form),
                    'category':      label,
                    'fileDate':      src.get('file_date', ''),
                    'cik':           (src.get('ciks') or [''])[0],
                    'edgarUrl':      f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&filenum=&State=0&SIC=&dateb=&owner=include&count=1&search_text=&accession={acc.replace('-', '')}",
                }
        except Exception as exc:
            logger.warning('spac discovery %s: %s', form, exc)

    results = list(raw.values())

    tickers = sorted({r['ticker'] for r in results if r['ticker']})
    quotes = {}
    if tickers:
        with ThreadPoolExecutor(max_workers=min(len(tickers), 10)) as pool:
            futures = {pool.submit(_fetch_spac_quote, t): t for t in tickers}
            for fut in as_completed(futures):
                t = futures[fut]
                try:
                    quotes[t] = fut.result()
                except Exception:
                    pass

    with db_session() as db:
        tracked_tickers = {t.upper() for (t,) in db.query(SpacDeal.ticker).all()}

    for r in results:
        q = quotes.get(r['ticker'], {}) if r['ticker'] else {}
        r['currentPrice'] = q.get('currentPrice')
        r['tracked'] = bool(r['ticker'] and r['ticker'].upper() in tracked_tickers)

    results.sort(key=lambda r: r.get('fileDate', ''), reverse=True)
    cache_set(cache_key, results)
    return results


@router.get('/api/spac/analyze')
def analyze_spac(
    deal_id:                int | None = None,
    ticker:                 str | None = None,
    trust_value_per_share:  float | None = None,
    trust_value_date:       str = '',
    deadline_date:          str = '',
    status:                 str = 'searching',
    target_name:            str = '',
    warrant_ticker:         str = '',
    warrant_strike:         float = 11.5,
    warrant_ratio:          float = 0.5,
):
    """SPAC arb analysis: discount/premium to trust, capture yield if held to
    redemption/deadline, warrant economics, and a redeem-vs-hold scenario table
    spanning weak-aftermarket through strong post-deal outcomes."""
    if deal_id is not None:
        with db_session() as db:
            deal = db.query(SpacDeal).filter(SpacDeal.id == deal_id).first()
            if not deal:
                raise HTTPException(404, 'SPAC not found')
            ticker                = deal.ticker
            trust_value_per_share = deal.trust_value_per_share
            trust_value_date      = deal.trust_value_date
            deadline_date         = deal.deadline_date
            status                = deal.status
            target_name           = deal.target_name
            warrant_ticker        = deal.warrant_ticker
            warrant_strike        = deal.warrant_strike
            warrant_ratio         = deal.warrant_ratio

    if not ticker or not trust_value_per_share:
        raise HTTPException(400, 'ticker and trust_value_per_share are required')

    ticker = ticker.strip().upper()
    from datetime import date as _date
    today = _date.today()

    current_price = None
    try:
        fi = yf.Ticker(ticker).fast_info
        current_price = _safe_float(getattr(fi, 'last_price', None))
    except Exception:
        pass

    days_to_deadline = None
    if deadline_date:
        try:
            days_to_deadline = (datetime.strptime(deadline_date, '%Y-%m-%d').date() - today).days
        except ValueError:
            pass

    discount_pct = capture_yield_pct = annualized_yield_pct = None
    if current_price:
        discount_pct = round((current_price - trust_value_per_share) / trust_value_per_share * 100, 2)
        capture_yield_pct = round((trust_value_per_share - current_price) / current_price * 100, 2)
        if days_to_deadline and days_to_deadline > 0:
            annualized_yield_pct = round(capture_yield_pct / days_to_deadline * 365, 1)

    warrant_ticker = (warrant_ticker or '').strip().upper()
    warrant_price = warrant_intrinsic = warrant_breakeven = warrant_time_value = None
    if warrant_ticker:
        try:
            wfi = yf.Ticker(warrant_ticker).fast_info
            wprice = _safe_float(getattr(wfi, 'last_price', None))
            if wprice:
                warrant_price = round(wprice, 2)
                if current_price is not None:
                    warrant_intrinsic = round(max(0, current_price - warrant_strike) * warrant_ratio, 2)
                    warrant_time_value = round(warrant_price - warrant_intrinsic, 2)
                if warrant_ratio:
                    warrant_breakeven = round(warrant_strike + warrant_price / warrant_ratio, 2)
        except Exception:
            pass

    scenarios = []
    if current_price:
        scenario_defs = [
            ('Redeem / deal closes flat to trust',           trust_value_per_share),
            ('Deal closes, weak aftermarket (-20% to trust)', trust_value_per_share * 0.8),
            ('Deal closes, +25% to trust',                    trust_value_per_share * 1.25),
            ('Deal closes, +50% to trust',                    trust_value_per_share * 1.5),
            ('Deal closes, +100% to trust',                   trust_value_per_share * 2.0),
            ('Deal closes, +200% to trust',                   trust_value_per_share * 3.0),
        ]
        for label, price in scenario_defs:
            row = {
                'label':     label,
                'price':     round(price, 2),
                'returnPct': round((price - current_price) / current_price * 100, 1),
            }
            if warrant_price:
                w_val = max(0, price - warrant_strike) * warrant_ratio
                row['warrantValue']     = round(w_val, 2)
                row['warrantReturnPct'] = round((w_val - warrant_price) / warrant_price * 100, 1)
            scenarios.append(row)

    return {
        'ticker':              ticker,
        'currentPrice':        current_price,
        'trustValuePerShare':  trust_value_per_share,
        'trustValueDate':      trust_value_date,
        'deadlineDate':        deadline_date,
        'daysToDeadline':      days_to_deadline,
        'status':              status,
        'statusLabel':         _SPAC_STATUSES.get(status, status),
        'targetName':          target_name,
        'discountPct':         discount_pct,
        'captureYieldPct':     capture_yield_pct,
        'annualizedYieldPct':  annualized_yield_pct,
        'warrantTicker':       warrant_ticker,
        'warrantPrice':        warrant_price,
        'warrantStrike':       warrant_strike,
        'warrantRatio':        warrant_ratio,
        'warrantIntrinsic':    warrant_intrinsic,
        'warrantTimeValue':    warrant_time_value,
        'warrantBreakeven':    warrant_breakeven,
        'scenarios':           scenarios,
    }


class SpacPositionCreate(BaseModel):
    spac_id:       int
    security_type: str = 'common'   # common | warrant
    shares:        float
    entry_price:   float
    entry_date:    str = ''
    notes:         str = ''


def _enrich_spac_position(pos: SpacPosition, spac: SpacDeal | None) -> dict | None:
    if spac is None:
        return None

    enriched = _enrich_spac(spac)
    is_warrant = pos.security_type == 'warrant'
    current_price = enriched['warrantPrice'] if is_warrant else enriched['currentPrice']

    cost_basis   = pos.shares * pos.entry_price
    market_value = pos.shares * current_price if current_price is not None else None
    unrealized_pnl     = (market_value - cost_basis) if market_value is not None else None
    unrealized_pnl_pct = (unrealized_pnl / cost_basis * 100) if unrealized_pnl is not None and cost_basis else None
    # Warrants have no redemption right -- they can go to zero if the deal
    # falls through or the stock never clears the strike. Only common stock
    # carries the trust-value floor.
    floor_value = None if is_warrant else round(pos.shares * spac.trust_value_per_share, 2)

    return {
        'id':               pos.id,
        'spacId':           spac.id,
        'ticker':           enriched['ticker'],
        'companyName':      enriched['companyName'],
        'securityType':     pos.security_type,
        'positionTicker':   enriched['warrantTicker'] if is_warrant else enriched['ticker'],
        'shares':           pos.shares,
        'entryPrice':       pos.entry_price,
        'entryDate':        pos.entry_date,
        'notes':            pos.notes,
        'currentPrice':     round(current_price, 2) if current_price is not None else None,
        'costBasis':        round(cost_basis, 2),
        'marketValue':      round(market_value, 2) if market_value is not None else None,
        'unrealizedPnl':    round(unrealized_pnl, 2) if unrealized_pnl is not None else None,
        'unrealizedPnlPct': round(unrealized_pnl_pct, 2) if unrealized_pnl_pct is not None else None,
        'floorValue':       floor_value,
        'trustValuePerShare': spac.trust_value_per_share,
        'status':           enriched['status'],
        'statusLabel':      enriched['statusLabel'],
        'daysToDeadline':   enriched['daysToDeadline'],
    }


@router.get('/api/spac/positions')
def get_spac_positions():
    with db_session() as db:
        positions = db.query(SpacPosition).order_by(SpacPosition.created_at.desc()).all()
        if not positions:
            return {'positions': [], 'summary': None}
        spac_ids = {p.spac_id for p in positions}
        spacs = {d.id: d for d in db.query(SpacDeal).filter(SpacDeal.id.in_(spac_ids)).all()}

    rows = []
    with ThreadPoolExecutor(max_workers=min(len(positions), 8)) as pool:
        futures = {pool.submit(_enrich_spac_position, p, spacs.get(p.spac_id)): p for p in positions}
        for fut in as_completed(futures):
            try:
                r = fut.result()
                if r: rows.append(r)
            except Exception as exc:
                logger.warning('enrich spac position: %s', exc)

    rows.sort(key=lambda r: r['marketValue'] or 0, reverse=True)

    total_cost    = sum(r['costBasis'] for r in rows)
    total_value   = sum(r['marketValue'] for r in rows if r['marketValue'] is not None)
    total_pnl     = sum(r['unrealizedPnl'] for r in rows if r['unrealizedPnl'] is not None)
    total_pnl_pct = (total_pnl / total_cost * 100) if total_cost else None
    floor_value   = sum(r['floorValue'] or 0 for r in rows)
    protected_pct = (floor_value / total_value * 100) if total_value else None

    concentration_type = {}
    for r in rows:
        w = (r['marketValue'] or 0) / total_value * 100 if total_value else 0
        label = 'Common' if r['securityType'] == 'common' else 'Warrants'
        concentration_type[label] = concentration_type.get(label, 0) + w

    summary = {
        'positionCount':         len(rows),
        'totalCostBasis':        round(total_cost, 2),
        'totalMarketValue':      round(total_value, 2),
        'totalUnrealizedPnl':    round(total_pnl, 2),
        'totalUnrealizedPnlPct': round(total_pnl_pct, 2) if total_pnl_pct is not None else None,
        'floorValue':            round(floor_value, 2),
        'protectedPct':          round(protected_pct, 1) if protected_pct is not None else None,
        'concentrationBySecurityType': {k: round(v, 1) for k, v in concentration_type.items()},
    }
    return {'positions': rows, 'summary': summary}


@router.post('/api/spac/positions')
def create_spac_position(body: SpacPositionCreate):
    with db_session() as db:
        if not db.query(SpacDeal).filter(SpacDeal.id == body.spac_id).first():
            raise HTTPException(404, 'SPAC not found')
        pos = SpacPosition(
            spac_id       = body.spac_id,
            security_type = body.security_type,
            shares        = body.shares,
            entry_price   = body.entry_price,
            entry_date    = body.entry_date,
            notes         = body.notes.strip(),
        )
        db.add(pos)
        db.flush()
        return {'id': pos.id}


@router.put('/api/spac/positions/{position_id}')
def update_spac_position(position_id: int, body: SpacPositionCreate):
    with db_session() as db:
        pos = db.query(SpacPosition).filter(SpacPosition.id == position_id).first()
        if not pos:
            raise HTTPException(404, 'Position not found')
        pos.spac_id       = body.spac_id
        pos.security_type = body.security_type
        pos.shares        = body.shares
        pos.entry_price   = body.entry_price
        pos.entry_date    = body.entry_date
        pos.notes         = body.notes.strip()
        return {'ok': True}


@router.delete('/api/spac/positions/{position_id}')
def delete_spac_position(position_id: int):
    with db_session() as db:
        pos = db.query(SpacPosition).filter(SpacPosition.id == position_id).first()
        if not pos:
            raise HTTPException(404, 'Position not found')
        db.delete(pos)
    return {'ok': True}


_SPAC_ALERT_TYPES = {
    'deadline_approaching': {'param': 'days', 'default': 30,   'label': 'Deadline Approaching'},
    'discount_threshold':   {'param': 'pct',  'default': -3.0, 'label': 'Discount/Premium Threshold'},
    'deal_announced':       {'param': None,   'default': None, 'label': 'Deal Announced'},
}


class SpacAlertCreate(BaseModel):
    spac_id:    int
    alert_type: str
    params:     dict = {}


def _check_spac_alert(rule: dict, spac: SpacDeal) -> dict | None:
    """Evaluate one SPAC alert rule against live-enriched deal data. Like the
    generic Smart Alerts scanner, this checks whether the condition is
    currently true -- it isn't edge-triggered / doesn't dedupe across scans."""
    atype  = rule['alert_type']
    params = rule['params']
    enriched = _enrich_spac(spac)

    if atype == 'deadline_approaching':
        days_thresh = params.get('days', 30)
        d = enriched['daysToDeadline']
        if d is not None and d <= days_thresh:
            detail = f"Overdue by {-d} day(s)" if d < 0 else f"{d} day(s) to deadline ({spac.deadline_date})"
            return {'triggered': True, 'detail': detail}

    elif atype == 'discount_threshold':
        direction = params.get('direction', 'below')
        pct = params.get('pct', -3.0)
        disc = enriched['discountPct']
        if disc is not None:
            if direction == 'below' and disc <= pct:
                return {'triggered': True, 'detail': f"Trading at {disc:.1f}% vs trust (≤ {pct}%)"}
            if direction == 'above' and disc >= pct:
                return {'triggered': True, 'detail': f"Trading at {disc:.1f}% vs trust (≥ {pct}%)"}

    elif atype == 'deal_announced':
        if spac.status != 'searching':
            detail = f"Status: {enriched['statusLabel']}"
            if spac.target_name:
                detail += f" — target: {spac.target_name}"
            return {'triggered': True, 'detail': detail}

    return None


@router.get('/api/spac/alerts')
def list_spac_alerts():
    with db_session() as db:
        rules = db.query(SpacAlertRule).filter(SpacAlertRule.active == 1).order_by(SpacAlertRule.created_at.desc()).all()
        if not rules:
            return []
        spac_ids = {r.spac_id for r in rules}
        spacs = {d.id: d for d in db.query(SpacDeal).filter(SpacDeal.id.in_(spac_ids)).all()}

    return [{
        'id':          r.id,
        'spacId':      r.spac_id,
        'ticker':      spacs[r.spac_id].ticker if r.spac_id in spacs else '?',
        'companyName': spacs[r.spac_id].company_name if r.spac_id in spacs else '',
        'alertType':   r.alert_type,
        'label':       _SPAC_ALERT_TYPES.get(r.alert_type, {}).get('label', r.alert_type),
        'params':      json.loads(r.params),
        'createdAt':   str(r.created_at),
    } for r in rules]


@router.post('/api/spac/alerts')
def create_spac_alert(req: SpacAlertCreate):
    if req.alert_type not in _SPAC_ALERT_TYPES:
        raise HTTPException(400, f"Unknown alert_type. Valid: {list(_SPAC_ALERT_TYPES)}")
    with db_session() as db:
        if not db.query(SpacDeal).filter(SpacDeal.id == req.spac_id).first():
            raise HTTPException(404, 'SPAC not found')
        rule = SpacAlertRule(spac_id=req.spac_id, alert_type=req.alert_type, params=json.dumps(req.params))
        db.add(rule)
        db.flush()
        return {'id': rule.id}


@router.delete('/api/spac/alerts/{rule_id}')
def delete_spac_alert(rule_id: int):
    with db_session() as db:
        rule = db.query(SpacAlertRule).filter(SpacAlertRule.id == rule_id).first()
        if not rule:
            raise HTTPException(404, 'Rule not found')
        rule.active = 0
    return {'ok': True}


@router.post('/api/spac/alerts/scan')
def scan_spac_alerts():
    with db_session() as db:
        rules = db.query(SpacAlertRule).filter(SpacAlertRule.active == 1).all()
        if not rules:
            return []
        spac_ids = {r.spac_id for r in rules}
        spacs = {d.id: d for d in db.query(SpacDeal).filter(SpacDeal.id.in_(spac_ids)).all()}
        rule_list = [{'id': r.id, 'spac_id': r.spac_id, 'alert_type': r.alert_type, 'params': json.loads(r.params)} for r in rules]

    results = []
    with ThreadPoolExecutor(max_workers=min(len(rule_list), 8)) as pool:
        futures = {}
        for r in rule_list:
            spac = spacs.get(r['spac_id'])
            if spac is None:
                continue
            futures[pool.submit(_check_spac_alert, r, spac)] = r
        for fut, r in futures.items():
            try:
                outcome = fut.result()
            except Exception as exc:
                logger.warning('spac alert check %s: %s', r['id'], exc)
                continue
            if outcome and outcome.get('triggered'):
                spac = spacs[r['spac_id']]
                results.append({
                    'id':          r['id'],
                    'spacId':      r['spac_id'],
                    'ticker':      spac.ticker,
                    'companyName': spac.company_name,
                    'alertType':   r['alert_type'],
                    'label':       _SPAC_ALERT_TYPES.get(r['alert_type'], {}).get('label', r['alert_type']),
                    'detail':      outcome.get('detail', ''),
                })
    return results


