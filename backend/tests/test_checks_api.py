"""POST /api/checks (mocked pipeline, validates persisted row),
GET /api/checks (list/filter/pagination), GET /api/checks/{id} (found + 404)."""

from __future__ import annotations

from datetime import timedelta

from backend.db import VendorCheck, VendorMaster, utcnow


def test_create_check_persists_row(client, mock_run_pipeline):
    mock_run_pipeline(
        risk_tier="low",
        evidence_count=4,
        recommendation="Clean web presence, proceed with standard review.",
    )

    response = client.post(
        "/api/checks",
        json={"vendor_name": "Acme Test Co", "address": "123 Main St", "invoice_amount": 4200.0},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["id"] is not None
    assert body["vendor_name"] == "Acme Test Co"
    assert body["address"] == "123 Main St"
    assert body["invoice_amount"] == 4200.0
    assert body["risk_tier"] == "low"
    assert body["evidence_count"] == 4
    assert body["recommendation"] == "Clean web presence, proceed with standard review."
    assert body["source"] == "web"
    assert body["cost_usd"] > 0
    assert body["latency_ms"] >= 0
    assert body["signals"] == []
    # No VendorMaster rows exist -- the internal lookup always runs and
    # returns a definite "no_match" (never None; None only means "no
    # internal lookup was performed at all", which never happens via
    # run_and_persist()).
    assert body["internal_match_status"] == "no_match"

    # The pipeline was invoked with the right arguments.
    assert mock_run_pipeline.calls[-1]["vendor_name"] == "Acme Test Co"
    assert mock_run_pipeline.calls[-1]["invoice_amount"] == 4200.0


def test_create_check_surfaces_internal_match_discrepancy(client, mock_run_pipeline, session):
    mock_run_pipeline()  # defaults echo whatever the real internal lookup found

    session.add(
        VendorMaster(
            vendor_name="Procter & Gamble",
            normalized_name="procter gamble",
            known_address="1 Procter and Gamble Plaza, Cincinnati, OH 45202",
            status="approved",
        )
    )
    session.commit()

    response = client.post(
        "/api/checks",
        json={
            "vendor_name": "Procter & Gamble",
            "address": "500 W Madison St, Chicago, IL 60661",
            "invoice_amount": 15000.0,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["internal_match_status"] == "approved_match_discrepancy"


def test_create_check_pipeline_failure_returns_502(client, mock_run_pipeline):
    mock_run_pipeline(raise_error=RuntimeError("Tavily is down"))

    response = client.post("/api/checks", json={"vendor_name": "Whatever Corp"})

    assert response.status_code == 502
    assert "Tavily is down" in response.json()["detail"]


def test_create_check_requires_vendor_name(client, mock_run_pipeline):
    mock_run_pipeline()

    response = client.post("/api/checks", json={"vendor_name": ""})

    assert response.status_code == 422


def _seed_check(session, **overrides) -> VendorCheck:
    defaults = dict(
        vendor_name="Seed Vendor",
        risk_tier="clear",
        source="web",
        evidence_count=2,
        cost_usd=0.01,
        latency_ms=100,
    )
    defaults.update(overrides)
    check = VendorCheck(**defaults)
    session.add(check)
    session.commit()
    session.refresh(check)
    return check


def test_list_checks_filters_by_tier_source_and_query(client, session):
    _seed_check(session, vendor_name="Acme Corp", risk_tier="clear", source="web")
    _seed_check(session, vendor_name="Acme Trading", risk_tier="high", source="copilot")
    _seed_check(session, vendor_name="Zylo Trader", risk_tier="clear", source="eval")

    all_checks = client.get("/api/checks").json()
    assert len(all_checks) == 3

    by_tier = client.get("/api/checks", params={"tier": "high"}).json()
    assert [c["vendor_name"] for c in by_tier] == ["Acme Trading"]

    by_source = client.get("/api/checks", params={"source": "eval"}).json()
    assert [c["vendor_name"] for c in by_source] == ["Zylo Trader"]

    by_query = client.get("/api/checks", params={"q": "acme"}).json()
    assert {c["vendor_name"] for c in by_query} == {"Acme Corp", "Acme Trading"}


def test_list_checks_orders_newest_first_and_paginates(client, session):
    base = utcnow()
    older = _seed_check(session, vendor_name="Older Check", created_at=base - timedelta(hours=2))
    middle = _seed_check(session, vendor_name="Middle Check", created_at=base - timedelta(hours=1))
    newest = _seed_check(session, vendor_name="Newest Check", created_at=base)

    ordered = client.get("/api/checks", params={"limit": 200}).json()
    assert [c["id"] for c in ordered] == [newest.id, middle.id, older.id]

    page = client.get("/api/checks", params={"limit": 1, "offset": 1}).json()
    assert [c["id"] for c in page] == [middle.id]


def test_get_check_detail_found(client, session):
    check = _seed_check(
        session,
        vendor_name="Detail Vendor",
        risk_tier="medium",
        signals_json='[{"category": "legitimacy", "finding": "thin web footprint", '
        '"fraud_pattern": "none", "citations": [{"claim": "no registration found", '
        '"source_type": "web", "source_url": "https://example.com", "source_title": "Example"}]}]',
    )

    response = client.get(f"/api/checks/{check.id}")

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == check.id
    assert len(body["signals"]) == 1
    assert body["signals"][0]["category"] == "legitimacy"
    assert body["signals"][0]["citations"][0]["source_url"] == "https://example.com"


def test_get_check_not_found_returns_404(client):
    response = client.get("/api/checks/999999")
    assert response.status_code == 404
