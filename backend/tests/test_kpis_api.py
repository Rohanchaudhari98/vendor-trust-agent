"""GET /api/kpis -- aggregation correctness against known seeded rows."""

from __future__ import annotations

from backend.db import VendorCheck


def _seed(session, **overrides) -> VendorCheck:
    defaults = dict(
        vendor_name="KPI Vendor",
        risk_tier="clear",
        source="web",
        invoice_amount=0.0,
        cost_usd=0.0,
        internal_match_status=None,
    )
    defaults.update(overrides)
    check = VendorCheck(**defaults)
    session.add(check)
    session.commit()
    return check


def test_kpis_aggregate_known_rows(client, session):
    # Cleared: clear + low tiers.
    _seed(session, vendor_name="Cleared A", risk_tier="clear", invoice_amount=1000.0, cost_usd=0.01)
    _seed(session, vendor_name="Cleared B", risk_tier="low", invoice_amount=1000.0, cost_usd=0.02)
    # Flagged: medium/high/needs_manual_review tiers.
    _seed(session, vendor_name="Flagged A", risk_tier="high", invoice_amount=5000.0, cost_usd=0.03)
    _seed(
        session,
        vendor_name="Flagged B",
        risk_tier="needs_manual_review",
        invoice_amount=2000.0,
        cost_usd=0.04,
        internal_match_status="approved_match_discrepancy",
    )

    response = client.get("/api/kpis")
    assert response.status_code == 200
    body = response.json()

    assert body["total_checks"] == 4
    assert body["dollars_cleared"] == 2000.0
    assert body["dollars_flagged"] == 7000.0
    assert body["total_cost_usd"] == 0.10
    assert round(body["avg_cost_per_check"], 4) == round(0.10 / 4, 4)
    assert body["internal_discrepancy_count"] == 1
    assert body["tier_breakdown"] == {
        "clear": 1,
        "low": 1,
        "medium": 0,
        "high": 1,
        "needs_manual_review": 1,
    }


def test_kpis_empty_db_returns_zeros(client):
    response = client.get("/api/kpis")
    assert response.status_code == 200
    body = response.json()
    assert body["total_checks"] == 0
    assert body["dollars_flagged"] == 0
    assert body["dollars_cleared"] == 0
    assert body["avg_cost_per_check"] == 0
    assert body["internal_discrepancy_count"] == 0


def test_kpis_filters_by_source(client, session):
    _seed(session, vendor_name="Web Check", risk_tier="clear", source="web", invoice_amount=100.0)
    _seed(session, vendor_name="Eval Check", risk_tier="clear", source="eval", invoice_amount=999.0)

    response = client.get("/api/kpis", params={"source": "web"})
    body = response.json()

    assert body["total_checks"] == 1
    assert body["dollars_cleared"] == 100.0


def test_kpis_counts_all_three_internal_flag_statuses(client, session):
    _seed(session, vendor_name="Discrepancy", internal_match_status="approved_match_discrepancy")
    _seed(session, vendor_name="Blocked", internal_match_status="blocked_match")
    _seed(session, vendor_name="Watchlist", internal_match_status="watchlist_match")
    _seed(session, vendor_name="Clean Match", internal_match_status="approved_match")
    _seed(session, vendor_name="No Match", internal_match_status="no_match")

    response = client.get("/api/kpis")
    assert response.json()["internal_discrepancy_count"] == 3
