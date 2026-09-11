"""Unit tests for Ask AI fast-path (no Nebius)."""

from __future__ import annotations

from backend.copilot_fastpath import try_fast_answer
from backend.db import VendorCheck, utcnow


def _seed(session, **overrides) -> VendorCheck:
    defaults = dict(
        vendor_name="Acme",
        risk_tier="clear",
        decision_status="pending",
        recommendation="OK",
        signals_json="[]",
        created_at=utcnow(),
    )
    defaults.update(overrides)
    row = VendorCheck(**defaults)
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def test_fast_path_awaiting_decision(session):
    _seed(session, vendor_name="Waiting Co", decision_status="pending")
    _seed(session, vendor_name="Paid Co", decision_status="paid_simulated")

    result = try_fast_answer(session, "Which checks are still awaiting a pay or hold decision?")
    assert result is not None
    text, citations = result
    assert "Waiting Co" in text
    assert "Paid Co" not in text
    assert citations


def test_fast_path_skips_live_tavily_phrasing(session):
    _seed(session, vendor_name="Anything")
    assert (
        try_fast_answer(
            session, "Look up Duluth Trading Company on the open web and tell me if it’s safe to pay"
        )
        is None
    )


def test_fast_path_held(session):
    _seed(session, vendor_name="Held Co", decision_status="held", risk_tier="high")
    result = try_fast_answer(session, "Which invoices did we confirm as held?")
    assert result is not None
    assert "Held Co" in result[0]
