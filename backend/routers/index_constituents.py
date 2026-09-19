"""Index Constituent Heatmap — Markets -> Index Heatmap.

Constituent-level performance and live market-cap weighting for DOW30/
NASDAQ100/SP100 (hardcoded weight approximations as fallback), plus
generic ETF search and holdings lookup for any fund.

_fetch_perf_one is still in main.py (shared by several other
not-yet-extracted sections) — imported with a function-scoped deferred
import since main.py imports this router to register it, which would
otherwise cycle.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import timedelta
import yfinance as yf
from fastapi import APIRouter, HTTPException

from database import cache_get, cache_set
from edgar_utils import _session, _safe_float

router = APIRouter()

# ── Index Constituent Heatmap ─────────────────────────────────────────────────

_INDEX_TTL = timedelta(minutes=15)

_INDEX_CONSTITUENTS: dict[str, list[dict]] = {
    "DOW30": [
        {"symbol": "UNH",  "name": "UnitedHealth Group",   "sector": "Health Care",            "weight": 9.8},
        {"symbol": "GS",   "name": "Goldman Sachs",         "sector": "Financials",             "weight": 9.1},
        {"symbol": "MSFT", "name": "Microsoft",             "sector": "Technology",             "weight": 7.2},
        {"symbol": "V",    "name": "Visa",                  "sector": "Financials",             "weight": 6.1},
        {"symbol": "AMZN", "name": "Amazon",                "sector": "Consumer Discretionary", "weight": 6.0},
        {"symbol": "CAT",  "name": "Caterpillar",           "sector": "Industrials",            "weight": 5.4},
        {"symbol": "HD",   "name": "Home Depot",            "sector": "Consumer Discretionary", "weight": 5.0},
        {"symbol": "SHW",  "name": "Sherwin-Williams",      "sector": "Materials",              "weight": 4.8},
        {"symbol": "JPM",  "name": "JPMorgan Chase",        "sector": "Financials",             "weight": 4.5},
        {"symbol": "HON",  "name": "Honeywell",             "sector": "Industrials",            "weight": 4.2},
        {"symbol": "NVDA", "name": "NVIDIA",                "sector": "Technology",             "weight": 4.0},
        {"symbol": "TRV",  "name": "Travelers",             "sector": "Financials",             "weight": 3.8},
        {"symbol": "MCD",  "name": "McDonald's",            "sector": "Consumer Discretionary", "weight": 3.6},
        {"symbol": "AMGN", "name": "Amgen",                 "sector": "Health Care",            "weight": 3.5},
        {"symbol": "IBM",  "name": "IBM",                   "sector": "Technology",             "weight": 3.3},
        {"symbol": "AAPL", "name": "Apple",                 "sector": "Technology",             "weight": 3.1},
        {"symbol": "CRM",  "name": "Salesforce",            "sector": "Technology",             "weight": 3.0},
        {"symbol": "AXP",  "name": "American Express",      "sector": "Financials",             "weight": 2.9},
        {"symbol": "BA",   "name": "Boeing",                "sector": "Industrials",            "weight": 2.7},
        {"symbol": "MMM",  "name": "3M",                    "sector": "Industrials",            "weight": 2.4},
        {"symbol": "PG",   "name": "Procter & Gamble",      "sector": "Consumer Staples",       "weight": 2.3},
        {"symbol": "JNJ",  "name": "Johnson & Johnson",     "sector": "Health Care",            "weight": 2.2},
        {"symbol": "MRK",  "name": "Merck",                 "sector": "Health Care",            "weight": 2.1},
        {"symbol": "CVX",  "name": "Chevron",               "sector": "Energy",                 "weight": 2.0},
        {"symbol": "WMT",  "name": "Walmart",               "sector": "Consumer Staples",       "weight": 1.9},
        {"symbol": "NKE",  "name": "Nike",                  "sector": "Consumer Discretionary", "weight": 1.8},
        {"symbol": "KO",   "name": "Coca-Cola",             "sector": "Consumer Staples",       "weight": 1.7},
        {"symbol": "DIS",  "name": "Walt Disney",           "sector": "Communication Services", "weight": 1.6},
        {"symbol": "CSCO", "name": "Cisco",                 "sector": "Technology",             "weight": 1.5},
        {"symbol": "VZ",   "name": "Verizon",               "sector": "Communication Services", "weight": 1.4},
    ],
    "NASDAQ100": [
        {"symbol": "MSFT",  "name": "Microsoft",             "sector": "Technology",             "weight": 8.5},
        {"symbol": "AAPL",  "name": "Apple",                 "sector": "Technology",             "weight": 7.5},
        {"symbol": "NVDA",  "name": "NVIDIA",                "sector": "Technology",             "weight": 7.0},
        {"symbol": "AMZN",  "name": "Amazon",                "sector": "Consumer Discretionary", "weight": 5.5},
        {"symbol": "META",  "name": "Meta Platforms",        "sector": "Communication Services", "weight": 4.8},
        {"symbol": "GOOGL", "name": "Alphabet Class A",      "sector": "Communication Services", "weight": 2.5},
        {"symbol": "GOOG",  "name": "Alphabet Class C",      "sector": "Communication Services", "weight": 2.4},
        {"symbol": "TSLA",  "name": "Tesla",                 "sector": "Consumer Discretionary", "weight": 2.8},
        {"symbol": "AVGO",  "name": "Broadcom",              "sector": "Technology",             "weight": 2.5},
        {"symbol": "COST",  "name": "Costco",                "sector": "Consumer Staples",       "weight": 2.0},
        {"symbol": "NFLX",  "name": "Netflix",               "sector": "Communication Services", "weight": 1.6},
        {"symbol": "AMD",   "name": "AMD",                   "sector": "Technology",             "weight": 1.4},
        {"symbol": "ADBE",  "name": "Adobe",                 "sector": "Technology",             "weight": 1.2},
        {"symbol": "PDD",   "name": "PDD Holdings",          "sector": "Consumer Discretionary", "weight": 1.2},
        {"symbol": "QCOM",  "name": "Qualcomm",              "sector": "Technology",             "weight": 1.1},
        {"symbol": "ASML",  "name": "ASML",                  "sector": "Technology",             "weight": 1.1},
        {"symbol": "TXN",   "name": "Texas Instruments",     "sector": "Technology",             "weight": 1.0},
        {"symbol": "CMCSA", "name": "Comcast",               "sector": "Communication Services", "weight": 0.95},
        {"symbol": "INTU",  "name": "Intuit",                "sector": "Technology",             "weight": 0.95},
        {"symbol": "ISRG",  "name": "Intuitive Surgical",    "sector": "Health Care",            "weight": 0.9},
        {"symbol": "BKNG",  "name": "Booking Holdings",      "sector": "Consumer Discretionary", "weight": 0.85},
        {"symbol": "HON",   "name": "Honeywell",             "sector": "Industrials",            "weight": 0.8},
        {"symbol": "AMGN",  "name": "Amgen",                 "sector": "Health Care",            "weight": 0.8},
        {"symbol": "VRTX",  "name": "Vertex Pharmaceuticals","sector": "Health Care",            "weight": 0.75},
        {"symbol": "PANW",  "name": "Palo Alto Networks",    "sector": "Technology",             "weight": 0.7},
        {"symbol": "MU",    "name": "Micron Technology",     "sector": "Technology",             "weight": 0.7},
        {"symbol": "ADP",   "name": "ADP",                   "sector": "Technology",             "weight": 0.65},
        {"symbol": "SBUX",  "name": "Starbucks",             "sector": "Consumer Discretionary", "weight": 0.65},
        {"symbol": "GILD",  "name": "Gilead Sciences",       "sector": "Health Care",            "weight": 0.6},
        {"symbol": "ARM",   "name": "Arm Holdings",          "sector": "Technology",             "weight": 0.6},
        {"symbol": "MDLZ",  "name": "Mondelez",              "sector": "Consumer Staples",       "weight": 0.6},
        {"symbol": "PYPL",  "name": "PayPal",                "sector": "Financials",             "weight": 0.55},
        {"symbol": "ADI",   "name": "Analog Devices",        "sector": "Technology",             "weight": 0.55},
        {"symbol": "REGN",  "name": "Regeneron",             "sector": "Health Care",            "weight": 0.55},
        {"symbol": "NXPI",  "name": "NXP Semiconductors",    "sector": "Technology",             "weight": 0.5},
        {"symbol": "LRCX",  "name": "Lam Research",          "sector": "Technology",             "weight": 0.5},
        {"symbol": "KLAC",  "name": "KLA Corp",              "sector": "Technology",             "weight": 0.5},
        {"symbol": "SNPS",  "name": "Synopsys",              "sector": "Technology",             "weight": 0.5},
        {"symbol": "CDNS",  "name": "Cadence Design",        "sector": "Technology",             "weight": 0.5},
        {"symbol": "MAR",   "name": "Marriott",              "sector": "Consumer Discretionary", "weight": 0.5},
        {"symbol": "MRVL",  "name": "Marvell Technology",    "sector": "Technology",             "weight": 0.45},
        {"symbol": "CSX",   "name": "CSX",                   "sector": "Industrials",            "weight": 0.45},
        {"symbol": "PCAR",  "name": "PACCAR",                "sector": "Industrials",            "weight": 0.45},
        {"symbol": "ORLY",  "name": "O'Reilly Auto",         "sector": "Consumer Discretionary", "weight": 0.45},
        {"symbol": "FTNT",  "name": "Fortinet",              "sector": "Technology",             "weight": 0.45},
        {"symbol": "CPRT",  "name": "Copart",                "sector": "Industrials",            "weight": 0.4},
        {"symbol": "CTAS",  "name": "Cintas",                "sector": "Industrials",            "weight": 0.4},
        {"symbol": "ROP",   "name": "Roper Technologies",    "sector": "Technology",             "weight": 0.4},
        {"symbol": "ABNB",  "name": "Airbnb",                "sector": "Consumer Discretionary", "weight": 0.4},
        {"symbol": "MELI",  "name": "MercadoLibre",          "sector": "Consumer Discretionary", "weight": 0.35},
        {"symbol": "ROST",  "name": "Ross Stores",           "sector": "Consumer Discretionary", "weight": 0.35},
        {"symbol": "MNST",  "name": "Monster Beverage",      "sector": "Consumer Staples",       "weight": 0.35},
        {"symbol": "DXCM",  "name": "DexCom",                "sector": "Health Care",            "weight": 0.35},
        {"symbol": "ODFL",  "name": "Old Dominion Freight",  "sector": "Industrials",            "weight": 0.35},
        {"symbol": "AZN",   "name": "AstraZeneca",           "sector": "Health Care",            "weight": 0.35},
        {"symbol": "APP",   "name": "AppLovin",              "sector": "Technology",             "weight": 0.5},
        {"symbol": "IDXX",  "name": "IDEXX Laboratories",    "sector": "Health Care",            "weight": 0.3},
        {"symbol": "BIIB",  "name": "Biogen",                "sector": "Health Care",            "weight": 0.3},
        {"symbol": "FAST",  "name": "Fastenal",              "sector": "Industrials",            "weight": 0.3},
        {"symbol": "EXC",   "name": "Exelon",                "sector": "Utilities",              "weight": 0.3},
        {"symbol": "CEG",   "name": "Constellation Energy",  "sector": "Utilities",              "weight": 0.3},
        {"symbol": "FANG",  "name": "Diamondback Energy",    "sector": "Energy",                 "weight": 0.3},
        {"symbol": "BKR",   "name": "Baker Hughes",          "sector": "Energy",                 "weight": 0.3},
        {"symbol": "CRWD",  "name": "CrowdStrike",           "sector": "Technology",             "weight": 0.3},
        {"symbol": "TTD",   "name": "Trade Desk",            "sector": "Technology",             "weight": 0.3},
        {"symbol": "VRSK",  "name": "Verisk Analytics",      "sector": "Industrials",            "weight": 0.25},
        {"symbol": "GEHC",  "name": "GE HealthCare",         "sector": "Health Care",            "weight": 0.3},
        {"symbol": "WDAY",  "name": "Workday",               "sector": "Technology",             "weight": 0.3},
        {"symbol": "WBD",   "name": "Warner Bros. Discovery","sector": "Communication Services", "weight": 0.2},
        {"symbol": "ZS",    "name": "Zscaler",               "sector": "Technology",             "weight": 0.2},
        {"symbol": "TEAM",  "name": "Atlassian",             "sector": "Technology",             "weight": 0.2},
        {"symbol": "PLTR",  "name": "Palantir",              "sector": "Technology",             "weight": 0.2},
        {"symbol": "DLTR",  "name": "Dollar Tree",           "sector": "Consumer Staples",       "weight": 0.2},
        {"symbol": "PAYX",  "name": "Paychex",               "sector": "Technology",             "weight": 0.2},
        {"symbol": "TTWO",  "name": "Take-Two Interactive",  "sector": "Communication Services", "weight": 0.2},
        {"symbol": "ANSS",  "name": "ANSYS",                 "sector": "Technology",             "weight": 0.2},
        {"symbol": "XEL",   "name": "Xcel Energy",           "sector": "Utilities",              "weight": 0.2},
        {"symbol": "ON",    "name": "ON Semiconductor",      "sector": "Technology",             "weight": 0.2},
        {"symbol": "ILMN",  "name": "Illumina",              "sector": "Health Care",            "weight": 0.2},
        {"symbol": "LULU",  "name": "Lululemon",             "sector": "Consumer Discretionary", "weight": 0.2},
        {"symbol": "DASH",  "name": "DoorDash",              "sector": "Consumer Discretionary", "weight": 0.3},
        {"symbol": "EA",    "name": "Electronic Arts",       "sector": "Communication Services", "weight": 0.3},
        {"symbol": "SMCI",  "name": "Super Micro Computer",  "sector": "Technology",             "weight": 0.35},
        {"symbol": "MDB",   "name": "MongoDB",               "sector": "Technology",             "weight": 0.2},
        {"symbol": "GEN",   "name": "Gen Digital",           "sector": "Technology",             "weight": 0.2},
        {"symbol": "INTC",  "name": "Intel",                 "sector": "Technology",             "weight": 0.3},
        {"symbol": "ALGN",  "name": "Align Technology",      "sector": "Health Care",            "weight": 0.15},
    ],
    "SP100": [
        {"symbol": "MSFT",  "name": "Microsoft",             "sector": "Technology",             "weight": 7.0},
        {"symbol": "AAPL",  "name": "Apple",                 "sector": "Technology",             "weight": 6.8},
        {"symbol": "NVDA",  "name": "NVIDIA",                "sector": "Technology",             "weight": 6.2},
        {"symbol": "AMZN",  "name": "Amazon",                "sector": "Consumer Discretionary", "weight": 4.2},
        {"symbol": "META",  "name": "Meta Platforms",        "sector": "Communication Services", "weight": 2.8},
        {"symbol": "GOOGL", "name": "Alphabet Class A",      "sector": "Communication Services", "weight": 2.1},
        {"symbol": "GOOG",  "name": "Alphabet Class C",      "sector": "Communication Services", "weight": 1.8},
        {"symbol": "LLY",   "name": "Eli Lilly",             "sector": "Health Care",            "weight": 1.9},
        {"symbol": "AVGO",  "name": "Broadcom",              "sector": "Technology",             "weight": 1.8},
        {"symbol": "TSLA",  "name": "Tesla",                 "sector": "Consumer Discretionary", "weight": 1.7},
        {"symbol": "JPM",   "name": "JPMorgan Chase",        "sector": "Financials",             "weight": 1.6},
        {"symbol": "WMT",   "name": "Walmart",               "sector": "Consumer Staples",       "weight": 1.5},
        {"symbol": "V",     "name": "Visa",                  "sector": "Financials",             "weight": 1.4},
        {"symbol": "UNH",   "name": "UnitedHealth Group",    "sector": "Health Care",            "weight": 1.3},
        {"symbol": "XOM",   "name": "ExxonMobil",            "sector": "Energy",                 "weight": 1.3},
        {"symbol": "ORCL",  "name": "Oracle",                "sector": "Technology",             "weight": 1.2},
        {"symbol": "MA",    "name": "Mastercard",            "sector": "Financials",             "weight": 1.2},
        {"symbol": "COST",  "name": "Costco",                "sector": "Consumer Staples",       "weight": 1.1},
        {"symbol": "NFLX",  "name": "Netflix",               "sector": "Communication Services", "weight": 1.0},
        {"symbol": "JNJ",   "name": "Johnson & Johnson",     "sector": "Health Care",            "weight": 0.9},
        {"symbol": "HD",    "name": "Home Depot",            "sector": "Consumer Discretionary", "weight": 0.9},
        {"symbol": "AMD",   "name": "AMD",                   "sector": "Technology",             "weight": 0.85},
        {"symbol": "ABBV",  "name": "AbbVie",                "sector": "Health Care",            "weight": 0.85},
        {"symbol": "BAC",   "name": "Bank of America",       "sector": "Financials",             "weight": 0.8},
        {"symbol": "PG",    "name": "Procter & Gamble",      "sector": "Consumer Staples",       "weight": 0.8},
        {"symbol": "MRK",   "name": "Merck",                 "sector": "Health Care",            "weight": 0.75},
        {"symbol": "ADBE",  "name": "Adobe",                 "sector": "Technology",             "weight": 0.75},
        {"symbol": "CVX",   "name": "Chevron",               "sector": "Energy",                 "weight": 0.7},
        {"symbol": "KO",    "name": "Coca-Cola",             "sector": "Consumer Staples",       "weight": 0.7},
        {"symbol": "CRM",   "name": "Salesforce",            "sector": "Technology",             "weight": 0.7},
        {"symbol": "ACN",   "name": "Accenture",             "sector": "Technology",             "weight": 0.65},
        {"symbol": "PEP",   "name": "PepsiCo",               "sector": "Consumer Staples",       "weight": 0.65},
        {"symbol": "TMO",   "name": "Thermo Fisher",         "sector": "Health Care",            "weight": 0.65},
        {"symbol": "WFC",   "name": "Wells Fargo",           "sector": "Financials",             "weight": 0.6},
        {"symbol": "LIN",   "name": "Linde",                 "sector": "Materials",              "weight": 0.6},
        {"symbol": "MCD",   "name": "McDonald's",            "sector": "Consumer Discretionary", "weight": 0.6},
        {"symbol": "GE",    "name": "GE Aerospace",          "sector": "Industrials",            "weight": 0.6},
        {"symbol": "IBM",   "name": "IBM",                   "sector": "Technology",             "weight": 0.55},
        {"symbol": "PM",    "name": "Philip Morris",         "sector": "Consumer Staples",       "weight": 0.55},
        {"symbol": "QCOM",  "name": "Qualcomm",              "sector": "Technology",             "weight": 0.55},
        {"symbol": "INTU",  "name": "Intuit",                "sector": "Technology",             "weight": 0.55},
        {"symbol": "NOW",   "name": "ServiceNow",            "sector": "Technology",             "weight": 0.55},
        {"symbol": "AMGN",  "name": "Amgen",                 "sector": "Health Care",            "weight": 0.5},
        {"symbol": "TXN",   "name": "Texas Instruments",     "sector": "Technology",             "weight": 0.5},
        {"symbol": "ISRG",  "name": "Intuitive Surgical",    "sector": "Health Care",            "weight": 0.5},
        {"symbol": "SPGI",  "name": "S&P Global",            "sector": "Financials",             "weight": 0.5},
        {"symbol": "GS",    "name": "Goldman Sachs",         "sector": "Financials",             "weight": 0.5},
        {"symbol": "CAT",   "name": "Caterpillar",           "sector": "Industrials",            "weight": 0.5},
        {"symbol": "AXP",   "name": "American Express",      "sector": "Financials",             "weight": 0.5},
        {"symbol": "BKNG",  "name": "Booking Holdings",      "sector": "Consumer Discretionary", "weight": 0.5},
        {"symbol": "VRTX",  "name": "Vertex Pharmaceuticals","sector": "Health Care",            "weight": 0.45},
        {"symbol": "HON",   "name": "Honeywell",             "sector": "Industrials",            "weight": 0.45},
        {"symbol": "BLK",   "name": "BlackRock",             "sector": "Financials",             "weight": 0.45},
        {"symbol": "UNP",   "name": "Union Pacific",         "sector": "Industrials",            "weight": 0.45},
        {"symbol": "LOW",   "name": "Lowe's",                "sector": "Consumer Discretionary", "weight": 0.45},
        {"symbol": "SYK",   "name": "Stryker",               "sector": "Health Care",            "weight": 0.45},
        {"symbol": "AMAT",  "name": "Applied Materials",     "sector": "Technology",             "weight": 0.45},
        {"symbol": "MS",    "name": "Morgan Stanley",        "sector": "Financials",             "weight": 0.4},
        {"symbol": "NEE",   "name": "NextEra Energy",        "sector": "Utilities",              "weight": 0.4},
        {"symbol": "ETN",   "name": "Eaton",                 "sector": "Industrials",            "weight": 0.4},
        {"symbol": "RTX",   "name": "RTX Corp",              "sector": "Industrials",            "weight": 0.4},
        {"symbol": "SCHW",  "name": "Charles Schwab",        "sector": "Financials",             "weight": 0.4},
        {"symbol": "DE",    "name": "Deere & Company",       "sector": "Industrials",            "weight": 0.4},
        {"symbol": "BSX",   "name": "Boston Scientific",     "sector": "Health Care",            "weight": 0.4},
        {"symbol": "PANW",  "name": "Palo Alto Networks",    "sector": "Technology",             "weight": 0.4},
        {"symbol": "NKE",   "name": "Nike",                  "sector": "Consumer Discretionary", "weight": 0.4},
        {"symbol": "CB",    "name": "Chubb",                 "sector": "Financials",             "weight": 0.4},
        {"symbol": "MMC",   "name": "Marsh McLennan",        "sector": "Financials",             "weight": 0.35},
        {"symbol": "LRCX",  "name": "Lam Research",          "sector": "Technology",             "weight": 0.35},
        {"symbol": "ADI",   "name": "Analog Devices",        "sector": "Technology",             "weight": 0.35},
        {"symbol": "C",     "name": "Citigroup",             "sector": "Financials",             "weight": 0.35},
        {"symbol": "ZTS",   "name": "Zoetis",                "sector": "Health Care",            "weight": 0.35},
        {"symbol": "KLAC",  "name": "KLA Corp",              "sector": "Technology",             "weight": 0.35},
        {"symbol": "PLD",   "name": "Prologis",              "sector": "Real Estate",            "weight": 0.35},
        {"symbol": "COP",   "name": "ConocoPhillips",        "sector": "Energy",                 "weight": 0.35},
        {"symbol": "CI",    "name": "Cigna",                 "sector": "Health Care",            "weight": 0.35},
        {"symbol": "REGN",  "name": "Regeneron",             "sector": "Health Care",            "weight": 0.35},
        {"symbol": "GILD",  "name": "Gilead Sciences",       "sector": "Health Care",            "weight": 0.35},
        {"symbol": "ELV",   "name": "Elevance Health",       "sector": "Health Care",            "weight": 0.35},
        {"symbol": "MU",    "name": "Micron Technology",     "sector": "Technology",             "weight": 0.3},
        {"symbol": "ICE",   "name": "Intercontinental Exchange","sector": "Financials",          "weight": 0.3},
        {"symbol": "SO",    "name": "Southern Company",      "sector": "Utilities",              "weight": 0.3},
        {"symbol": "TGT",   "name": "Target",                "sector": "Consumer Discretionary", "weight": 0.3},
        {"symbol": "CME",   "name": "CME Group",             "sector": "Financials",             "weight": 0.3},
        {"symbol": "AON",   "name": "Aon",                   "sector": "Financials",             "weight": 0.3},
        {"symbol": "MDLZ",  "name": "Mondelez",              "sector": "Consumer Staples",       "weight": 0.3},
        {"symbol": "PNC",   "name": "PNC Financial",         "sector": "Financials",             "weight": 0.3},
        {"symbol": "APH",   "name": "Amphenol",              "sector": "Technology",             "weight": 0.3},
        {"symbol": "FCX",   "name": "Freeport-McMoRan",      "sector": "Materials",              "weight": 0.3},
        {"symbol": "NSC",   "name": "Norfolk Southern",      "sector": "Industrials",            "weight": 0.3},
        {"symbol": "EMR",   "name": "Emerson Electric",      "sector": "Industrials",            "weight": 0.3},
        {"symbol": "TJX",   "name": "TJX Companies",         "sector": "Consumer Discretionary", "weight": 0.3},
        {"symbol": "UBER",  "name": "Uber",                  "sector": "Industrials",            "weight": 0.3},
        {"symbol": "WELL",  "name": "Welltower",             "sector": "Real Estate",            "weight": 0.3},
        {"symbol": "FI",    "name": "Fiserv",                "sector": "Financials",             "weight": 0.3},
        {"symbol": "USB",   "name": "US Bancorp",            "sector": "Financials",             "weight": 0.25},
        {"symbol": "SHW",   "name": "Sherwin-Williams",      "sector": "Materials",              "weight": 0.25},
        {"symbol": "CL",    "name": "Colgate-Palmolive",     "sector": "Consumer Staples",       "weight": 0.25},
        {"symbol": "DUK",   "name": "Duke Energy",           "sector": "Utilities",              "weight": 0.25},
        {"symbol": "APP",   "name": "AppLovin",              "sector": "Technology",             "weight": 0.5},
    ],
    "ARKK": [
        {"symbol": "TSLA",  "name": "Tesla",                  "sector": "Consumer Discretionary", "weight": 7.2},
        {"symbol": "COIN",  "name": "Coinbase",               "sector": "Financials",             "weight": 6.8},
        {"symbol": "RBLX",  "name": "Roblox",                 "sector": "Communication Services", "weight": 5.5},
        {"symbol": "SQ",    "name": "Block (Square)",          "sector": "Financials",             "weight": 5.0},
        {"symbol": "SHOP",  "name": "Shopify",                "sector": "Technology",             "weight": 4.8},
        {"symbol": "ROKU",  "name": "Roku",                   "sector": "Communication Services", "weight": 4.5},
        {"symbol": "PLTR",  "name": "Palantir",               "sector": "Technology",             "weight": 4.2},
        {"symbol": "PATH",  "name": "UiPath",                 "sector": "Technology",             "weight": 3.8},
        {"symbol": "TER",   "name": "Teradyne",               "sector": "Technology",             "weight": 3.5},
        {"symbol": "EXAS",  "name": "Exact Sciences",         "sector": "Health Care",            "weight": 3.2},
        {"symbol": "DKNG",  "name": "DraftKings",             "sector": "Consumer Discretionary", "weight": 3.0},
        {"symbol": "TDOC",  "name": "Teladoc Health",         "sector": "Health Care",            "weight": 2.8},
        {"symbol": "CRSP",  "name": "CRISPR Therapeutics",    "sector": "Health Care",            "weight": 2.8},
        {"symbol": "NTLA",  "name": "Intellia Therapeutics",  "sector": "Health Care",            "weight": 2.5},
        {"symbol": "BEAM",  "name": "Beam Therapeutics",      "sector": "Health Care",            "weight": 2.5},
        {"symbol": "TWST",  "name": "Twist Bioscience",       "sector": "Health Care",            "weight": 2.2},
        {"symbol": "IOVA",  "name": "Iovance Biotherapeutics","sector": "Health Care",            "weight": 2.0},
        {"symbol": "ZM",    "name": "Zoom Video",             "sector": "Technology",             "weight": 2.0},
        {"symbol": "RXRX",  "name": "Recursion Pharmaceuticals","sector": "Health Care",          "weight": 2.0},
        {"symbol": "PSTG",  "name": "Pure Storage",           "sector": "Technology",             "weight": 1.8},
        {"symbol": "FATE",  "name": "Fate Therapeutics",      "sector": "Health Care",            "weight": 1.5},
        {"symbol": "U",     "name": "Unity Software",         "sector": "Technology",             "weight": 1.5},
        {"symbol": "HOOD",  "name": "Robinhood Markets",      "sector": "Financials",             "weight": 1.2},
        {"symbol": "DNA",   "name": "Ginkgo Bioworks",        "sector": "Health Care",            "weight": 1.2},
        {"symbol": "ACMR",  "name": "ACM Research",           "sector": "Technology",             "weight": 1.2},
        {"symbol": "SEER",  "name": "Seer Bio",               "sector": "Health Care",            "weight": 1.0},
        {"symbol": "LCID",  "name": "Lucid Group",            "sector": "Consumer Discretionary", "weight": 1.0},
        {"symbol": "OPEN",  "name": "Opendoor Technologies",  "sector": "Real Estate",            "weight": 0.8},
        {"symbol": "NKLA",  "name": "Nikola",                 "sector": "Consumer Discretionary", "weight": 0.8},
        {"symbol": "CLOV",  "name": "Clover Health",          "sector": "Health Care",            "weight": 0.7},
    ],
}

_INDEX_LABELS = {
    "DOW30":     "Dow Jones 30",
    "NASDAQ100": "Nasdaq 100",
    "SP100":     "S&P Top 100",
    "ARKK":      "ARK Innovation",
}


def _fetch_market_cap(sym: str) -> tuple[str, float | None]:
    try:
        fi = yf.Ticker(sym, session=_session).fast_info
        return sym, _safe_float(fi.market_cap)
    except Exception:
        return sym, None


@router.get("/api/index-constituents")
def get_index_constituents(index: str = "DOW30"):
    from main import _fetch_perf_one

    index = index.upper()
    if index not in _INDEX_CONSTITUENTS:
        raise HTTPException(400, f"Unknown index '{index}'. Valid: {list(_INDEX_CONSTITUENTS.keys())}")

    cache_key = f"index:constituents:{index}"
    cached = cache_get(cache_key, _INDEX_TTL)
    if cached is not None:
        return cached

    meta = _INDEX_CONSTITUENTS[index]
    symbols = [c["symbol"] for c in meta]
    meta_map = {c["symbol"]: c for c in meta}

    perfs: dict[str, dict] = {}
    market_caps: dict[str, float | None] = {}

    with ThreadPoolExecutor(max_workers=20) as pool:
        perf_futs  = {pool.submit(_fetch_perf_one,    s): ("perf", s) for s in symbols}
        cap_futs   = {pool.submit(_fetch_market_cap,  s): ("cap",  s) for s in symbols}
        all_futs   = {**perf_futs, **cap_futs}
        for fut in as_completed(all_futs):
            kind, _ = all_futs[fut]
            if kind == "perf":
                d = fut.result()
                perfs[d["symbol"]] = d
            else:
                sym, cap = fut.result()
                market_caps[sym] = cap

    # Compute actual market-cap weights as % of the index universe
    total_cap = sum(v for v in market_caps.values() if v)

    result = []
    for sym in symbols:
        d   = perfs.get(sym, {"symbol": sym})
        m   = meta_map[sym]
        cap = market_caps.get(sym)
        actual_weight = round(cap / total_cap * 100, 2) if cap and total_cap else None
        ret_1d        = d.get("1d")
        # Weighted contribution to the index's 1D return (weight × return / 100)
        wt_contribution = round(actual_weight * ret_1d / 100, 4) if actual_weight and ret_1d is not None else None
        result.append({
            "symbol":        sym,
            "name":          m["name"],
            "sector":        m["sector"],
            "indexWeight":   m["weight"],        # hardcoded approx (fallback)
            "actualWeight":  actual_weight,      # live market-cap weight
            "marketCap":     cap,
            "wtContribution": wt_contribution,   # weight × 1D return (basis pts style)
            "price":         d.get("price"),
            "1d":            ret_1d,
            "5d":            d.get("5d"),
            "1m":            d.get("1m"),
            "3m":            d.get("3m"),
            "6m":            d.get("6m"),
            "1y":            d.get("1y"),
            "ytd":           d.get("ytd"),
        })

    cache_set(cache_key, result)
    return result


@router.get("/api/search-etf")
def search_etf(q: str):
    """Search Yahoo Finance for ETFs/indices matching a query string."""
    q = q.strip()
    if len(q) < 1:
        return []
    try:
        url = "https://query1.finance.yahoo.com/v1/finance/search"
        params = {
            "q": q,
            "quotesCount": 20,
            "enableFuzzyQuery": True,
            "quotesQueryId": "tss_match_phrase_query",
        }
        resp = _session.get(url, params=params, timeout=6)
        data = resp.json()
        quotes = data.get("quotes", [])
        results = []
        for item in quotes:
            qt = item.get("quoteType", "")
            if qt not in ("ETF", "INDEX", "MUTUALFUND"):
                continue
            results.append({
                "symbol":   item.get("symbol", ""),
                "name":     item.get("longname") or item.get("shortname") or "",
                "type":     qt,
                "exchange": item.get("exchange", ""),
            })
        return results[:12]
    except Exception as e:
        raise HTTPException(500, str(e))


@router.get("/api/etf-holdings")
def get_etf_holdings(etf: str):
    """Fetch constituent holdings for any ETF/fund via yfinance funds_data."""
    from main import _fetch_perf_one

    etf = etf.upper().strip()
    cache_key = f"etf:holdings:{etf}"
    cached = cache_get(cache_key, _INDEX_TTL)
    if cached is not None:
        return cached

    try:
        ticker = yf.Ticker(etf, session=_session)
        fd = ticker.funds_data
        holdings_df = fd.top_holdings
    except Exception as e:
        raise HTTPException(400, f"Could not fetch holdings for '{etf}': {e}")

    if holdings_df is None or holdings_df.empty:
        raise HTTPException(404, f"No holdings data found for '{etf}'")

    # top_holdings index = symbol; columns include holdingName, holdingPercent
    symbols = [s for s in holdings_df.index.tolist() if isinstance(s, str) and s]
    name_map   = {}
    weight_map = {}
    for sym in symbols:
        row = holdings_df.loc[sym]
        name_map[sym]   = row.get("holdingName", sym) if hasattr(row, "get") else sym
        pct = row.get("holdingPercent") if hasattr(row, "get") else None
        weight_map[sym] = float(pct) * 100 if pct is not None else None

    if not symbols:
        raise HTTPException(404, f"No holdings data found for '{etf}'")

    perfs: dict[str, dict] = {}
    market_caps: dict[str, float | None] = {}

    with ThreadPoolExecutor(max_workers=20) as pool:
        perf_futs = {pool.submit(_fetch_perf_one,   s): ("perf", s) for s in symbols}
        cap_futs  = {pool.submit(_fetch_market_cap, s): ("cap",  s) for s in symbols}
        all_futs  = {**perf_futs, **cap_futs}
        for fut in as_completed(all_futs):
            kind, _ = all_futs[fut]
            if kind == "perf":
                d = fut.result()
                perfs[d["symbol"]] = d
            else:
                sym, cap = fut.result()
                market_caps[sym] = cap

    total_cap = sum(v for v in market_caps.values() if v)
    # Prefer reported fund weight; fall back to market-cap weight

    result = []
    for sym in symbols:
        d   = perfs.get(sym, {"symbol": sym})
        cap = market_caps.get(sym)

        # Actual weight: use fund-reported percent if available, else derive from mkt cap
        reported_wt = weight_map.get(sym)
        if reported_wt is not None:
            actual_weight = round(reported_wt, 2)
        elif cap and total_cap:
            actual_weight = round(cap / total_cap * 100, 2)
        else:
            actual_weight = None

        ret_1d = d.get("1d")
        wt_contribution = round(actual_weight * ret_1d / 100, 4) if actual_weight and ret_1d is not None else None

        result.append({
            "symbol":         sym,
            "name":           name_map.get(sym, sym),
            "sector":         d.get("sector", ""),
            "indexWeight":    actual_weight,   # reported fund weight %
            "actualWeight":   actual_weight,
            "marketCap":      cap,
            "wtContribution": wt_contribution,
            "price":          d.get("price"),
            "1d":             ret_1d,
            "5d":             d.get("5d"),
            "1m":             d.get("1m"),
            "3m":             d.get("3m"),
            "6m":             d.get("6m"),
            "1y":             d.get("1y"),
            "ytd":            d.get("ytd"),
        })

    cache_set(cache_key, result)
    return result


