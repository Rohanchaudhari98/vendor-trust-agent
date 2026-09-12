"""Pydantic response/request models for the REST API -- kept separate
from backend/db.py's table models so the wire format (what the frontend
actually consumes -- parsed signals, constructed trace URLs, aggregates)
can evolve independently of the storage schema."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class CheckCreateRequest(BaseModel):
    vendor_name: str = Field(min_length=1)
    address: str | None = None
    invoice_amount: float | None = None


class InvoiceExtractResponse(BaseModel):
    """Fields pulled from an uploaded invoice PDF — same shape the check form uses."""

    vendor_name: str | None = None
    address: str | None = None
    invoice_amount: float | None = None
    filename: str | None = None
    warnings: list[str] = Field(default_factory=list)


class CitationOut(BaseModel):
    claim: str
    source_type: str = "web"
    source_url: str | None = None
    source_title: str = ""


class SignalOut(BaseModel):
    category: str
    finding: str
    fraud_pattern: str = "none"
    citations: list[CitationOut] = Field(default_factory=list)


class CheckSummary(BaseModel):
    """Lightweight shape for list views (History table, copilot search
    results, Recent Checks on Overview) -- no signals payload."""

    id: int | None
    vendor_name: str
    address: str | None
    invoice_amount: float | None
    risk_tier: str
    evidence_count: int
    internal_match_status: str | None
    recommendation: str
    cost_usd: float
    latency_ms: int
    source: str
    created_at: datetime
    # Closed-loop outcome: pending | paid_simulated | held
    decision_status: str = "pending"
    decision_note: str | None = None
    decided_at: datetime | None = None


class CheckDetail(CheckSummary):
    """Full shape for a single check -- report detail view, copilot
    get_check_detail tool, and the payload returned by POST /api/checks
    right after a new check runs."""

    signals: list[SignalOut] = Field(default_factory=list)
    search_credits: int
    extract_credits: int
    llm_input_tokens: int
    llm_output_tokens: int
    langfuse_trace_id: str | None
    langfuse_trace_url: str | None = None


class CheckDecisionRequest(BaseModel):
    """Record the clerk's action that closes the AP loop."""

    decision: str = Field(description="paid_simulated | held")
    note: str | None = None


class TierBreakdown(BaseModel):
    clear: int = 0
    low: int = 0
    medium: int = 0
    high: int = 0
    needs_manual_review: int = 0


class KPIResponse(BaseModel):
    total_checks: int
    dollars_flagged: float
    dollars_cleared: float
    avg_cost_per_check: float
    total_cost_usd: float
    tier_breakdown: TierBreakdown
    internal_discrepancy_count: int
    # Closed-loop outcome counts (human decisions, not risk tiers)
    awaiting_decision: int = 0
    paid_simulated: int = 0
    held: int = 0


class ObservabilityRow(BaseModel):
    id: int | None
    vendor_name: str
    source: str
    cost_usd: float
    search_credits: int
    extract_credits: int
    llm_input_tokens: int
    llm_output_tokens: int
    latency_ms: int
    langfuse_trace_id: str | None
    langfuse_trace_url: str | None = None
    created_at: datetime


class ObservabilityAggregate(BaseModel):
    total_checks: int
    total_cost_usd: float
    avg_latency_ms: float
    avg_cost_usd: float


class ObservabilityResponse(BaseModel):
    rows: list[ObservabilityRow]
    aggregate: ObservabilityAggregate
    langfuse_url: str | None = None


class VendorMasterOut(BaseModel):
    id: int | None
    vendor_name: str
    known_address: str | None
    status: str
    notes: str | None
    aliases: list[str] = Field(default_factory=list)
    created_at: datetime


class VendorMasterCreate(BaseModel):
    vendor_name: str = Field(min_length=1)
    known_address: str | None = None
    status: str = "approved"  # approved | watchlist | blocked
    notes: str | None = None
    aliases: list[str] = Field(default_factory=list)


class VendorMasterUpdate(BaseModel):
    """Partial update. Omitted fields are left unchanged; send an empty
    string for known_address / notes to clear them."""

    vendor_name: str | None = Field(default=None, min_length=1)
    known_address: str | None = None
    status: str | None = None
    notes: str | None = None
    aliases: list[str] | None = None


class ChatMessageOut(BaseModel):
    role: str
    content: str
    citations: list[CitationOut] = Field(default_factory=list)
    created_at: datetime


class ChatRequest(BaseModel):
    session_id: str
    message: str = Field(min_length=1)
    # Optional: when the user opens Ask AI from a report page, the UI
    # passes that check id so "why was this held?" resolves without
    # re-naming the vendor. Not persisted — only seeds this turn.
    context_check_id: int | None = None
