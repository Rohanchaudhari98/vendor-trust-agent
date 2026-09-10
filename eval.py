"""Runs the labeled fixture set through the pipeline and reports:

- per-fixture pass/fail on risk tier (the hard, gating check)
- an informational fraud-pattern signal check (soft — see note below)
- a Business Impact Summary in dollar terms, using real Tavily + Nebius
  pricing for the cost-per-check estimate

This is a small, hand-labeled fixture set (fixtures/vendors.jsonl) built
for this take-home — 8 cases, 2 of them real well-known companies and 6
constructed to exercise specific fraud-signal categories. It is an
illustrative proof-of-concept sanity check, NOT a statistically
significant benchmark. All dollar figures below are labeled as such.

Why fraud_pattern is a soft check, not a gate: for a fictitious/synthetic
vendor name, the honest outcome is usually "no findable registration" —
there is no real adverse-media trail online to confidently name a
specific fraud pattern from. Forcing a pattern match on absence-of-
evidence would reward the model for overclaiming. The tier check (did it
correctly decline to clear an unverifiable vendor?) is the check that
actually matters for the AP use case; the pattern field is reported for
visibility into what the model reasoned, not as a pass/fail gate.

Usage:
    uv run eval.py
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv
from rich.console import Console
from rich.table import Table

from vendor_trust.agent import run_pipeline

load_dotenv()
console = Console()

FIXTURES_PATH = Path(__file__).parent / "fixtures" / "vendors.jsonl"

# --- Pricing constants (sourced 2026-09-10 — verify against current pricing
# pages before relying on these for anything beyond illustrative POC math) ---
# Tavily pay-as-you-go tier: https://docs.tavily.com/documentation/api-credits
TAVILY_USD_PER_CREDIT = 0.008
# Nebius Token Factory catalog, moonshotai/Kimi-K2.6:
# https://tokenfactory.nebius.com/model-catalog.md
NEBIUS_USD_PER_M_INPUT = 0.95
NEBIUS_USD_PER_M_OUTPUT = 4.00

# Illustrative assumption for the "hours saved" business framing: a
# manual pre-payment vendor check (registry lookup, news search, address
# cross-check) by an AP clerk. This is a placeholder assumption for POC
# math, not a benchmarked time-and-motion study — see README.
MANUAL_CHECK_MINUTES = 10
AP_CLERK_FULLY_LOADED_HOURLY_RATE = 35.0


@dataclass
class FixtureResult:
    vendor_name: str
    invoice_amount: float | None
    expected_tier: str
    actual_tier: str
    tier_match: bool
    expected_pattern: str
    observed_patterns: set[str] = field(default_factory=set)
    pattern_signal_present: bool = False
    search_credits: int = 0
    extract_credits: int = 0
    llm_input_tokens: int = 0
    llm_output_tokens: int = 0
    error: str | None = None

    @property
    def cost_usd(self) -> float:
        tavily_cost = (self.search_credits + self.extract_credits) * TAVILY_USD_PER_CREDIT
        llm_cost = (self.llm_input_tokens / 1_000_000) * NEBIUS_USD_PER_M_INPUT + (
            self.llm_output_tokens / 1_000_000
        ) * NEBIUS_USD_PER_M_OUTPUT
        return tavily_cost + llm_cost


def load_fixtures() -> list[dict]:
    fixtures = []
    with FIXTURES_PATH.open() as f:
        for line in f:
            line = line.strip()
            if line:
                fixtures.append(json.loads(line))
    return fixtures


async def run_fixture(fixture: dict) -> FixtureResult:
    try:
        report, usage = await run_pipeline(
            vendor_name=fixture["vendor_name"],
            address=fixture.get("address"),
            invoice_amount=fixture.get("invoice_amount"),
        )
    except Exception as exc:  # noqa: BLE001 - eval harness must not crash on one bad case
        return FixtureResult(
            vendor_name=fixture["vendor_name"],
            invoice_amount=fixture.get("invoice_amount"),
            expected_tier=fixture["expected_tier"],
            actual_tier="ERROR",
            tier_match=False,
            expected_pattern=fixture.get("expected_pattern", "none"),
            error=str(exc),
        )

    observed_patterns = {s.fraud_pattern.value for s in report.signals}
    expected_pattern = fixture.get("expected_pattern", "none")
    pattern_signal_present = expected_pattern == "none" or expected_pattern in observed_patterns

    return FixtureResult(
        vendor_name=fixture["vendor_name"],
        invoice_amount=fixture.get("invoice_amount"),
        expected_tier=fixture["expected_tier"],
        actual_tier=report.risk_tier.value,
        tier_match=report.risk_tier.value == fixture["expected_tier"],
        expected_pattern=expected_pattern,
        observed_patterns=observed_patterns,
        pattern_signal_present=pattern_signal_present,
        search_credits=usage.get("search_credits", 0),
        extract_credits=usage.get("extract_credits", 0),
        llm_input_tokens=usage.get("llm_input_tokens", 0),
        llm_output_tokens=usage.get("llm_output_tokens", 0),
    )


def render_results_table(results: list[FixtureResult]) -> None:
    table = Table(title="Vendor Trust Agent — Fixture Eval Results")
    table.add_column("Vendor")
    table.add_column("Invoice $", justify="right")
    table.add_column("Expected Tier")
    table.add_column("Actual Tier")
    table.add_column("Tier")
    table.add_column("Pattern (expected / observed)")
    table.add_column("Cost ($)", justify="right")

    for r in results:
        tier_mark = "[bold green]PASS[/bold green]" if r.tier_match else "[bold red]FAIL[/bold red]"
        if r.error:
            tier_mark = "[bold red]ERROR[/bold red]"
        amount = f"{r.invoice_amount:,.0f}" if r.invoice_amount is not None else "-"
        observed = ", ".join(sorted(r.observed_patterns)) or "none"
        pattern_cell = f"{r.expected_pattern} / {observed}"
        if not r.pattern_signal_present:
            pattern_cell = f"[yellow]{pattern_cell} (soft-miss)[/yellow]"
        table.add_row(
            r.vendor_name,
            amount,
            r.expected_tier,
            r.actual_tier if not r.error else f"ERROR: {r.error[:40]}",
            tier_mark,
            pattern_cell,
            f"{r.cost_usd:.4f}",
        )

    console.print(table)


def render_business_impact_summary(results: list[FixtureResult]) -> None:
    valid = [r for r in results if not r.error]
    flagged_for_review = [
        r for r in valid if r.actual_tier in ("needs_manual_review", "medium", "high")
    ]
    cleared = [r for r in valid if r.actual_tier in ("clear", "low")]

    dollars_flagged = sum(r.invoice_amount or 0 for r in flagged_for_review)
    dollars_cleared = sum(r.invoice_amount or 0 for r in cleared)
    total_cost = sum(r.cost_usd for r in valid)
    avg_cost = total_cost / len(valid) if valid else 0.0

    hours_saved = len(cleared) * (MANUAL_CHECK_MINUTES / 60)
    labor_value_saved = hours_saved * AP_CLERK_FULLY_LOADED_HOURLY_RATE

    console.print("\n[bold]Business Impact Summary[/bold] [dim](illustrative POC sample, not statistically significant)[/dim]\n")
    console.print(f"  Invoice dollars held for manual verification pre-payment: [bold]${dollars_flagged:,.2f}[/bold] ({len(flagged_for_review)} of {len(valid)} vendors)")
    console.print(f"  Invoice dollars auto-cleared (legitimate spend not delayed): [bold]${dollars_cleared:,.2f}[/bold] ({len(cleared)} of {len(valid)} vendors)")
    console.print(f"  Illustrative labor value of automated checks vs. a ~{MANUAL_CHECK_MINUTES}-min manual lookup @ ${AP_CLERK_FULLY_LOADED_HOURLY_RATE:.0f}/hr: [bold]${labor_value_saved:,.2f}[/bold]")
    console.print(f"  Estimated cost per vendor check (Tavily + Nebius, current list pricing): [bold]${avg_cost:.4f}[/bold]")
    console.print(f"  Estimated cost across this {len(valid)}-vendor eval run: [bold]${total_cost:.4f}[/bold]")
    console.print(
        "\n[dim]Note: 'flagged for review' does not mean confirmed fraud — it means the check could not "
        "independently verify the vendor and a human should look before payment. Labor-value and manual-check-time "
        "figures are placeholder assumptions for illustrative math, not a benchmarked study. Pricing constants "
        "sourced from Tavily and Nebius public pricing pages as of this build; verify current rates before quoting.[/dim]"
    )


async def main() -> None:
    fixtures = load_fixtures()
    console.print(f"[bold]Running {len(fixtures)} fixtures through the Vendor Trust Agent pipeline...[/bold]\n")

    results = []
    for fixture in fixtures:
        console.print(f"  checking [cyan]{fixture['vendor_name']}[/cyan]...")
        results.append(await run_fixture(fixture))

    console.print()
    render_results_table(results)

    passed = sum(1 for r in results if r.tier_match)
    console.print(f"\n[bold]Tier accuracy: {passed}/{len(results)} ({passed / len(results):.0%})[/bold]")

    render_business_impact_summary(results)


if __name__ == "__main__":
    asyncio.run(main())
