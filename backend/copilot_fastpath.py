"""Deterministic answers for common Ask AI questions — skips the multi-step
Nebius tool loop (often 2–4 sequential LLM round-trips). asyncio already
powers the streaming endpoint; the bottleneck is model latency, not missing
async. For FAQ-shaped questions we answer from SQLite in one shot."""

from __future__ import annotations

import re

from sqlmodel import Session, select

from backend.db import VendorCheck
from backend.serializers import check_to_summary

_CITATION_INTERNAL = {
    "claim": "Drawn from your saved invoice-check history",
    "source_type": "internal",
    "source_url": None,
    "source_title": "Invoice check history",
}


def _recent(session: Session, *, limit: int = 25) -> list[VendorCheck]:
    return list(
        session.exec(
            select(VendorCheck).order_by(VendorCheck.created_at.desc()).limit(limit)
        ).all()
    )


def _line(check: VendorCheck) -> str:
    amount = (
        f"${check.invoice_amount:,.2f}" if check.invoice_amount is not None else "amount n/a"
    )
    decision = check.decision_status or "pending"
    return (
        f"- **#{check.id} {check.vendor_name}** — recommendation `{check.risk_tier}`, "
        f"outcome `{decision}`, invoice {amount}"
    )


def try_fast_answer(session: Session, user_message: str) -> tuple[str, list[dict]] | None:
    """Return (markdown, citations) if this question can be answered without an LLM."""
    q = (user_message or "").strip().lower()
    if not q or len(q) > 220:
        return None

    # Avoid stealing live Tavily / named-vendor research questions.
    if re.search(r"look up .+|run a (live )?check|on the open web|\btavily\b", q):
        return None

    checks = _recent(session)

    if re.search(r"awaiting|still (need|waiting)|pending decision|not yet confirmed", q):
        rows = [c for c in checks if (c.decision_status or "pending") == "pending"]
        if not rows:
            text = (
                "No invoices are **awaiting a decision** right now — every recent check already "
                "has payment confirmed or held."
            )
        else:
            text = (
                f"**{len(rows)}** recent invoice(s) still awaiting a pay/hold decision:\n\n"
                + "\n".join(_line(c) for c in rows[:12])
                + "\n\nOpen a row on Home to confirm payment or confirm hold."
            )
        return text, [_CITATION_INTERNAL]

    if re.search(r"\b(held|confirm(?:ed)? as held|do not pay|on hold)\b", q) and not re.search(
        r"awaiting|pending", q
    ):
        rows = [c for c in checks if c.decision_status == "held"]
        if not rows:
            text = "No invoices are recorded as **held** in recent history yet."
        else:
            text = (
                f"**{len(rows)}** invoice(s) confirmed as held:\n\n"
                + "\n".join(_line(c) for c in rows[:12])
            )
        return text, [_CITATION_INTERNAL]

    if re.search(r"\b(paid|payment confirmed|confirmed for payment|confirmed as paid)\b", q):
        rows = [c for c in checks if c.decision_status == "paid_simulated"]
        if not rows:
            text = "No invoices have **payment confirmed** in recent history yet."
        else:
            text = (
                f"**{len(rows)}** invoice(s) with payment confirmed:\n\n"
                + "\n".join(_line(c) for c in rows[:12])
            )
        return text, [_CITATION_INTERNAL]

    if re.search(r"discrepanc|mismatch|details don.?t|impersonat", q):
        rows = [c for c in checks if c.internal_match_status == "approved_match_discrepancy"]
        if not rows:
            text = (
                "No recent checks show an **approved-vendor details mismatch**. "
                "When one appears, Home flags it as Hold."
            )
        else:
            text = (
                f"**{len(rows)}** check(s) with an approved-vendor details mismatch:\n\n"
                + "\n".join(_line(c) for c in rows[:12])
                + "\n\nVerify remittance details before paying."
            )
        return text, [_CITATION_INTERNAL]

    if re.search(r"riskiest|highest risk|high[- ]risk|summarize.*(risk|check)", q):
        ranked = sorted(
            checks,
            key=lambda c: (
                {"high": 0, "needs_manual_review": 1, "medium": 2, "low": 3, "clear": 4}.get(
                    c.risk_tier, 5
                ),
                -(c.invoice_amount or 0),
            ),
        )[:8]
        if not ranked:
            text = "No vendor checks in history yet — run **Check this invoice** on Home first."
        else:
            text = (
                "Most notable recent checks (highest risk first):\n\n"
                + "\n".join(_line(c) for c in ranked)
            )
        return text, [_CITATION_INTERNAL]

    return None
