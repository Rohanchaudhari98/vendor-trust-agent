"""Converts backend/db.py table rows into backend/schemas.py wire
models. One place that knows how to turn a persisted VendorCheck /
VendorMaster / ChatMessage row into API/copilot-facing JSON, so
backend/api.py and backend/copilot.py never duplicate this logic."""

from __future__ import annotations

import os

from backend.db import ChatMessage, VendorCheck, VendorMaster
from backend.internal_records import parse_aliases
from backend.pipeline_service import parse_signals
from backend.schemas import (
    CheckDetail,
    CheckSummary,
    ChatMessageOut,
    CitationOut,
    ObservabilityRow,
    SignalOut,
    VendorMasterOut,
)


def build_trace_url(trace_id: str | None) -> str | None:
    if not trace_id:
        return None
    base_url = os.environ.get("LANGFUSE_BASE_URL", "https://cloud.langfuse.com").rstrip("/")
    return f"{base_url}/trace/{trace_id}"


def check_to_summary(check: VendorCheck) -> CheckSummary:
    return CheckSummary(
        id=check.id,
        vendor_name=check.vendor_name,
        address=check.address,
        invoice_amount=check.invoice_amount,
        risk_tier=check.risk_tier,
        evidence_count=check.evidence_count,
        internal_match_status=check.internal_match_status,
        recommendation=check.recommendation,
        cost_usd=check.cost_usd,
        latency_ms=check.latency_ms,
        source=check.source,
        created_at=check.created_at,
        decision_status=getattr(check, "decision_status", None) or "pending",
        decision_note=getattr(check, "decision_note", None),
        decided_at=getattr(check, "decided_at", None),
    )


def check_to_detail(check: VendorCheck) -> CheckDetail:
    signals = [
        SignalOut(
            category=s.get("category", ""),
            finding=s.get("finding", ""),
            fraud_pattern=s.get("fraud_pattern", "none"),
            citations=[
                CitationOut(
                    claim=c.get("claim", ""),
                    source_type=c.get("source_type", "web"),
                    source_url=c.get("source_url"),
                    source_title=c.get("source_title", ""),
                )
                for c in (s.get("citations") or [])
            ],
        )
        for s in parse_signals(check)
    ]
    return CheckDetail(
        **check_to_summary(check).model_dump(),
        signals=signals,
        search_credits=check.search_credits,
        extract_credits=check.extract_credits,
        llm_input_tokens=check.llm_input_tokens,
        llm_output_tokens=check.llm_output_tokens,
        langfuse_trace_id=check.langfuse_trace_id,
        langfuse_trace_url=build_trace_url(check.langfuse_trace_id),
    )


def check_to_observability_row(check: VendorCheck) -> ObservabilityRow:
    return ObservabilityRow(
        id=check.id,
        vendor_name=check.vendor_name,
        source=check.source,
        cost_usd=check.cost_usd,
        search_credits=check.search_credits,
        extract_credits=check.extract_credits,
        llm_input_tokens=check.llm_input_tokens,
        llm_output_tokens=check.llm_output_tokens,
        latency_ms=check.latency_ms,
        langfuse_trace_id=check.langfuse_trace_id,
        langfuse_trace_url=build_trace_url(check.langfuse_trace_id),
        created_at=check.created_at,
    )


def vendor_master_to_out(record: VendorMaster) -> VendorMasterOut:
    return VendorMasterOut(
        id=record.id,
        vendor_name=record.vendor_name,
        known_address=record.known_address,
        status=record.status,
        notes=record.notes,
        aliases=parse_aliases(record),
        created_at=record.created_at,
    )


def chat_message_to_out(message: ChatMessage) -> ChatMessageOut:
    import json

    citations_raw = json.loads(message.citations_json) if message.citations_json else []
    return ChatMessageOut(
        role=message.role,
        content=message.content,
        citations=[CitationOut(**c) for c in citations_raw],
        created_at=message.created_at,
    )
