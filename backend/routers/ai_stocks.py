"""AI Stocks — Markets -> AI Growth Watch List.

A curated universe of AI-value-chain stocks (chips, memory, cloud,
networking, power, data centers, software, quantum, robotics) with live
performance stats.

_AI_STOCKS is also imported directly by routers/ai_analyst_actions.py
(no circularity, since this module doesn't depend on that router).
_fetch_perf_one is still in main.py (shared by several other
not-yet-extracted sections) — imported with a function-scoped deferred
import since main.py imports this router to register it, which would
otherwise cycle.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import timedelta
from fastapi import APIRouter

from database import cache_get, cache_set

router = APIRouter()

_AI_TTL = timedelta(minutes=15)

# ── AI stocks ─────────────────────────────────────────────────────────────────

_AI_STOCKS = [
    # Chips & Compute
    {"symbol": "NVDA",  "name": "NVIDIA",             "layer": "Chips & Compute",  "thesis": "GPU monopoly for AI training & inference"},
    {"symbol": "AMD",   "name": "AMD",                "layer": "Chips & Compute",  "thesis": "AI GPU challenger; EPYC data-center CPUs"},
    {"symbol": "AVGO",  "name": "Broadcom",           "layer": "Chips & Compute",  "thesis": "Custom AI ASICs (XPUs) for Google & Meta"},
    {"symbol": "MRVL",  "name": "Marvell Technology", "layer": "Chips & Compute",  "thesis": "Custom AI silicon & high-speed interconnects"},
    {"symbol": "ARM",   "name": "Arm Holdings",       "layer": "Chips & Compute",  "thesis": "CPU architecture powering AI edge & servers"},
    {"symbol": "INTC",  "name": "Intel",              "layer": "Chips & Compute",  "thesis": "Gaudi AI accelerators; leading-edge foundry"},
    {"symbol": "QCOM",  "name": "Qualcomm",           "layer": "Chips & Compute",  "thesis": "On-device AI inference in mobile & PCs"},
    # Memory & Storage
    {"symbol": "MU",    "name": "Micron",             "layer": "Memory & Storage", "thesis": "HBM3E memory essential for AI accelerators"},
    {"symbol": "SMCI",  "name": "Super Micro",        "layer": "Memory & Storage", "thesis": "AI server systems with direct liquid cooling"},
    {"symbol": "WDC",   "name": "Western Digital",    "layer": "Memory & Storage", "thesis": "Flash storage for AI training datasets"},
    # Semiconductor Equipment
    {"symbol": "AMAT",  "name": "Applied Materials",  "layer": "Semi Equipment",   "thesis": "Deposition equipment for advanced AI chips"},
    {"symbol": "LRCX",  "name": "Lam Research",       "layer": "Semi Equipment",   "thesis": "Etch systems for leading-edge nodes"},
    {"symbol": "KLAC",  "name": "KLA Corp",           "layer": "Semi Equipment",   "thesis": "Process control for high-yield AI chip fabs"},
    {"symbol": "ASML",  "name": "ASML",               "layer": "Semi Equipment",   "thesis": "Only maker of EUV machines — gating AI chips"},
    # Cloud & Infrastructure
    {"symbol": "MSFT",  "name": "Microsoft",          "layer": "Cloud & Infra",    "thesis": "Azure AI, OpenAI partnership, Copilot suite"},
    {"symbol": "GOOGL", "name": "Alphabet",           "layer": "Cloud & Infra",    "thesis": "TPU silicon, Gemini models, Google Cloud AI"},
    {"symbol": "AMZN",  "name": "Amazon",             "layer": "Cloud & Infra",    "thesis": "AWS Trainium/Inferentia, Bedrock AI platform"},
    {"symbol": "META",  "name": "Meta",               "layer": "Cloud & Infra",    "thesis": "Llama open-source; massive AI capex cycle"},
    {"symbol": "ORCL",  "name": "Oracle",             "layer": "Cloud & Infra",    "thesis": "OCI GPU clusters; AI database & applications"},
    # Networking
    {"symbol": "ANET",  "name": "Arista Networks",    "layer": "Networking",       "thesis": "Ethernet switches connecting AI GPU clusters"},
    {"symbol": "CSCO",  "name": "Cisco",              "layer": "Networking",       "thesis": "AI networking fabric, Silicon One ASICs"},
    {"symbol": "CIEN",  "name": "Ciena",              "layer": "Networking",       "thesis": "Optical networking backbone for AI traffic"},
    # Power & Cooling
    {"symbol": "VRT",   "name": "Vertiv",             "layer": "Power & Cooling",  "thesis": "Data-center power & liquid cooling systems"},
    {"symbol": "ETN",   "name": "Eaton",              "layer": "Power & Cooling",  "thesis": "Power management & UPS for AI data centers"},
    {"symbol": "GEV",   "name": "GE Vernova",         "layer": "Power & Cooling",  "thesis": "Gas & renewable generation for AI load growth"},
    {"symbol": "CEG",   "name": "Constellation",      "layer": "Power & Cooling",  "thesis": "Nuclear PPA deals with Microsoft & Google"},
    {"symbol": "VST",   "name": "Vistra",             "layer": "Power & Cooling",  "thesis": "Nuclear & gas baseload for 24/7 data centers"},
    {"symbol": "POWL",  "name": "Powell Industries",  "layer": "Power & Cooling",  "thesis": "Switchgear & electrical gear for data centers"},
    # Data Centers
    {"symbol": "EQIX",  "name": "Equinix",            "layer": "Data Centers",     "thesis": "Global colocation hubs for AI cloud workloads"},
    {"symbol": "DLR",   "name": "Digital Realty",     "layer": "Data Centers",     "thesis": "Hyperscale data center REIT expanding for AI"},
    {"symbol": "IRON",  "name": "Iron Mountain",      "layer": "Data Centers",     "thesis": "Data center & storage REIT pivoting to AI"},
    # Software & Applications
    {"symbol": "PLTR",  "name": "Palantir",           "layer": "Software & Apps",  "thesis": "AIP platform bringing AI to enterprise & govt"},
    {"symbol": "CRM",   "name": "Salesforce",         "layer": "Software & Apps",  "thesis": "Agentforce AI agents across enterprise CRM"},
    {"symbol": "NOW",   "name": "ServiceNow",         "layer": "Software & Apps",  "thesis": "AI-powered enterprise workflow automation"},
    {"symbol": "SNOW",  "name": "Snowflake",          "layer": "Software & Apps",  "thesis": "AI data cloud, Cortex AI for enterprise data"},
    {"symbol": "DDOG",  "name": "Datadog",            "layer": "Software & Apps",  "thesis": "AI observability & monitoring for cloud apps"},
    {"symbol": "MDB",   "name": "MongoDB",            "layer": "Software & Apps",  "thesis": "Document DB powering AI application backends"},
    # Cybersecurity
    {"symbol": "CRWD",  "name": "CrowdStrike",        "layer": "Cybersecurity",    "thesis": "AI-native endpoint & cloud security platform"},
    {"symbol": "PANW",  "name": "Palo Alto Networks", "layer": "Cybersecurity",    "thesis": "AI-powered network, cloud & SOC security"},
    {"symbol": "ZS",    "name": "Zscaler",            "layer": "Cybersecurity",    "thesis": "Zero-trust AI security for distributed infra"},
    {"symbol": "S",     "name": "SentinelOne",        "layer": "Cybersecurity",    "thesis": "AI-driven autonomous threat detection & response"},
    # Quantum Computing
    {"symbol": "IONQ",  "name": "IonQ",               "layer": "Quantum Computing","thesis": "Trapped-ion quantum systems; cloud QaaS leader"},
    {"symbol": "RGTI",  "name": "Rigetti Computing",  "layer": "Quantum Computing","thesis": "Superconducting QPUs on AWS & Azure marketplaces"},
    {"symbol": "QUBT",  "name": "Quantum Computing",  "layer": "Quantum Computing","thesis": "Photonic quantum optimization for logistics & finance"},
    {"symbol": "QBTS",  "name": "D-Wave Quantum",     "layer": "Quantum Computing","thesis": "Annealing QPUs for real-world optimization problems"},
    {"symbol": "IBM",   "name": "IBM",                "layer": "Quantum Computing","thesis": "Eagle/Condor QPUs; Qiskit ecosystem & IBM Quantum Network"},
    {"symbol": "ARQQ",  "name": "Arqit Quantum",      "layer": "Quantum Computing","thesis": "Quantum-safe satellite encryption for enterprise & govt"},
    {"symbol": "MSFT",  "name": "Microsoft",          "layer": "Quantum Computing","thesis": "Azure Quantum, topological qubit research program"},
    # Robotics & Automation
    {"symbol": "ISRG",  "name": "Intuitive Surgical", "layer": "Robotics",         "thesis": "Da Vinci surgical robot monopoly; AI-guided procedures"},
    {"symbol": "TER",   "name": "Teradyne",           "layer": "Robotics",         "thesis": "Universal Robots cobots + semiconductor test equipment"},
    {"symbol": "ROK",   "name": "Rockwell Automation","layer": "Robotics",         "thesis": "Industrial automation & AI-driven smart manufacturing"},
    {"symbol": "CGNX",  "name": "Cognex",             "layer": "Robotics",         "thesis": "Machine vision — the eyes of industrial & warehouse robots"},
    {"symbol": "PATH",  "name": "UiPath",             "layer": "Robotics",         "thesis": "RPA + agentic AI automating enterprise software workflows"},
    {"symbol": "ABB",   "name": "ABB Ltd",            "layer": "Robotics",         "thesis": "Global leader in industrial robots & factory automation"},
    {"symbol": "HON",   "name": "Honeywell",          "layer": "Robotics",         "thesis": "Industrial automation, process control & AI sensors"},
    {"symbol": "TSLA",  "name": "Tesla",              "layer": "Robotics",         "thesis": "Optimus humanoid robot; FSD autonomous driving AI"},
    {"symbol": "NVDA",  "name": "NVIDIA",             "layer": "Robotics",         "thesis": "Isaac robotics platform; Jetson edge AI for robots"},
]


@router.get("/api/ai-stocks")
def get_ai_stocks():
    from main import _fetch_perf_one

    cached = cache_get("ai:stocks", _AI_TTL)
    if cached is not None:
        return cached

    unique_syms = list({s["symbol"] for s in _AI_STOCKS})
    perf: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=10) as pool:
        for fut in as_completed({pool.submit(_fetch_perf_one, s): s for s in unique_syms}):
            d = fut.result()
            perf[d["symbol"]] = d

    result = []
    for s in _AI_STOCKS:
        d = perf.get(s["symbol"], {"symbol": s["symbol"]})
        result.append({**d, "name": s["name"], "layer": s["layer"], "thesis": s["thesis"]})

    cache_set("ai:stocks", result)
    return result


