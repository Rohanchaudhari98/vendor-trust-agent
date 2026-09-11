"""Closed-loop decision endpoint: confirm pay (simulated) or hold."""

from backend.db import VendorCheck


def _seed_check(session, **overrides) -> VendorCheck:
    defaults = dict(
        vendor_name="Decision Vendor",
        risk_tier="clear",
        evidence_count=2,
        recommendation="Looks fine.",
        decision_status="pending",
    )
    defaults.update(overrides)
    check = VendorCheck(**defaults)
    session.add(check)
    session.commit()
    session.refresh(check)
    return check


def test_record_paid_simulated(client, session):
    check = _seed_check(session)
    response = client.post(
        f"/api/checks/{check.id}/decision",
        json={"decision": "paid_simulated", "note": "Verified by phone"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["decision_status"] == "paid_simulated"
    assert body["decision_note"] == "Verified by phone"
    assert body["decided_at"] is not None

    kpis = client.get("/api/kpis").json()
    assert kpis["paid_simulated"] >= 1
    assert kpis["awaiting_decision"] >= 0


def test_record_held(client, session):
    check = _seed_check(session, vendor_name="Hold Me Co", risk_tier="high")
    response = client.post(f"/api/checks/{check.id}/decision", json={"decision": "held"})
    assert response.status_code == 200
    assert response.json()["decision_status"] == "held"

    kpis = client.get("/api/kpis").json()
    assert kpis["held"] >= 1


def test_invalid_decision_rejected(client, session):
    check = _seed_check(session)
    response = client.post(
        f"/api/checks/{check.id}/decision",
        json={"decision": "wire_transfer"},
    )
    assert response.status_code == 400


def test_decision_on_missing_check(client):
    response = client.post("/api/checks/999999/decision", json={"decision": "held"})
    assert response.status_code == 404
