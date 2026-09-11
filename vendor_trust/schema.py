"""Structured output schema for the Vendor Trust Agent.

The risk taxonomy (FraudPattern) is deliberately named after documented AP
fraud categories from ACFE's Report to the Nations (billing schemes,
shell-company/fictitious-vendor schemes) and AFP's Payments Fraud and
Control Survey (vendor imposter fraud, invoice fraud) — not a generic
"risk score" label. This keeps the agent's own internal design traceable
to real, named fraud patterns rather than an invented taxonomy.

NEEDS_MANUAL_REVIEW exists as a first-class tier, separate from LOW, so a
vendor with a thin/near-zero web footprint (common for small or brand-new
legitimate vendors too) does not get force-fit into a false-confidence
risk score. Insufficient evidence is itself a distinct, honest outcome.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class FraudPattern(str, Enum):
    """Named after real AP fraud categories (ACFE 2024 / AFP 2025), not
    generic labels — see module docstring."""

    VENDOR_IMPERSONATION = "vendor_impersonation"
    INVOICE_FRAUD = "invoice_fraud"
    SHELL_COMPANY = "shell_company"
    NONE = "none"


class RiskTier(str, Enum):
    CLEAR = "clear"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    NEEDS_MANUAL_REVIEW = "needs_manual_review"


SignalCategory = Literal["legitimacy", "adverse_media", "entity_consistency", "internal_records"]

# Mirrors the "internal knowledge vs. external knowledge" split the whole
# report is built around: the first three categories are always sourced
# from Tavily web evidence; "internal_records" is sourced from the
# client's own approved-vendor system of record (see InternalMatchResult
# below) — a real AP fraud check needs both, not external search alone.


class InternalMatchResult(BaseModel):
    """Result of cross-referencing a vendor against the client's internal
    approved-vendor master (backend/internal_records.py does the actual
    DB lookup; this is the plain, DB-free result type the pure pipeline
    receives). `status` is one of the VendorRiskReport.internal_match_status
    values below — computed deterministically in Python, not by the LLM."""

    found: bool
    status: Literal["approved_match", "approved_match_discrepancy", "watchlist_match", "blocked_match", "no_match"]
    matched_vendor_name: str | None = None
    name_similarity: float | None = None
    address_consistent: bool | None = None
    notes: str | None = None


class Citation(BaseModel):
    """Every claim in a RiskSignal must trace back to one of these. No
    citation, no claim — this is what makes the report audit-usable
    rather than a black-box LLM opinion."""

    claim: str = Field(description="The specific factual claim this citation supports")
    source_type: Literal["web", "internal"] = "web"
    source_url: str | None = Field(
        default=None,
        description="Required when source_type is 'web'. Omitted for 'internal' citations, which reference the internal vendor master instead of a URL.",
    )
    source_title: str = ""


class RiskSignal(BaseModel):
    category: SignalCategory
    finding: str = Field(
        description=(
            "Hedged, evidentiary language only — e.g. 'no independent "
            "business registration record found as of the search date', "
            "never an unqualified accusation like 'this vendor is "
            "fraudulent'."
        )
    )
    fraud_pattern: FraudPattern = FraudPattern.NONE
    citations: list[Citation] = Field(default_factory=list)


class VendorRiskReport(BaseModel):
    """Final structured output of the pipeline. This is what gets
    rendered to the CLI, scored against fixtures in eval.py, and would be
    the payload attached to an AP exception-queue record in production."""

    vendor_name: str
    invoice_amount: float | None = None
    risk_tier: RiskTier
    evidence_count: int = Field(description="Total number of distinct sources consulted")
    internal_match_status: str | None = Field(
        default=None,
        description=(
            "Set deterministically from the internal vendor-master lookup, not by the LLM: "
            "'approved_match' | 'approved_match_discrepancy' | 'watchlist_match' | 'blocked_match' | 'no_match' | None (no internal lookup performed)."
        ),
    )
    signals: list[RiskSignal] = Field(default_factory=list)
    recommendation: str = Field(
        description=(
            "One business-legible sentence, e.g. 'Hold for manual "
            "verification before payment — remittance details could not "
            "be independently confirmed.'"
        )
    )
