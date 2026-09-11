"""Populates the dashboard with real starter data -- run once before the
first demo:

    uv run python backend/seed.py

Two things get seeded, both using real, verified vendor identities (no
invented company names anywhere in this project -- see
fixtures/vendors.jsonl and TECHNICAL_STATEMENT.md):

1. VendorMaster -- the client's own internal "approved vendor" system of
   record. Four large, unambiguous public companies (Procter & Gamble,
   FedEx Corporation, Target Corporation, Microsoft Corporation) are
   seeded as approved, with their real public HQ addresses. This is what
   makes the internal-knowledge layer (backend/internal_records.py)
   demonstrable out of the box -- e.g. asking the copilot "is Procter &
   Gamble an approved vendor?" or running a new check against a
   mismatched P&G address immediately has something real to match
   against.

2. VendorCheck history -- every fixture in fixtures/vendors.jsonl (the
   same 8 real-vendor cases eval.py scores) is run through
   `run_and_persist(..., source="seed")` -- the same funnel the CLI, web
   dashboard, and copilot all use -- so the Overview/History/
   Observability pages have real historical data (real cost, real
   latency, a real Langfuse trace per check) the first time the
   dashboard is opened, instead of an empty state.

This makes REAL Tavily + Nebius API calls (one per fixture, ~15-60s
each, real API cost -- the same cost eval.py reports). It is idempotent
by default: if any `source="seed"` rows already exist, it skips the
check-seeding step (VendorMaster seeding always runs, and is itself
idempotent by normalized name) rather than silently re-spending API
credits. Pass `--force` to re-seed checks anyway.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Annotated

import typer
from dotenv import load_dotenv
from rich.console import Console
from sqlmodel import Session, select

from backend.db import VendorCheck, VendorMaster, engine, init_db
from backend.internal_records import normalize_name
from backend.pipeline_service import run_and_persist

load_dotenv()
console = Console()
app = typer.Typer(add_completion=False)

FIXTURES_PATH = Path(__file__).parent.parent / "fixtures" / "vendors.jsonl"

# The internal vendor-master seed -- real companies, real public HQ
# addresses, matching the addresses used in fixtures/vendors.jsonl so the
# "control case" (consistent match) and the deliberately-constructed
# P&G-with-a-mismatched-address demo case both resolve against a real
# record instead of "no_match".
VENDOR_MASTER_SEED: list[dict] = [
    {
        "vendor_name": "Procter & Gamble",
        "known_address": "One Procter & Gamble Plaza, Cincinnati, OH 45202",
        "status": "approved",
        "notes": "NYSE: PG. Long-standing approved vendor.",
        # Real ticker/initialism aliases -- little character overlap with
        # the canonical name, so they wouldn't be caught by fuzzy-matching
        # the canonical name alone (see backend/internal_records.py).
        "aliases": ["P&G", "PG"],
    },
    {
        "vendor_name": "FedEx Corporation",
        "known_address": "942 South Shady Grove Road, Memphis, TN 38120",
        "status": "approved",
        "notes": "NYSE: FDX. Long-standing approved vendor.",
        "aliases": ["FDX"],
    },
    {
        "vendor_name": "Target Corporation",
        "known_address": "1000 Nicollet Mall, Minneapolis, MN 55403",
        "status": "approved",
        "notes": "NYSE: TGT. Long-standing approved vendor.",
        "aliases": ["TGT"],
    },
    {
        "vendor_name": "Microsoft Corporation",
        "known_address": "One Microsoft Way, Redmond, WA 98052",
        "status": "approved",
        "notes": "NASDAQ: MSFT. Long-standing approved vendor.",
        "aliases": ["MSFT"],
    },
]


def load_fixtures() -> list[dict]:
    fixtures = []
    with FIXTURES_PATH.open() as f:
        for line in f:
            line = line.strip()
            if line:
                fixtures.append(json.loads(line))
    return fixtures


def seed_vendor_master(session: Session) -> int:
    """Idempotent by normalized_name -- safe to run every time."""
    inserted = 0
    for entry in VENDOR_MASTER_SEED:
        normalized = normalize_name(entry["vendor_name"])
        existing = session.exec(
            select(VendorMaster).where(VendorMaster.normalized_name == normalized)
        ).first()
        if existing is not None:
            continue
        session.add(
            VendorMaster(
                vendor_name=entry["vendor_name"],
                normalized_name=normalized,
                known_address=entry.get("known_address"),
                status=entry.get("status", "approved"),
                notes=entry.get("notes"),
                aliases_json=json.dumps(entry.get("aliases", [])),
            )
        )
        inserted += 1
    session.commit()
    return inserted


async def seed_checks(session: Session, force: bool) -> int:
    already_seeded = session.exec(select(VendorCheck).where(VendorCheck.source == "seed")).first()
    if already_seeded is not None and not force:
        console.print(
            "[yellow]Skipping check history seed -- rows with source='seed' already exist. "
            "Pass --force to re-run (this makes real, paid API calls again).[/yellow]"
        )
        return 0

    fixtures = load_fixtures()
    seeded = 0
    for fixture in fixtures:
        console.print(f"  checking [cyan]{fixture['vendor_name']}[/cyan]...")
        try:
            check = await run_and_persist(
                session,
                vendor_name=fixture["vendor_name"],
                address=fixture.get("address"),
                invoice_amount=fixture.get("invoice_amount"),
                source="seed",
            )
        except Exception as exc:  # noqa: BLE001 - one bad fixture shouldn't abort the whole seed
            console.print(f"    [red]failed: {exc}[/red]")
            continue
        console.print(f"    -> [bold]{check.risk_tier}[/bold] (${check.cost_usd:.4f}, {check.latency_ms}ms)")
        seeded += 1
    return seeded


@app.command()
def main(
    force: Annotated[
        bool, typer.Option(help="Re-seed check history even if source='seed' rows already exist")
    ] = False,
) -> None:
    init_db()
    with Session(engine) as session:
        master_count = seed_vendor_master(session)
        console.print(f"[bold]Vendor master:[/bold] {master_count} new record(s) inserted.\n")

        console.print(f"[bold]Seeding {len(load_fixtures())} real historical checks...[/bold]")
        check_count = asyncio.run(seed_checks(session, force))
        console.print(f"\n[bold]Done.[/bold] {check_count} check(s) seeded.")


if __name__ == "__main__":
    app()
