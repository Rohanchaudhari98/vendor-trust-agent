"""Vendor Trust Agent — a pre-payment vendor risk check for AP invoice review.

Given a vendor name (and optionally an address and invoice amount), this
gathers targeted web evidence via Tavily, curates and extracts it, and
produces a structured, cited risk report — designed to plug into an AP
exception-review step as a guardrail before payment, not to replace it.

Setup:
  1. Create a Tavily API key: https://app.tavily.com
  2. Create a Nebius API key: https://tokenfactory.nebius.com
  3. Create a Langfuse project (free tier): https://cloud.langfuse.com
  4. Copy .env.example to .env and fill in all four keys
  5. Run:
       uv run vendor_trust_agent.py "Acme Textiles LLC" --address "Dallas, TX" --invoice-amount 45231.00

This is a proof-of-concept research signal, not a substitute for formal
vendor onboarding due diligence or OFAC/sanctions-list screening. See
README.md for limitations.
"""

from __future__ import annotations

import asyncio
import os
from typing import Annotated, Optional

import typer
from dotenv import load_dotenv
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

from vendor_trust.agent import DEFAULT_MODEL, run_pipeline
from vendor_trust.schema import RiskTier, VendorRiskReport

load_dotenv()

app = typer.Typer(add_completion=False)
console = Console()

TIER_STYLE = {
    RiskTier.CLEAR: "bold green",
    RiskTier.LOW: "green",
    RiskTier.MEDIUM: "yellow",
    RiskTier.HIGH: "bold red",
    RiskTier.NEEDS_MANUAL_REVIEW: "bold magenta",
}


def check_required_api_keys() -> None:
    """Fail fast with a clear, actionable message if a required key is
    missing, rather than letting an SDK deep in the pipeline raise an
    opaque auth error partway through a vendor check."""
    required = {
        "TAVILY_API_KEY": "https://app.tavily.com",
        "NEBIUS_API_KEY": "https://tokenfactory.nebius.com",
    }
    missing = {name: url for name, url in required.items() if not os.getenv(name)}
    if not missing:
        return
    console.print("[bold red]Missing required API key(s):[/bold red]")
    for name, url in missing.items():
        console.print(f"  - {name} — create one at {url}, then add it to your .env file.")
    raise typer.Exit(code=1)


def render_report(report: VendorRiskReport, usage: dict) -> None:
    style = TIER_STYLE.get(report.risk_tier, "white")

    header = Text()
    header.append(f"{report.vendor_name}\n", style="bold")
    if report.invoice_amount is not None:
        header.append(f"Invoice amount: ${report.invoice_amount:,.2f}\n")
    header.append(f"Sources consulted: {report.evidence_count}")
    console.print(Panel(header, title="Vendor Trust Report", border_style="cyan"))

    console.print(f"\n[{style}]Risk tier: {report.risk_tier.value.upper()}[/{style}]\n")

    if not report.signals:
        console.print("[dim]No specific signals were raised.[/dim]\n")

    for signal in report.signals:
        table = Table(show_header=False, box=None, padding=(0, 1))
        table.add_row("[bold]Category[/bold]", signal.category)
        if signal.fraud_pattern.value != "none":
            table.add_row("[bold]Pattern[/bold]", signal.fraud_pattern.value)
        table.add_row("[bold]Finding[/bold]", signal.finding)
        if signal.citations:
            cites = "\n".join(f"- {c.claim}\n  {c.source_url}" for c in signal.citations)
            table.add_row("[bold]Citations[/bold]", cites)
        console.print(Panel(table, border_style="dim"))

    console.print(Panel(Text(report.recommendation, style="bold"), title="Recommendation", border_style=style))

    # The one line a business/finance stakeholder would actually read.
    amount_str = f"${report.invoice_amount:,.2f}" if report.invoice_amount is not None else "N/A"
    console.print(
        f"\n[bold]Invoice {amount_str} | Risk: {report.risk_tier.value.upper()} | {report.recommendation}[/bold]"
    )
    console.print(
        f"[dim]Tavily usage: {usage.get('search_credits', 0)} search credit(s), "
        f"{usage.get('extract_credits', 0)} extract credit(s)[/dim]"
    )


@app.command()
def main(
    vendor_name: Annotated[list[str], typer.Argument(help="Vendor name to check")],
    address: Annotated[Optional[str], typer.Option(help="Vendor address or location, if known")] = None,
    invoice_amount: Annotated[Optional[float], typer.Option(help="Invoice amount pending payment")] = None,
    model: Annotated[str, typer.Option(help="Nebius model name")] = DEFAULT_MODEL,
) -> None:
    """Run a pre-payment vendor risk check."""
    check_required_api_keys()
    if not os.getenv("LANGFUSE_PUBLIC_KEY"):
        console.print(
            "[dim]Note: LANGFUSE_PUBLIC_KEY not set — running without tracing. "
            "See .env.example to enable it.[/dim]\n"
        )

    vendor = " ".join(vendor_name)
    console.print(Panel.fit(vendor, title="Checking vendor", border_style="cyan"))

    try:
        report, usage = asyncio.run(
            run_pipeline(vendor_name=vendor, address=address, invoice_amount=invoice_amount, model=model)
        )
    except Exception as exc:  # pragma: no cover - top-level CLI error boundary
        console.print(f"\n[bold red]Vendor check failed:[/bold red] {exc}")
        raise typer.Exit(code=1) from None

    render_report(report, usage)


if __name__ == "__main__":
    app()
