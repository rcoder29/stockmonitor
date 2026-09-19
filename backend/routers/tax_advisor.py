"""Tax Advisor — Portfolio -> Tax Advisor.

Streams a dollar-quantified, state-aware tax optimization plan for a
married-filing-jointly household from Claude.
"""
import json
import logging
import os
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from anthropic import Anthropic

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Tax Advisor ───────────────────────────────────────────────────────────────

# 2025 state income tax rates (top marginal rate for MFJ; 0 = no income tax)
_STATE_TAX: dict[str, float] = {
    "AL": 5.0,  "AK": 0.0,  "AZ": 2.5,  "AR": 4.4,  "CA": 13.3, "CO": 4.4,
    "CT": 6.99, "DE": 6.6,  "FL": 0.0,  "GA": 5.39, "HI": 11.0, "ID": 5.8,
    "IL": 4.95, "IN": 3.05, "IA": 5.7,  "KS": 5.7,  "KY": 4.0,  "LA": 4.25,
    "ME": 7.15, "MD": 5.75, "MA": 5.0,  "MI": 4.05, "MN": 9.85, "MS": 4.7,
    "MO": 4.95, "MT": 5.9,  "NE": 5.84, "NV": 0.0,  "NH": 3.0,  "NJ": 10.75,
    "NM": 5.9,  "NY": 10.9, "NC": 4.5,  "ND": 2.5,  "OH": 3.99, "OK": 4.75,
    "OR": 9.9,  "PA": 3.07, "RI": 5.99, "SC": 6.4,  "SD": 0.0,  "TN": 0.0,
    "TX": 0.0,  "UT": 4.65, "VT": 8.75, "VA": 5.75, "WA": 0.0,  "WV": 5.12,
    "WI": 7.65, "WY": 0.0,  "DC": 10.75,
}

_STATE_NAMES: dict[str, str] = {
    "AL":"Alabama","AK":"Alaska","AZ":"Arizona","AR":"Arkansas","CA":"California",
    "CO":"Colorado","CT":"Connecticut","DE":"Delaware","FL":"Florida","GA":"Georgia",
    "HI":"Hawaii","ID":"Idaho","IL":"Illinois","IN":"Indiana","IA":"Iowa","KS":"Kansas",
    "KY":"Kentucky","LA":"Louisiana","ME":"Maine","MD":"Maryland","MA":"Massachusetts",
    "MI":"Michigan","MN":"Minnesota","MS":"Mississippi","MO":"Missouri","MT":"Montana",
    "NE":"Nebraska","NV":"Nevada","NH":"New Hampshire","NJ":"New Jersey","NM":"New Mexico",
    "NY":"New York","NC":"North Carolina","ND":"North Dakota","OH":"Ohio","OK":"Oklahoma",
    "OR":"Oregon","PA":"Pennsylvania","RI":"Rhode Island","SC":"South Carolina",
    "SD":"South Dakota","TN":"Tennessee","TX":"Texas","UT":"Utah","VT":"Vermont",
    "VA":"Virginia","WA":"Washington","WV":"West Virginia","WI":"Wisconsin","WY":"Wyoming",
    "DC":"Washington D.C.",
}

_TAX_ADVISOR_SYSTEM = """You are an expert US tax strategist specialising in tax optimisation for married-filing-jointly (MFJ) households. You have deep knowledge of:
- 2025 federal income tax brackets, deductions, and credits for MFJ filers
- All 50 state income tax systems and their quirks (community property states, special deductions, credits)
- Tax-advantaged accounts: Traditional 401(k), Roth 401(k), IRA, Roth IRA, HSA, FSA, 529, SEP-IRA, Solo 401(k)
- Investment tax strategy: long-term capital gains rates, qualified dividends, tax-loss harvesting, asset location
- Above-the-line deductions: student loan interest, educator expenses, alimony (pre-2019), HSA contributions, self-employed health insurance, SE tax deduction, QBI (Section 199A)
- Itemised deductions: mortgage interest (SALT cap), charitable giving (bunching, DAF, QCD), medical expenses
- Credits: Child Tax Credit, Child and Dependent Care Credit, Earned Income Credit, Saver's Credit, American Opportunity Credit
- SECURE 2.0: RMD age 73, catch-up contribution changes, Roth 401k RMD elimination
- Backdoor Roth and Mega Backdoor Roth strategies
- Self-employment tax strategies: QBI deduction, S-Corp election considerations
- AMT, NIIT (3.8% net investment income tax on income above $250k MFJ)

Output format — always use exactly these section headers with markdown:
## 📊 Your 2025 Tax Snapshot
## 🎯 Priority Actions (Biggest Impact First)
## 💼 Retirement Account Optimisation
## 📉 Deduction Strategy
## 💰 Investment Tax Efficiency
## 🏠 {State} State Tax Tips
## ⚠️ Watch-Out Situations
## 📅 Year-End Checklist

Be specific with dollar amounts. Rank actions by estimated tax savings. Note when advice requires verification with a CPA."""


class TaxAdvisorRequest(BaseModel):
    state: str
    wages: float = 0
    self_emp_income: float = 0
    short_term_gains: float = 0
    long_term_gains: float = 0
    qualified_dividends: float = 0
    rental_income: float = 0
    other_income: float = 0
    trad_401k_contrib: float = 0
    roth_401k_contrib: float = 0
    ira_contrib: float = 0
    hsa_contrib: float = 0
    fsa_contrib: float = 0
    mortgage_interest: float = 0
    property_taxes: float = 0
    charitable: float = 0
    student_loan_interest: float = 0
    childcare_expenses: float = 0
    num_children: int = 0
    ages_over_50: int = 0          # 0, 1, or 2 spouses aged 50+
    has_employer_health: bool = True
    is_self_employed: bool = False
    has_hsa_eligible_plan: bool = False


@router.post("/api/tax/advisor")
def tax_advisor(req: TaxAdvisorRequest):
    state_abbr = req.state.upper()
    state_name = _STATE_NAMES.get(state_abbr, state_abbr)
    state_rate = _STATE_TAX.get(state_abbr, 0.0)

    gross_income = (req.wages + req.self_emp_income + req.short_term_gains +
                    req.long_term_gains + req.qualified_dividends +
                    req.rental_income + req.other_income)

    # 401k limits 2025
    limit_401k = 23500
    catchup_401k = 7500
    limit_ira = 7000
    catchup_ira = 1000
    limit_hsa_family = 8300

    # Rough AGI estimate
    se_deduction = req.self_emp_income * 0.5 * 0.1530 if req.is_self_employed else 0
    agi_est = gross_income - req.trad_401k_contrib - se_deduction - req.student_loan_interest

    # 2025 MFJ federal brackets
    brackets = [
        (23850, 0.10), (96950, 0.12), (206700, 0.22),
        (394600, 0.24), (501050, 0.32), (751600, 0.35), (float('inf'), 0.37)
    ]
    std_ded = 30000
    taxable = max(0, agi_est - std_ded)
    fed_tax = 0.0
    prev = 0.0
    for cap, rate in brackets:
        if taxable <= prev:
            break
        fed_tax += min(taxable, cap) * rate - prev * rate
        prev = cap

    # LTCG rate
    ltcg_rate = 0.0 if agi_est <= 94050 else (0.15 if agi_est <= 583750 else 0.20)
    niit = 0.038 * max(0, req.long_term_gains + req.qualified_dividends) if agi_est > 250000 else 0.0
    state_tax_est = agi_est * (state_rate / 100)

    prompt = f"""Analyse this married-filing-jointly household's 2025 tax situation and provide a comprehensive, actionable tax-saving plan.

## HOUSEHOLD PROFILE

**State:** {state_name} ({state_abbr}) — top marginal state rate: {state_rate}%{"  (no state income tax)" if state_rate == 0 else ""}

### Income
- W-2 / Salary wages: ${req.wages:,.0f}
- Self-employment income: ${req.self_emp_income:,.0f}{"  (self-employed)" if req.is_self_employed else ""}
- Short-term capital gains: ${req.short_term_gains:,.0f}
- Long-term capital gains: ${req.long_term_gains:,.0f}
- Qualified dividends: ${req.qualified_dividends:,.0f}
- Rental income: ${req.rental_income:,.0f}
- Other income: ${req.other_income:,.0f}
- **Gross Income Total: ${gross_income:,.0f}**

### Current Retirement Contributions
- Traditional 401(k): ${req.trad_401k_contrib:,.0f} (2025 limit: ${limit_401k:,} per person{f", + ${catchup_401k:,} catch-up if 50+" if req.ages_over_50 > 0 else ""})
- Roth 401(k): ${req.roth_401k_contrib:,.0f}
- IRA contributions: ${req.ira_contrib:,.0f} (2025 limit: ${limit_ira:,} per person{f", + ${catchup_ira:,} catch-up if 50+" if req.ages_over_50 > 0 else ""})
- HSA contributions: ${req.hsa_contrib:,.0f} (2025 family limit: ${limit_hsa_family:,})
- FSA contributions: ${req.fsa_contrib:,.0f}
- Spouses aged 50+: {req.ages_over_50}

### Deductions Paid
- Mortgage interest: ${req.mortgage_interest:,.0f}
- Property taxes: ${req.property_taxes:,.0f}
- Charitable contributions: ${req.charitable:,.0f}
- Student loan interest: ${req.student_loan_interest:,.0f}
- Child/dependent care expenses: ${req.childcare_expenses:,.0f}
- Number of qualifying children: {req.num_children}

### Other Factors
- Employer-sponsored health insurance: {"Yes" if req.has_employer_health else "No"}
- HSA-eligible high-deductible health plan: {"Yes" if req.has_hsa_eligible_plan else "No"}
- Self-employed: {"Yes" if req.is_self_employed else "No"}

## QUICK ESTIMATES (pre-optimisation)
- Estimated AGI: ${agi_est:,.0f}
- Estimated Federal Tax: ${fed_tax:,.0f} (before credits)
- Long-term capital gains rate: {ltcg_rate*100:.0f}%{" + 3.8% NIIT" if niit > 0 else ""}
- Estimated {state_name} State Tax: ${state_tax_est:,.0f}
- Combined Estimated Tax Burden: ${fed_tax + niit + state_tax_est:,.0f}
- Estimated Effective Rate: {(fed_tax + niit + state_tax_est) / gross_income * 100:.1f}% of gross income

Now provide a comprehensive, specific, dollar-quantified tax savings plan. Follow the required output format with all 8 section headers. Replace {{State}} in the header with "{state_name}". Focus on actions with the highest dollar impact. Be precise — use the actual 2025 limits and bracket numbers."""

    def generate():
        try:
            client = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))
            with client.messages.stream(
                model="claude-sonnet-4-6",
                max_tokens=4000,
                system=[{"type": "text", "text": _TAX_ADVISOR_SYSTEM,
                         "cache_control": {"type": "ephemeral"}}],
                messages=[{"role": "user", "content": prompt}],
            ) as stream:
                for text in stream.text_stream:
                    yield f"data: {json.dumps({'text': text})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
        except Exception as exc:
            logger.error("Tax advisor error: %s", exc)
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


