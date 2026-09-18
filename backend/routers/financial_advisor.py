"""Financial Advisor — full investment-strategy generator (CFP persona, Claude).
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

# ── Financial Advisor ─────────────────────────────────────────────────────────

_PLANNER_SYSTEM = """You are an expert Certified Financial Planner (CFP) and portfolio manager with 20+ years of experience in asset allocation, retirement planning, tax-efficient investing, and wealth management.

CRITICAL OUTPUT FORMAT — follow exactly:

Your response MUST begin with this allocation JSON block (no text before it):
```allocation
{"Asset Class Name": integer_percentage, ...}
```
All allocation percentages must be whole integers summing to exactly 100.
Use precise asset class names such as: US Large Cap Equities, US Small/Mid Cap, International Developed Markets, Emerging Markets, US Investment Grade Bonds, US Treasuries/TIPS, High Yield Bonds, International Bonds, REITs, Commodities/Gold, Cash & Equivalents, Alternative Investments.

After the block, provide analysis in these EXACT sections with ## headings:

## Strategy Overview
2-3 sentences on the philosophy and rationale for this specific investor profile.

## Asset Class Breakdown
A markdown table with columns: | Asset Class | Allocation | Role in Portfolio | Recommended ETFs (ticker) |
Include 1-2 low-cost ETF tickers per row.

## Projected Portfolio Growth
Show a simple table: | Scenario | Annual Return | Value at End of Horizon | Total Gain |
Include Conservative, Base Case, and Optimistic rows. Use the actual initial amount and monthly contribution provided.

## Bull Market Scenario
Describe performance in sustained favorable conditions: expected annualized return, cumulative gain, peak portfolio value.

## Bear Market Stress Test
Describe worst-case drawdown: peak-to-trough decline (%), approximate recovery time, portfolio value at the trough, and long-term impact.

## Rebalancing Strategy
How often, which triggers (threshold-based vs calendar), and tax-efficient methods.

## Tax Optimization
Account-type-specific recommendations (asset location strategy).

## Key Risks & Mitigations
A table: | Risk | Severity | Mitigation Strategy |
List 4-5 specific risks relevant to this investor profile.

Be specific with numbers. Note this is educational analysis, not personalized financial advice."""


class FinancialPlanRequest(BaseModel):
    goal: str
    horizon_years: int
    initial_amount: float
    monthly_contribution: float
    risk_tolerance: str
    age: int
    tax_situation: str
    geography: str


@router.post("/api/financial-plan")
def financial_plan(req: FinancialPlanRequest):
    goal_labels = {
        "retirement": "Retirement",
        "house": "Home Purchase",
        "education": "Education / College Fund",
        "wealth": "Long-term Wealth Building",
        "income": "Income Generation / Dividends",
        "preservation": "Capital Preservation",
    }
    geo_labels = {
        "us_focused": "US-focused (minimal international exposure)",
        "global": "Globally diversified (US + international)",
        "em_tilt": "Global with emerging markets tilt",
    }
    tax_labels = {
        "taxable": "Taxable brokerage account",
        "roth_ira": "Roth IRA (tax-free growth)",
        "trad_ira": "Traditional IRA (tax-deferred)",
        "401k": "401(k) / 403(b) employer plan",
        "mix": "Mix of taxable and tax-advantaged accounts",
    }

    prompt = f"""Create a comprehensive investment strategy for the following investor profile:

**Goal:** {goal_labels.get(req.goal, req.goal)}
**Investment Horizon:** {req.horizon_years} years
**Starting Capital:** ${req.initial_amount:,.0f}
**Monthly Contribution:** ${req.monthly_contribution:,.0f}/month
**Risk Tolerance:** {req.risk_tolerance.capitalize()}
**Investor Age:** {req.age} years old
**Account Type:** {tax_labels.get(req.tax_situation, req.tax_situation)}
**Geographic Focus:** {geo_labels.get(req.geography, req.geography)}

Total capital deployed over horizon: ${req.initial_amount + req.monthly_contribution * req.horizon_years * 12:,.0f}

Please provide a full investment strategy following the required output format."""

    def generate():
        try:
            client = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))
            with client.messages.stream(
                model="claude-sonnet-4-6",
                max_tokens=3500,
                system=[{"type": "text", "text": _PLANNER_SYSTEM,
                          "cache_control": {"type": "ephemeral"}}],
                messages=[{"role": "user", "content": prompt}],
            ) as stream:
                for text in stream.text_stream:
                    yield f"data: {json.dumps({'text': text})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
        except Exception as exc:
            logger.error("Financial plan error: %s", exc)
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
