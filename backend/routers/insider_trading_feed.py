"""Insider Trading Feed — Markets -> Insider Trading.

Market-wide insider buy/sell feed across a curated ~150-symbol universe,
with cluster-buy detection and C-suite flagging.
"""
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
import pandas as pd
import yfinance as yf
from fastapi import APIRouter

from database import cache_get, cache_set
from edgar_utils import _session, _safe_float, _INSIDER_TTL

logger = logging.getLogger(__name__)
router = APIRouter()


_INSIDER_UNIVERSE = [
    # Mega-cap tech
    "AAPL","MSFT","NVDA","GOOGL","META","AMZN","TSLA","AVGO","ORCL","AMD",
    "INTC","QCOM","TXN","MU","AMAT","LRCX","KLAC","CRM","NOW","SNOW",
    "DDOG","CRWD","NET","MDB","PLTR","SMCI","MSTR","COIN","HOOD","SOFI",
    "AFRM","UPST","PYPL","SHOP","SQ","UBER","LYFT","ABNB","DASH","SNAP",
    "PINS","RDDT","RBLX","ZM","PATH","AI","SOUN","IONQ","RKLB","ASTS",
    # Financials
    "JPM","BAC","GS","MS","WFC","C","BLK","V","MA","AXP","SCHW",
    "COF","USB","PNC","TFC","SPGI","MCO","ICE","CME","CB","MET",
    # Healthcare
    "UNH","LLY","JNJ","ABBV","MRK","PFE","TMO","ABT","DHR","AMGN",
    "GILD","REGN","BIIB","VRTX","MRNA","BMY","ISRG","BSX","MDT","SYK",
    # Consumer
    "COST","WMT","TGT","HD","LOW","MCD","SBUX","NKE","AMZN","CMG",
    "YUM","DPZ","DKNG","PENN","WYNN","MGM","CZR","F","GM","RIVN","LCID",
    # Industrials & Energy
    "CAT","DE","HON","UPS","FDX","RTX","GE","BA","LMT","NOC","GD",
    "XOM","CVX","COP","EOG","SLB","OXY","MPC","VLO","PSX","HAL",
    "UNP","CSX","NSC","CP","CNI",
    # Biotech / small-cap (most insider activity)
    "NVAX","SAVA","ACAD","SRPT","MDGL","VKTX","ARWR","KRYS","SAGE","RVNC",
    "NKTR","RXRX","NTLA","BEAM","EDIT","CRSP","FATE","KYMR","IMVT","TMDX",
    # Other notable
    "DIS","NFLX","CMCSA","T","VZ","TMUS","CHTR","PARA","WBD",
    "AMT","PLD","CCI","EQIX","SPG","O","VICI",
    "BRK-B","V","MA","BRKR","ROP","IDXX","PODD","INSP",
]
_INSIDER_UNIVERSE = list(dict.fromkeys(_INSIDER_UNIVERSE))

_CSUITE_TITLES = {
    "ceo","chief executive","president","cfo","chief financial",
    "coo","chief operating","cto","chief technology","chairman",
    "vice chairman","exec","executive vice",
}

def _is_csuite(title: str) -> bool:
    t = (title or "").lower()
    return any(k in t for k in _CSUITE_TITLES)

def _parse_insider_tx(sym: str) -> list[dict]:
    try:
        ticker = yf.Ticker(sym, session=_session)
        df = ticker.insider_transactions
        if df is None or df.empty:
            return []

        df.columns = [c.strip() for c in df.columns]

        # yfinance uses "Start Date" for the transaction date
        date_col = next(
            (c for c in df.columns if "start date" in c.lower() or c.lower() == "date"),
            None
        )
        if date_col is None:
            return []

        # Get company name
        try:
            name = ticker.fast_info.company_name or sym
        except Exception:
            name = sym

        rows = []
        for _, row in df.iterrows():
            text     = str(row.get("Text", "")).strip()
            insider  = str(row.get("Insider", "")).strip()
            position = str(row.get("Position", "")).strip()
            shares   = _safe_float(row.get("Shares")) or 0
            value    = _safe_float(row.get("Value"))
            date_raw = row.get(date_col, "")

            if not insider or insider.lower() in ("nan", "none", ""):
                continue

            text_lower = text.lower()

            # Classify by the Text description (most reliable)
            is_buy  = "purchase" in text_lower or "acquired" in text_lower
            is_sale = "sale" in text_lower or "sold" in text_lower

            # Exclude non-discretionary events
            if any(x in text_lower for x in ["gift", "grant", "award", "option", "automatic", "disposition", "return", "transfer"]):
                continue
            if not is_buy and not is_sale:
                continue

            # Normalise date
            try:
                date_str = pd.to_datetime(date_raw).strftime("%Y-%m-%d")
            except Exception:
                date_str = str(date_raw)[:10] if date_raw else ""

            if not date_str:
                continue

            # Extract per-share price from Text when Value is missing
            price = None
            if value and shares and shares > 0:
                price = value / shares
            else:
                import re
                m = re.search(r"price\s+([\d,.]+)", text_lower)
                if m:
                    try:
                        price = float(m.group(1).replace(",", ""))
                        if not value and shares:
                            value = price * shares
                    except Exception:
                        pass

            rows.append({
                "symbol":   sym,
                "company":  name,
                "insider":  insider,
                "title":    position,
                "type":     "Buy" if is_buy else "Sale",
                "isBuy":    is_buy,
                "isCsuite": _is_csuite(position),
                "shares":   int(shares),
                "value":    int(value) if value else None,
                "price":    round(price, 2) if price else None,
                "date":     date_str,
            })
        return rows
    except Exception as exc:
        logger.debug("Insider fetch %s: %s", sym, exc)
        return []


@router.get("/api/market/insider-feed")
def get_insider_feed(days: int = 30):
    cache_key = f"market:insider-feed:{days}"
    cached = cache_get(cache_key, _INSIDER_TTL)
    if cached is not None:
        return cached

    all_tx: list[dict] = []
    with ThreadPoolExecutor(max_workers=20) as pool:
        futures = {pool.submit(_parse_insider_tx, sym): sym for sym in _INSIDER_UNIVERSE}
        for fut in as_completed(futures):
            all_tx.extend(fut.result())

    # Filter to requested window
    cutoff = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    all_tx = [t for t in all_tx if t["date"] >= cutoff]

    # Cluster detection: count unique insiders buying per symbol in window
    from collections import Counter
    buy_counts  = Counter(t["symbol"] for t in all_tx if t["isBuy"])
    sale_counts = Counter(t["symbol"] for t in all_tx if not t["isBuy"])

    for t in all_tx:
        t["clusterCount"] = buy_counts[t["symbol"]] if t["isBuy"] else sale_counts[t["symbol"]]

    # Sort: most recent first, then by value
    all_tx.sort(key=lambda t: (t["date"], t["value"] or 0), reverse=True)

    buys  = [t for t in all_tx if t["isBuy"]]
    sales = [t for t in all_tx if not t["isBuy"]]
    total_buy_value = sum(t["value"] or 0 for t in buys)
    cluster_syms = {sym for sym, cnt in buy_counts.items() if cnt >= 2}
    largest = max(buys, key=lambda t: t["value"] or 0) if buys else None

    result = {
        "transactions": all_tx[:300],
        "summary": {
            "totalBuys":      len(buys),
            "totalSales":     len(sales),
            "totalBuyValue":  total_buy_value,
            "clusterSymbols": len(cluster_syms),
            "largestBuy":     largest,
        },
        "days":  days,
        "asOf":  datetime.now().strftime("%Y-%m-%d %H:%M"),
    }
    cache_set(cache_key, result)
    return result


