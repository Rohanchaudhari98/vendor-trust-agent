"""The single funnel every entry point writes through: CLI, eval harness,
web dashboard ("Run New Check"), and copilot-triggered checks all call
`run_and_persist()` and land in the exact same `vendor_checks` table --
so the dashboard's history and the copilot's grounding data always
reflect every check ever run, regardless of where it came from.

Responsibilities beyond calling the pure pipeline:
1. Look up the internal vendor-master record first (backend/internal_records.py)
   and pass it into `run_pipeline()` so internal + external evidence are
   combined in one report.
2. Time the whole thing (`time.monotonic()`).
3. Best-effort capture the current Langfuse trace id, for a deep link
   into the Langfuse UI from the Observability dashboard.
4. Compute `cost_usd` from the same pricing constants eval.py uses
   (vendor_trust/pricing.py) -- one source of truth for cost math.
5. Persist one `VendorCheck` row and return it.
6. Best-effort embed and index this check's findings for semantic
   search (backend/embeddings.py) -- adds the real embedding cost onto
   `cost_usd` once indexing succeeds.
"""

from __future__ import annotations

import json
import logging
import time

from langfuse import get_client, observe
from sqlmodel import Session

from backend.db import VendorCheck
from backend.internal_records import lookup_vendor_master
from vendor_trust.agent import DEFAULT_MODEL, run_pipeline
from vendor_trust.pricing import compute_cost_usd, compute_embedding_cost_usd
from vendor_trust.schema import VendorRiskReport

logger = logging.getLogger(__name__)


def _signals_to_json(report: VendorRiskReport) -> str:
    return json.dumps([signal.model_dump(mode="json") for signal in report.signals])


def parse_signals(check: VendorCheck) -> list[dict]:
    """Deserializes `signals_json` back into plain dicts -- shared by the
    CLI's render step and every API response so there is exactly one
    place that knows how to read a persisted check's signals back out."""
    try:
        return json.loads(check.signals_json)
    except (json.JSONDecodeError, TypeError):
        return []


@observe(name="run_and_persist")
async def run_and_persist(
    session: Session,
    vendor_name: str,
    address: str | None = None,
    invoice_amount: float | None = None,
    source: str = "web",
    model: str = DEFAULT_MODEL,
) -> VendorCheck:
    """Runs one full vendor check (internal lookup + external pipeline)
    and persists the result. `source` records which entry point
    triggered it -- "cli" | "web" | "copilot" | "eval" | "seed".

    A DB write failure is intentionally NOT swallowed here -- callers
    that need best-effort behavior (the bare CLI, so a DB hiccup never
    breaks the interactive experience) wrap this call themselves.
    """
    internal_match = lookup_vendor_master(session, vendor_name, address)

    start = time.monotonic()
    report, usage = await run_pipeline(
        vendor_name=vendor_name,
        address=address,
        invoice_amount=invoice_amount,
        internal_match=internal_match,
        model=model,
    )
    latency_ms = int((time.monotonic() - start) * 1000)

    # Best-effort: tracing must never be able to break a vendor check.
    trace_id: str | None = None
    try:
        trace_id = get_client().get_current_trace_id()
    except Exception:  # noqa: BLE001 - tracing is observability, not a hard dependency
        trace_id = None

    cost_usd = compute_cost_usd(
        usage.get("search_credits", 0),
        usage.get("extract_credits", 0),
        usage.get("llm_input_tokens", 0),
        usage.get("llm_output_tokens", 0),
    )

    check = VendorCheck(
        vendor_name=report.vendor_name,
        address=address,
        invoice_amount=report.invoice_amount,
        risk_tier=report.risk_tier.value,
        evidence_count=report.evidence_count,
        recommendation=report.recommendation,
        signals_json=_signals_to_json(report),
        internal_match_status=report.internal_match_status,
        search_credits=usage.get("search_credits", 0),
        extract_credits=usage.get("extract_credits", 0),
        llm_input_tokens=usage.get("llm_input_tokens", 0),
        llm_output_tokens=usage.get("llm_output_tokens", 0),
        cost_usd=cost_usd,
        latency_ms=latency_ms,
        langfuse_trace_id=trace_id,
        source=source,
    )
    try:
        session.add(check)
        session.commit()
        session.refresh(check)
    except Exception:  # noqa: BLE001 - a DB write failure must never discard an
        # already-completed, already-paid-for analysis result. Roll back and
        # hand the caller the in-memory check (id=None -- not persisted) so
        # it can still be rendered/returned.
        logger.exception("Failed to persist VendorCheck for '%s' (source=%s)", vendor_name, source)
        session.rollback()
        return check

    # Best-effort: index this check's findings for semantic search (see
    # backend/embeddings.py). Deferred import to avoid a circular import
    # (backend.embeddings imports parse_signals from this module). Must
    # never be able to invalidate an already-persisted, already-paid-for
    # check -- a failure here is logged and swallowed, not raised.
    try:
        from backend.embeddings import index_check_findings

        _, embedding_tokens = await index_check_findings(session, check)
        if embedding_tokens:
            check.cost_usd += compute_embedding_cost_usd(embedding_tokens)
            session.add(check)
            session.commit()
            session.refresh(check)
    except Exception:  # noqa: BLE001 - semantic indexing is an enhancement, not a hard dependency
        logger.exception("Failed to index findings for semantic search (check_id=%s)", check.id)
        session.rollback()

    return check
