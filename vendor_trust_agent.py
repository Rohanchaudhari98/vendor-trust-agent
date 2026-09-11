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
from sqlmodel import Session

from backend.db import VendorCheck, engine, init_db
from backend.pipeline_service import parse_signals, run_and_persist
from vendor_trust.agent import DEFAULT_MODEL
from vendor_trust.schema import RiskTier

load_dotenv()

app = typer.Typer(add_completion=False)
console = Console()

TIER_STYLE = {
    RiskTier.CLEAR.value: "bold green",
    RiskTier.LOW.value: "green",
    RiskTier.MEDIUM.value: "yellow",
    RiskTier.HIGH.value: "bold red",
    RiskTier.NEEDS_MANUAL_REVIEW.value: "bold magenta",
}

INTERNAL_MATCH_LABEL = {
    "approved_match": "Approved vendor — on file, details consistent",
    "approved_match_discrepancy": "Approved vendor — DETAILS DO NOT MATCH what's on file",
    "watchlist_match": "WATCHLIST — internally flagged",
    "blocked_match": "BLOCKED — internally blocked from payment",
    "no_match": "No internal record found (new or unrecognized vendor)",
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


def render_check(check: VendorCheck) -> None:
    """Renders a persisted VendorCheck row -- the same row backend/api.py
    returns to the dashboard -- so what the CLI prints and what the web
    UI shows are always built from identical data."""
    style = TIER_STYLE.get(check.risk_tier, "white")
    signals = parse_signals(check)

    header = Text()
    header.append(f"{check.vendor_name}\n", style="bold")
    if check.invoice_amount is not None:
        header.append(f"Invoice amount: ${check.invoice_amount:,.2f}\n")
    header.append(f"Sources consulted: {check.evidence_count}")
    console.print(Panel(header, title="Vendor Trust Report", border_style="cyan"))

    console.print(f"\n[{style}]Risk tier: {check.risk_tier.upper()}[/{style}]\n")

    if check.internal_match_status:
        internal_label = INTERNAL_MATCH_LABEL.get(check.internal_match_status, check.internal_match_status)
        internal_style = "bold red" if check.internal_match_status in ("approved_match_discrepancy", "blocked_match") else "cyan"
        console.print(f"[{internal_style}]Internal vendor master: {internal_label}[/{internal_style}]\n")

    if not signals:
        console.print("[dim]No specific signals were raised.[/dim]\n")

    for signal in signals:
        table = Table(show_header=False, box=None, padding=(0, 1))
        table.add_row("[bold]Category[/bold]", signal.get("category", ""))
        if signal.get("fraud_pattern", "none") != "none":
            table.add_row("[bold]Pattern[/bold]", signal["fraud_pattern"])
        table.add_row("[bold]Finding[/bold]", signal.get("finding", ""))
        citations = signal.get("citations") or []
        if citations:
            cite_lines = []
            for c in citations:
                if c.get("source_type") == "internal":
                    cite_lines.append(f"- {c.get('claim', '')}\n  [Internal Vendor Master]")
                else:
                    cite_lines.append(f"- {c.get('claim', '')}\n  {c.get('source_url', '')}")
            table.add_row("[bold]Citations[/bold]", "\n".join(cite_lines))
        console.print(Panel(table, border_style="dim"))

    console.print(Panel(Text(check.recommendation, style="bold"), title="Recommendation", border_style=style))

    # The one line a business/finance stakeholder would actually read.
    amount_str = f"${check.invoice_amount:,.2f}" if check.invoice_amount is not None else "N/A"
    console.print(
        f"\n[bold]Invoice {amount_str} | Risk: {check.risk_tier.upper()} | {check.recommendation}[/bold]"
    )
    console.print(
        f"[dim]Tavily usage: {check.search_credits} search credit(s), "
        f"{check.extract_credits} extract credit(s) | Cost: ${check.cost_usd:.4f} | "
        f"Latency: {check.latency_ms}ms[/dim]"
    )
    if check.id is not None:
        console.print(f"[dim]Saved to dashboard as check #{check.id} (source=cli).[/dim]")
    else:
        console.print("[dim]Note: result could not be saved to the local dashboard DB this run.[/dim]")


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

    init_db()
    try:
        with Session(engine) as session:
            check = asyncio.run(
                run_and_persist(
                    session,
                    vendor_name=vendor,
                    address=address,
                    invoice_amount=invoice_amount,
                    source="cli",
                    model=model,
                )
            )
    except Exception as exc:  # pragma: no cover - top-level CLI error boundary
        console.print(f"\n[bold red]Vendor check failed:[/bold red] {exc}")
        raise typer.Exit(code=1) from None

    render_check(check)


if __name__ == "__main__":
    app()
