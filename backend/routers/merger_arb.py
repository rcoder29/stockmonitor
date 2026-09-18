"""Merger Arb — Merger Arb → Deal Dashboard / Opportunity Scanner / Deal
Analyzer / Arb Portfolio / Risk Matrix / Alerts.
"""
import json
import logging
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import pandas as pd
import yfinance as yf

from database import cache_get, cache_set, db_session, MergerDeal, ArbPosition, MergerAlertRule
from edgar_utils import _edgar_req, _safe_float, _TICKER_RE, _fetch_opp_quote

logger = logging.getLogger(__name__)
router = APIRouter()


_MERGER_EDGAR_TTL = timedelta(hours=4)

_DEAL_STATUSES = {
    'pending_regulatory':  'Pending Regulatory',
    'pending_shareholder': 'Pending Shareholder Vote',
    'pending_financing':   'Pending Financing',
    'closing':             'Closing',
    'terminated':          'Terminated',
    'closed':              'Closed',
}

_DEAL_STATUS_LABELS = list(_DEAL_STATUSES.keys())


class MergerDealCreate(BaseModel):
    target_ticker:   str
    target_name:     str = ''
    acquirer_name:   str = ''
    deal_type:       str = 'cash'
    offer_price:     float
    announce_date:   str = ''
    expected_close:  str = ''
    status:          str = 'pending_regulatory'
    deal_value_bn:   float | None = None
    regulatory_body: str = ''
    notes:           str = ''
    source:          str = 'manual'
    edgar_accession: str = ''


def _deal_risk_breakdown(deal_type: str, spread_pct: float | None,
                          days_to_close: int | None, deal_value_bn: float | None,
                          regulatory_body: str) -> list[dict]:
    """Return list of scored risk factors: {factor, points, max, detail}."""
    factors = []

    type_pts = {'cash': 2, 'mixed': 4, 'stock': 6}.get(deal_type, 3)
    factors.append({'factor': 'Deal structure', 'points': type_pts, 'max': 6,
                     'detail': f"{deal_type.capitalize()} deals carry {'low' if type_pts <= 2 else 'moderate' if type_pts <= 4 else 'elevated'} risk (stock deals add acquirer price risk)"})

    spread_pts = 0
    if spread_pct is not None:
        if spread_pct > 15: spread_pts = 4
        elif spread_pct > 8: spread_pts = 3
        elif spread_pct > 4: spread_pts = 2
        elif spread_pct > 2: spread_pts = 1
    factors.append({'factor': 'Market-implied risk (spread size)', 'points': spread_pts, 'max': 4,
                     'detail': f"Spread of {spread_pct:.1f}% suggests the market is pricing in some deal risk" if spread_pct is not None else 'No live spread available'})

    rb = (regulatory_body or '').upper()
    reg_pts = 0
    if 'DOJ' in rb or 'FTC' in rb: reg_pts += 2
    if 'EU' in rb or 'CFIUS' in rb: reg_pts += 1
    factors.append({'factor': 'Regulatory scrutiny', 'points': reg_pts, 'max': 3,
                     'detail': f"{regulatory_body or 'No regulator specified'}"})

    size_pts = 0
    if deal_value_bn:
        if deal_value_bn > 20: size_pts = 2
        elif deal_value_bn > 5: size_pts = 1
    factors.append({'factor': 'Deal size', 'points': size_pts, 'max': 2,
                     'detail': f"${deal_value_bn:.1f}B deal value" if deal_value_bn else 'Deal value unknown'})

    time_pts = 0
    if days_to_close:
        if days_to_close > 270: time_pts = 2
        elif days_to_close > 180: time_pts = 1
    factors.append({'factor': 'Time horizon', 'points': time_pts, 'max': 2,
                     'detail': f"{days_to_close} days to expected close" if days_to_close is not None else 'Expected close date unknown'})

    return factors


def _deal_risk(deal_type: str, spread_pct: float | None,
               days_to_close: int | None, deal_value_bn: float | None,
               regulatory_body: str) -> tuple[int, str]:
    """Return (score 0-10, label)."""
    factors = _deal_risk_breakdown(deal_type, spread_pct, days_to_close, deal_value_bn, regulatory_body)
    score = min(10, sum(f['points'] for f in factors))
    label = 'Low' if score <= 3 else 'High' if score >= 7 else 'Medium'
    return score, label


def _enrich_deal(deal: MergerDeal) -> dict:
    """Add live price, spread, annualized return, and risk to a deal row."""
    from datetime import date as _date
    today = _date.today()

    row = {
        'id':             deal.id,
        'targetTicker':   deal.target_ticker.upper(),
        'targetName':     deal.target_name or deal.target_ticker.upper(),
        'acquirerName':   deal.acquirer_name,
        'dealType':       deal.deal_type,
        'offerPrice':     deal.offer_price,
        'announceDate':   deal.announce_date,
        'expectedClose':  deal.expected_close,
        'status':         deal.status,
        'statusLabel':    _DEAL_STATUSES.get(deal.status, deal.status),
        'dealValueBn':    deal.deal_value_bn,
        'regulatoryBody': deal.regulatory_body,
        'notes':          deal.notes,
        'source':         deal.source,
        'edgarAccession': deal.edgar_accession,
        'currentPrice':   None,
        'spread':         None,
        'spreadPct':      None,
        'annualizedPct':  None,
        'daysToClose':    None,
        'riskScore':      None,
        'riskLabel':      'Unknown',
        'priceChange1d':  None,
        'volume':         None,
    }

    # Days to close
    days_to_close = None
    if deal.expected_close:
        try:
            close_dt = datetime.strptime(deal.expected_close, '%Y-%m-%d').date()
            days_to_close = (close_dt - today).days
            row['daysToClose'] = days_to_close
        except ValueError:
            pass

    try:
        t  = yf.Ticker(deal.target_ticker)
        fi = t.fast_info
        price = _safe_float(getattr(fi, 'last_price', None))
        if price:
            row['currentPrice'] = round(price, 2)
            spread      = deal.offer_price - price
            spread_pct  = (spread / deal.offer_price) * 100
            row['spread']    = round(spread, 2)
            row['spreadPct'] = round(spread_pct, 2)
            if days_to_close and days_to_close > 0:
                row['annualizedPct'] = round(spread_pct / days_to_close * 365, 1)
            row['priceChange1d'] = round(
                _safe_float(getattr(fi, 'regular_market_price', None) or 0) -
                _safe_float(getattr(fi, 'previous_close', None) or 0), 2
            ) or None
    except Exception:
        spread_pct = None

    score, label = _deal_risk(
        deal.deal_type,
        row.get('spreadPct'),
        days_to_close,
        deal.deal_value_bn,
        deal.regulatory_body,
    )
    row['riskScore'] = score
    row['riskLabel'] = label
    return row


@router.get('/api/merger/deals')
def get_merger_deals(include_closed: bool = False):
    with db_session() as db:
        q = db.query(MergerDeal)
        if not include_closed:
            q = q.filter(MergerDeal.status.notin_(['terminated', 'closed']))
        deals = q.order_by(MergerDeal.created_at.desc()).all()

    if not deals:
        return []

    results = []
    with ThreadPoolExecutor(max_workers=min(len(deals), 8)) as pool:
        futures = {pool.submit(_enrich_deal, d): d for d in deals}
        for fut in as_completed(futures):
            try:
                results.append(fut.result())
            except Exception as exc:
                logger.warning('enrich deal: %s', exc)

    results.sort(key=lambda r: -(r.get('annualizedPct') or 0))
    return results


@router.post('/api/merger/deals')
def create_merger_deal(body: MergerDealCreate):
    with db_session() as db:
        deal = MergerDeal(
            target_ticker   = body.target_ticker.strip().upper(),
            target_name     = body.target_name.strip(),
            acquirer_name   = body.acquirer_name.strip(),
            deal_type       = body.deal_type,
            offer_price     = body.offer_price,
            announce_date   = body.announce_date,
            expected_close  = body.expected_close,
            status          = body.status,
            deal_value_bn   = body.deal_value_bn,
            regulatory_body = body.regulatory_body.strip(),
            notes           = body.notes.strip(),
            source          = body.source,
            edgar_accession = body.edgar_accession,
        )
        db.add(deal)
        db.flush()
        return {'id': deal.id}


@router.put('/api/merger/deals/{deal_id}')
def update_merger_deal(deal_id: int, body: MergerDealCreate):
    with db_session() as db:
        deal = db.query(MergerDeal).filter(MergerDeal.id == deal_id).first()
        if not deal:
            raise HTTPException(404, 'Deal not found')
        deal.target_ticker   = body.target_ticker.strip().upper()
        deal.target_name     = body.target_name.strip()
        deal.acquirer_name   = body.acquirer_name.strip()
        deal.deal_type       = body.deal_type
        deal.offer_price     = body.offer_price
        deal.announce_date   = body.announce_date
        deal.expected_close  = body.expected_close
        deal.status          = body.status
        deal.deal_value_bn   = body.deal_value_bn
        deal.regulatory_body = body.regulatory_body.strip()
        deal.notes           = body.notes.strip()
        deal.source          = body.source
        return {'ok': True}


@router.delete('/api/merger/deals/{deal_id}')
def delete_merger_deal(deal_id: int):
    with db_session() as db:
        deal = db.query(MergerDeal).filter(MergerDeal.id == deal_id).first()
        if not deal:
            raise HTTPException(404, 'Deal not found')
        db.delete(deal)
    return {'ok': True}


@router.get('/api/merger/scan-edgar')
def scan_edgar_deals():
    """Return recent SC TO-T and SC 13E-3 tender offer filings from EDGAR."""
    cache_key = 'merger_edgar_scan'
    cached = cache_get(cache_key, _MERGER_EDGAR_TTL)
    if cached:
        return cached

    from datetime import date as _date
    today_str = _date.today().strftime('%Y-%m-%d')
    cutoff = (_date.today() - pd.Timedelta(days=90)).strftime('%Y-%m-%d')
    results = []

    for form in ('SC TO-T', 'SC 13E-3'):
        try:
            url = (
                f"https://efts.sec.gov/LATEST/search-index"
                f"?q=&forms={form.replace(' ', '+')}"
                f"&dateRange=custom&startdt={cutoff}&enddt={today_str}"
            )
            resp = _edgar_req(url).json()
            hits = resp.get('hits', {}).get('hits', [])
            for h in hits[:30]:
                src = h.get('_source', {})
                acc = h.get('_id', '')
                # Normalise accession to XX-XXXXXXXX-XXXXXXXX format
                if acc and '-' not in acc and len(acc) == 18:
                    acc = f"{acc[:10]}-{acc[10:12]}-{acc[12:]}"
                results.append({
                    'accession':  acc,
                    'filerName':  src.get('entity_name', ''),
                    'formType':   src.get('form_type', form),
                    'fileDate':   src.get('file_date', ''),
                    'edgarUrl':   f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&filenum=&State=0&SIC=&dateb=&owner=include&count=1&search_text=&accession={acc.replace('-', '')}",
                })
        except Exception as exc:
            logger.warning('edgar scan %s: %s', form, exc)

    results.sort(key=lambda r: r.get('fileDate', ''), reverse=True)
    cache_set(cache_key, results)
    return results


@router.get('/api/merger/deal/{deal_id}/spread-history')
def deal_spread_history(deal_id: int):
    """90-day daily spread history for a deal."""
    with db_session() as db:
        deal = db.query(MergerDeal).filter(MergerDeal.id == deal_id).first()
        if not deal:
            raise HTTPException(404, 'Deal not found')
        offer = deal.offer_price
        ticker = deal.target_ticker

    try:
        hist = yf.Ticker(ticker).history(period='3mo')
        if hist.empty:
            return []
        hist.index = hist.index.tz_localize(None) if hist.index.tzinfo else hist.index
        rows = []
        for dt, row in hist.iterrows():
            price = float(row['Close'])
            spread_pct = round((offer - price) / offer * 100, 3)
            rows.append({'date': str(dt.date()), 'price': round(price, 2),
                         'spread': round(offer - price, 2), 'spreadPct': spread_pct})
        return rows
    except Exception as exc:
        logger.warning('spread history %s: %s', ticker, exc)
        return []


_MERGER_OPP_FORMS = ('SC TO-T', 'SC 13E-3', 'DEFM14A', 'PREM14A', 'S-4', '425')
_MERGER_OPP_FORM_LABELS = {
    'SC TO-T':  'Tender Offer',
    'SC 13E-3': 'Going Private',
    'DEFM14A':  'Definitive Merger Proxy',
    'PREM14A':  'Preliminary Merger Proxy',
    'S-4':      'Stock Merger Registration',
    '425':      'Business Combination Prospectus',
}
# _TICKER_RE / _fetch_opp_quote live in edgar_utils.py (imported above) —
# shared with IPO & Lockup Calendar, Activist Tracker, and Reddit Trending
# Stocks in main.py.


@router.get('/api/merger/opportunities')
def merger_opportunities():
    """Scan EDGAR for merger-indicative filings (tender offers, merger proxies,
    stock-deal registrations) beyond the tender-offer-only feed on the Deal
    Dashboard, enrich with live price context, and flag ones already tracked."""
    cache_key = 'merger_opportunities_scan'
    cached = cache_get(cache_key, _MERGER_EDGAR_TTL)
    if cached:
        return cached

    from datetime import date as _date
    today_str = _date.today().strftime('%Y-%m-%d')
    cutoff = (_date.today() - pd.Timedelta(days=60)).strftime('%Y-%m-%d')

    raw = {}  # accession -> row
    for form in _MERGER_OPP_FORMS:
        try:
            url = (
                f"https://efts.sec.gov/LATEST/search-index"
                f"?q=&forms={form.replace(' ', '+')}"
                f"&dateRange=custom&startdt={cutoff}&enddt={today_str}"
            )
            resp = _edgar_req(url).json()
            hits = resp.get('hits', {}).get('hits', [])
            for h in hits[:40]:
                src = h.get('_source', {})
                acc = src.get('adsh') or h.get('_id', '').split(':')[0]
                if acc in raw:
                    continue
                display = (src.get('display_names') or [''])[0]
                m = _TICKER_RE.search(display)
                ticker = m.group(1).split(',')[0].strip() if m else None
                name = display.split('  (')[0].strip() if display else src.get('entity_name', '')
                raw[acc] = {
                    'accession':  acc,
                    'ticker':     ticker,
                    'companyName': name,
                    'formType':   src.get('form', form),
                    'formLabel':  _MERGER_OPP_FORM_LABELS.get(form, form),
                    'fileDate':   src.get('file_date', ''),
                    'cik':        (src.get('ciks') or [''])[0],
                    'edgarUrl':   f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&filenum=&State=0&SIC=&dateb=&owner=include&count=1&search_text=&accession={acc.replace('-', '')}",
                }
        except Exception as exc:
            logger.warning('opportunities scan %s: %s', form, exc)

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

    with db_session() as db:
        tracked_tickers = {t.upper() for (t,) in db.query(MergerDeal.target_ticker).all()}

    for r in results:
        q = quotes.get(r['ticker'], {}) if r['ticker'] else {}
        r['currentPrice']   = q.get('currentPrice')
        r['priceChange5d']  = q.get('priceChange5d')
        r['priceChange1mo'] = q.get('priceChange1mo')
        r['tracked'] = bool(r['ticker'] and r['ticker'].upper() in tracked_tickers)

    results.sort(key=lambda r: r.get('fileDate', ''), reverse=True)
    cache_set(cache_key, results)
    return results


@router.get('/api/merger/analyze')
def analyze_deal(
    deal_id:         int | None = None,
    target_ticker:   str | None = None,
    offer_price:     float | None = None,
    deal_type:       str = 'cash',
    regulatory_body: str = '',
    expected_close:  str = '',
    announce_date:   str = '',
    deal_value_bn:   float | None = None,
    walkaway_price:  float | None = None,
):
    """Deep-dive risk/reward analysis for a single deal: risk factor breakdown,
    market-implied close probability, breakeven probability, and an
    expected-value scenario table across a range of close probabilities."""
    if deal_id is not None:
        with db_session() as db:
            deal = db.query(MergerDeal).filter(MergerDeal.id == deal_id).first()
            if not deal:
                raise HTTPException(404, 'Deal not found')
            target_ticker   = deal.target_ticker
            offer_price     = deal.offer_price
            deal_type       = deal.deal_type
            regulatory_body = deal.regulatory_body
            expected_close  = deal.expected_close
            announce_date   = deal.announce_date
            deal_value_bn   = deal.deal_value_bn

    if not target_ticker or not offer_price:
        raise HTTPException(400, 'target_ticker and offer_price are required')

    target_ticker = target_ticker.strip().upper()
    from datetime import date as _date
    today = _date.today()

    current_price = None
    try:
        fi = yf.Ticker(target_ticker).fast_info
        current_price = _safe_float(getattr(fi, 'last_price', None))
    except Exception:
        pass

    days_to_close = None
    if expected_close:
        try:
            days_to_close = (datetime.strptime(expected_close, '%Y-%m-%d').date() - today).days
        except ValueError:
            pass

    # Estimate a "walk-away" price (where the stock would trade if the deal breaks)
    # from the pre-announcement price, falling back to a flat 15% discount heuristic.
    walkaway_estimated = False
    if walkaway_price is None and announce_date:
        try:
            ann_dt = datetime.strptime(announce_date, '%Y-%m-%d').date()
            pre_start = (ann_dt - pd.Timedelta(days=10)).strftime('%Y-%m-%d')
            pre_end   = (ann_dt - pd.Timedelta(days=1)).strftime('%Y-%m-%d')
            hist = yf.Ticker(target_ticker).history(start=pre_start, end=pre_end)
            if not hist.empty:
                walkaway_price = round(float(hist['Close'].iloc[-1]), 2)
                walkaway_estimated = True
        except Exception:
            pass
    if walkaway_price is None and current_price:
        walkaway_price = round(current_price * 0.85, 2)
        walkaway_estimated = True

    spread = spread_pct = annualized_pct = None
    if current_price:
        spread = round(offer_price - current_price, 2)
        spread_pct = round(spread / offer_price * 100, 2) if offer_price else None
        if days_to_close and days_to_close > 0 and spread_pct is not None:
            annualized_pct = round(spread_pct / days_to_close * 365, 1)

    risk_factors = _deal_risk_breakdown(deal_type, spread_pct, days_to_close, deal_value_bn, regulatory_body)
    risk_score = min(10, sum(f['points'] for f in risk_factors))
    risk_label = 'Low' if risk_score <= 3 else 'High' if risk_score >= 7 else 'Medium'

    upside_pct = downside_pct = implied_prob = None
    scenarios = []
    if current_price and walkaway_price is not None and offer_price != walkaway_price:
        upside_pct   = round((offer_price - current_price) / current_price * 100, 2)
        downside_pct = round((walkaway_price - current_price) / current_price * 100, 2)
        # Probability of close the current price already reflects: solves
        # p*offer + (1-p)*walkaway = current, i.e. the price at which expected value is zero.
        implied_prob = round((current_price - walkaway_price) / (offer_price - walkaway_price) * 100, 1)
        for p in (0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95):
            ev_pct = round(p * upside_pct + (1 - p) * downside_pct, 2)
            ev_ann = round(ev_pct / days_to_close * 365, 1) if days_to_close and days_to_close > 0 else None
            scenarios.append({'probability': int(p * 100), 'evPct': ev_pct, 'evAnnualizedPct': ev_ann})

    return {
        'targetTicker':                target_ticker,
        'offerPrice':                  offer_price,
        'currentPrice':                current_price,
        'walkawayPrice':               walkaway_price,
        'walkawayEstimated':           walkaway_estimated,
        'dealType':                    deal_type,
        'regulatoryBody':              regulatory_body,
        'dealValueBn':                 deal_value_bn,
        'daysToClose':                 days_to_close,
        'spread':                      spread,
        'spreadPct':                   spread_pct,
        'annualizedPct':               annualized_pct,
        'upsidePct':                   upside_pct,
        'downsidePct':                 downside_pct,
        'marketImpliedProbabilityPct': implied_prob,
        'riskScore':                   risk_score,
        'riskLabel':                   risk_label,
        'riskFactors':                 risk_factors,
        'scenarios':                   scenarios,
    }


class ArbPositionCreate(BaseModel):
    deal_id:     int
    shares:      float
    entry_price: float
    entry_date:  str = ''
    notes:       str = ''


def _enrich_position(pos: ArbPosition, deal: MergerDeal | None) -> dict | None:
    if deal is None:
        return None

    enriched = _enrich_deal(deal)
    cost_basis   = pos.shares * pos.entry_price
    market_value = pos.shares * enriched['currentPrice'] if enriched['currentPrice'] else None
    unrealized_pnl     = (market_value - cost_basis) if market_value is not None else None
    unrealized_pnl_pct = (unrealized_pnl / cost_basis * 100) if unrealized_pnl is not None and cost_basis else None
    value_at_close      = pos.shares * deal.offer_price
    potential_gain       = value_at_close - cost_basis
    potential_gain_pct   = (potential_gain / cost_basis * 100) if cost_basis else None

    return {
        'id':               pos.id,
        'dealId':           deal.id,
        'targetTicker':     enriched['targetTicker'],
        'targetName':       enriched['targetName'],
        'acquirerName':     enriched['acquirerName'],
        'dealType':         enriched['dealType'],
        'offerPrice':       enriched['offerPrice'],
        'status':           enriched['status'],
        'statusLabel':      enriched['statusLabel'],
        'regulatoryBody':   enriched['regulatoryBody'],
        'shares':           pos.shares,
        'entryPrice':       pos.entry_price,
        'entryDate':        pos.entry_date,
        'notes':            pos.notes,
        'currentPrice':     enriched['currentPrice'],
        'costBasis':        round(cost_basis, 2),
        'marketValue':      round(market_value, 2) if market_value is not None else None,
        'unrealizedPnl':    round(unrealized_pnl, 2) if unrealized_pnl is not None else None,
        'unrealizedPnlPct': round(unrealized_pnl_pct, 2) if unrealized_pnl_pct is not None else None,
        'valueAtClose':     round(value_at_close, 2),
        'potentialGain':    round(potential_gain, 2),
        'potentialGainPct': round(potential_gain_pct, 2) if potential_gain_pct is not None else None,
        'daysToClose':      enriched['daysToClose'],
        'annualizedPct':    enriched['annualizedPct'],
        'riskScore':        enriched['riskScore'],
        'riskLabel':        enriched['riskLabel'],
    }


@router.get('/api/merger/positions')
def get_arb_positions():
    with db_session() as db:
        positions = db.query(ArbPosition).order_by(ArbPosition.created_at.desc()).all()
        if not positions:
            return {'positions': [], 'summary': None}
        deal_ids = {p.deal_id for p in positions}
        deals = {d.id: d for d in db.query(MergerDeal).filter(MergerDeal.id.in_(deal_ids)).all()}

    rows = []
    with ThreadPoolExecutor(max_workers=min(len(positions), 8)) as pool:
        futures = {pool.submit(_enrich_position, p, deals.get(p.deal_id)): p for p in positions}
        for fut in as_completed(futures):
            try:
                r = fut.result()
                if r: rows.append(r)
            except Exception as exc:
                logger.warning('enrich position: %s', exc)

    rows.sort(key=lambda r: r['marketValue'] or 0, reverse=True)

    total_cost   = sum(r['costBasis'] for r in rows)
    total_value  = sum(r['marketValue'] for r in rows if r['marketValue'] is not None)
    total_pnl    = sum(r['unrealizedPnl'] for r in rows if r['unrealizedPnl'] is not None)
    total_pnl_pct = (total_pnl / total_cost * 100) if total_cost else None

    weighted_ann = None
    ann_rows = [r for r in rows if r['annualizedPct'] is not None and r['marketValue']]
    if ann_rows and total_value:
        weighted_ann = sum(r['annualizedPct'] * r['marketValue'] for r in ann_rows) / total_value

    concentration_type = {}
    concentration_reg  = {}
    for r in rows:
        w = (r['marketValue'] or 0) / total_value * 100 if total_value else 0
        concentration_type[r['dealType']] = concentration_type.get(r['dealType'], 0) + w
        rb = r['regulatoryBody'] or 'None/Unknown'
        concentration_reg[rb] = concentration_reg.get(rb, 0) + w

    summary = {
        'positionCount':       len(rows),
        'totalCostBasis':      round(total_cost, 2),
        'totalMarketValue':    round(total_value, 2),
        'totalUnrealizedPnl':  round(total_pnl, 2),
        'totalUnrealizedPnlPct': round(total_pnl_pct, 2) if total_pnl_pct is not None else None,
        'weightedAvgAnnualizedPct': round(weighted_ann, 1) if weighted_ann is not None else None,
        'concentrationByDealType': {k: round(v, 1) for k, v in concentration_type.items()},
        'concentrationByRegulator': {k: round(v, 1) for k, v in concentration_reg.items()},
    }
    return {'positions': rows, 'summary': summary}


@router.post('/api/merger/positions')
def create_arb_position(body: ArbPositionCreate):
    with db_session() as db:
        if not db.query(MergerDeal).filter(MergerDeal.id == body.deal_id).first():
            raise HTTPException(404, 'Deal not found')
        pos = ArbPosition(
            deal_id     = body.deal_id,
            shares      = body.shares,
            entry_price = body.entry_price,
            entry_date  = body.entry_date,
            notes       = body.notes.strip(),
        )
        db.add(pos)
        db.flush()
        return {'id': pos.id}


@router.put('/api/merger/positions/{position_id}')
def update_arb_position(position_id: int, body: ArbPositionCreate):
    with db_session() as db:
        pos = db.query(ArbPosition).filter(ArbPosition.id == position_id).first()
        if not pos:
            raise HTTPException(404, 'Position not found')
        pos.deal_id     = body.deal_id
        pos.shares      = body.shares
        pos.entry_price = body.entry_price
        pos.entry_date  = body.entry_date
        pos.notes       = body.notes.strip()
        return {'ok': True}


@router.delete('/api/merger/positions/{position_id}')
def delete_arb_position(position_id: int):
    with db_session() as db:
        pos = db.query(ArbPosition).filter(ArbPosition.id == position_id).first()
        if not pos:
            raise HTTPException(404, 'Position not found')
        db.delete(pos)
    return {'ok': True}


_MERGER_ALERT_TYPES = {
    'days_to_close_threshold': {'param': 'days',   'default': 30,        'label': 'Days to Close Threshold'},
    'spread_threshold':        {'param': 'pct',    'default': 8.0,       'label': 'Spread Threshold'},
    'status_alert':            {'param': 'status', 'default': 'closing', 'label': 'Status Reached'},
}


class MergerAlertCreate(BaseModel):
    deal_id:    int
    alert_type: str
    params:     dict = {}


def _check_merger_alert(rule: dict, deal: MergerDeal) -> dict | None:
    """Evaluate one merger-arb alert rule against live-enriched deal data.
    Like the SPAC and generic Smart Alerts scanners, this checks whether the
    condition is currently true -- it isn't edge-triggered / doesn't dedupe
    across scans."""
    atype  = rule['alert_type']
    params = rule['params']
    enriched = _enrich_deal(deal)

    if atype == 'days_to_close_threshold':
        days_thresh = params.get('days', 30)
        d = enriched['daysToClose']
        if d is not None and d <= days_thresh:
            detail = f"Overdue by {-d} day(s)" if d < 0 else f"{d} day(s) to expected close ({deal.expected_close})"
            return {'triggered': True, 'detail': detail}

    elif atype == 'spread_threshold':
        direction = params.get('direction', 'above')
        pct = params.get('pct', 8.0)
        spread = enriched['spreadPct']
        if spread is not None:
            if direction == 'above' and spread >= pct:
                return {'triggered': True, 'detail': f"Spread at {spread:.1f}% (≥ {pct}%)"}
            if direction == 'below' and spread <= pct:
                return {'triggered': True, 'detail': f"Spread at {spread:.1f}% (≤ {pct}%)"}

    elif atype == 'status_alert':
        target_status = params.get('status', 'closing')
        if deal.status == target_status:
            return {'triggered': True, 'detail': f"Status: {enriched['statusLabel']}"}

    return None


@router.get('/api/merger/alerts')
def list_merger_alerts():
    with db_session() as db:
        rules = db.query(MergerAlertRule).filter(MergerAlertRule.active == 1).order_by(MergerAlertRule.created_at.desc()).all()
        if not rules:
            return []
        deal_ids = {r.deal_id for r in rules}
        deals = {d.id: d for d in db.query(MergerDeal).filter(MergerDeal.id.in_(deal_ids)).all()}

    return [{
        'id':          r.id,
        'dealId':      r.deal_id,
        'ticker':      deals[r.deal_id].target_ticker.upper() if r.deal_id in deals else '?',
        'companyName': deals[r.deal_id].target_name if r.deal_id in deals else '',
        'alertType':   r.alert_type,
        'label':       _MERGER_ALERT_TYPES.get(r.alert_type, {}).get('label', r.alert_type),
        'params':      json.loads(r.params),
        'createdAt':   str(r.created_at),
    } for r in rules]


@router.post('/api/merger/alerts')
def create_merger_alert(req: MergerAlertCreate):
    if req.alert_type not in _MERGER_ALERT_TYPES:
        raise HTTPException(400, f"Unknown alert_type. Valid: {list(_MERGER_ALERT_TYPES)}")
    with db_session() as db:
        if not db.query(MergerDeal).filter(MergerDeal.id == req.deal_id).first():
            raise HTTPException(404, 'Deal not found')
        rule = MergerAlertRule(deal_id=req.deal_id, alert_type=req.alert_type, params=json.dumps(req.params))
        db.add(rule)
        db.flush()
        return {'id': rule.id}


@router.delete('/api/merger/alerts/{rule_id}')
def delete_merger_alert(rule_id: int):
    with db_session() as db:
        rule = db.query(MergerAlertRule).filter(MergerAlertRule.id == rule_id).first()
        if not rule:
            raise HTTPException(404, 'Rule not found')
        rule.active = 0
    return {'ok': True}


@router.post('/api/merger/alerts/scan')
def scan_merger_alerts():
    with db_session() as db:
        rules = db.query(MergerAlertRule).filter(MergerAlertRule.active == 1).all()
        if not rules:
            return []
        deal_ids = {r.deal_id for r in rules}
        deals = {d.id: d for d in db.query(MergerDeal).filter(MergerDeal.id.in_(deal_ids)).all()}
        rule_list = [{'id': r.id, 'deal_id': r.deal_id, 'alert_type': r.alert_type, 'params': json.loads(r.params)} for r in rules]

    results = []
    with ThreadPoolExecutor(max_workers=min(len(rule_list), 8)) as pool:
        futures = {}
        for r in rule_list:
            deal = deals.get(r['deal_id'])
            if deal is None:
                continue
            futures[pool.submit(_check_merger_alert, r, deal)] = r
        for fut, r in futures.items():
            try:
                outcome = fut.result()
            except Exception as exc:
                logger.warning('merger alert check %s: %s', r['id'], exc)
                continue
            if outcome and outcome.get('triggered'):
                deal = deals[r['deal_id']]
                results.append({
                    'id':          r['id'],
                    'dealId':      r['deal_id'],
                    'ticker':      deal.target_ticker.upper(),
                    'companyName': deal.target_name,
                    'alertType':   r['alert_type'],
                    'label':       _MERGER_ALERT_TYPES.get(r['alert_type'], {}).get('label', r['alert_type']),
                    'detail':      outcome.get('detail', ''),
                })
    return results


