"""Crypto Dashboard — Markets -> Crypto.

Top-20 coins by market cap with 24h/7d performance, BTC/ETH dominance,
and the Fear & Greed Index.
"""
import json
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
import yfinance as yf
from fastapi import APIRouter

from database import cache_get, cache_set
from edgar_utils import _session, _safe_float

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Crypto Dashboard ─────────────────────────────────────────────────────────

_CRYPTO_TTL = timedelta(minutes=5)

_CRYPTO_SYMBOLS = [
    "BTC-USD","ETH-USD","BNB-USD","SOL-USD","XRP-USD",
    "ADA-USD","AVAX-USD","DOGE-USD","DOT-USD","LINK-USD",
    "LTC-USD","BCH-USD","ATOM-USD","FIL-USD","ALGO-USD",
    "XLM-USD","NEAR-USD","TRX-USD","TON11419-USD","SUI20947-USD",
]

_CRYPTO_NAMES = {
    "BTC-USD":"Bitcoin","ETH-USD":"Ethereum","BNB-USD":"BNB",
    "SOL-USD":"Solana","XRP-USD":"XRP","ADA-USD":"Cardano",
    "AVAX-USD":"Avalanche","DOGE-USD":"Dogecoin","DOT-USD":"Polkadot",
    "LINK-USD":"Chainlink","LTC-USD":"Litecoin","BCH-USD":"Bitcoin Cash",
    "ATOM-USD":"Cosmos","FIL-USD":"Filecoin","ALGO-USD":"Algorand",
    "XLM-USD":"Stellar","NEAR-USD":"NEAR Protocol","TRX-USD":"TRON",
    "TON11419-USD":"Toncoin","SUI20947-USD":"Sui",
}


def _fetch_crypto(sym: str) -> dict | None:
    try:
        t = yf.Ticker(sym, session=_session)
        fi = t.fast_info
        price = _safe_float(fi.last_price)
        prev  = _safe_float(fi.previous_close)
        if price is None:
            return None
        chg_pct = (price - prev) / prev * 100 if prev else None
        mkt_cap = _safe_float(fi.market_cap)
        volume  = _safe_float(fi.last_volume)
        # fast_info.market_cap is often None for crypto; fall back to info dict
        if mkt_cap is None:
            try:
                mkt_cap = _safe_float(t.info.get("marketCap"))
            except Exception:
                pass

        # 7-day performance
        try:
            hist = t.history(period="8d")
            week_ago = float(hist["Close"].iloc[0]) if len(hist) >= 7 else None
            chg_7d = (price - week_ago) / week_ago * 100 if week_ago else None
        except Exception:
            chg_7d = None

        return {
            "symbol":   sym,
            "name":     _CRYPTO_NAMES.get(sym, sym.replace("-USD", "")),
            "price":    price,
            "change24h": round(chg_pct, 2) if chg_pct is not None else None,
            "change7d":  round(chg_7d,  2) if chg_7d  is not None else None,
            "marketCap": mkt_cap,
            "volume24h": volume,
        }
    except Exception as exc:
        logger.debug("Crypto fetch %s: %s", sym, exc)
        return None


def _fetch_fear_greed() -> dict | None:
    try:
        import urllib.request
        url = "https://api.alternative.me/fng/?limit=1&format=json"
        with urllib.request.urlopen(url, timeout=5) as r:
            data = json.loads(r.read())
        entry = data["data"][0]
        return {"value": int(entry["value"]), "label": entry["value_classification"]}
    except Exception:
        return None


@router.get("/api/market/crypto")
def get_crypto_dashboard():
    cache_key = "market:crypto"
    cached = cache_get(cache_key, _CRYPTO_TTL)
    if cached is not None:
        return cached

    coins: list[dict] = []
    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = {pool.submit(_fetch_crypto, sym): sym for sym in _CRYPTO_SYMBOLS}
        fg_future = pool.submit(_fetch_fear_greed)
        for fut in as_completed(futures):
            c = fut.result()
            if c:
                coins.append(c)
        fear_greed = fg_future.result()

    sym_order = {s: i for i, s in enumerate(_CRYPTO_SYMBOLS)}
    coins.sort(key=lambda c: (-(c.get("marketCap") or 0), sym_order.get(c["symbol"], 99)))

    total_cap = sum(c["marketCap"] or 0 for c in coins)
    btc_cap   = next((c["marketCap"] or 0 for c in coins if c["symbol"] == "BTC-USD"), 0)
    eth_cap   = next((c["marketCap"] or 0 for c in coins if c["symbol"] == "ETH-USD"), 0)
    btc_dom   = round(btc_cap / total_cap * 100, 1) if total_cap else None
    eth_dom   = round(eth_cap / total_cap * 100, 1) if total_cap else None

    result = {
        "coins":        coins,
        "totalMarketCap": total_cap,
        "btcDominance":   btc_dom,
        "ethDominance":   eth_dom,
        "fearGreed":      fear_greed,
        "asOf":           datetime.now().strftime("%H:%M"),
    }
    cache_set(cache_key, result)
    return result


