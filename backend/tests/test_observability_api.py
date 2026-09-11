"""GET /api/observability -- response shape, trace-link presence/absence."""

from __future__ import annotations

from backend.db import VendorCheck


def _seed(session, **overrides) -> VendorCheck:
    defaults = dict(vendor_name="Obs Vendor", risk_tier="clear", cost_usd=0.05, latency_ms=1200)
    defaults.update(overrides)
    check = VendorCheck(**defaults)
    session.add(check)
    session.commit()
    session.refresh(check)
    return check


def test_observability_rows_and_aggregate(client, session, monkeypatch):
    # The real .env may set LANGFUSE_BASE_URL for this project's actual
    # Langfuse region -- pin it here so this test's expected default URL
    # is deterministic regardless of local environment.
    monkeypatch.delenv("LANGFUSE_BASE_URL", raising=False)

    traced = _seed(
        session,
        vendor_name="Traced Vendor",
        cost_usd=0.10,
        latency_ms=2000,
        langfuse_trace_id="trace-abc-123",
    )
    untraced = _seed(session, vendor_name="Untraced Vendor", cost_usd=0.02, latency_ms=800, langfuse_trace_id=None)

    response = client.get("/api/observability")
    assert response.status_code == 200
    body = response.json()

    rows_by_id = {row["id"]: row for row in body["rows"]}
    assert rows_by_id[traced.id]["langfuse_trace_url"] == "https://cloud.langfuse.com/trace/trace-abc-123"
    assert rows_by_id[untraced.id]["langfuse_trace_id"] is None
    assert rows_by_id[untraced.id]["langfuse_trace_url"] is None

    assert body["aggregate"]["total_checks"] == 2
    assert round(body["aggregate"]["total_cost_usd"], 4) == 0.12
    assert body["aggregate"]["avg_latency_ms"] == 1400
    assert round(body["aggregate"]["avg_cost_usd"], 4) == 0.06
    assert body["langfuse_url"] == "https://cloud.langfuse.com"


def test_observability_trace_url_honors_custom_langfuse_base_url(client, session, monkeypatch):
    monkeypatch.setenv("LANGFUSE_BASE_URL", "https://self-hosted.example.com/")
    check = _seed(session, vendor_name="Custom Base Vendor", langfuse_trace_id="trace-xyz")

    response = client.get("/api/observability")
    body = response.json()
    row = next(r for r in body["rows"] if r["id"] == check.id)

    assert row["langfuse_trace_url"] == "https://self-hosted.example.com/trace/trace-xyz"
    assert body["langfuse_url"] == "https://self-hosted.example.com"


def test_observability_respects_limit(client, session):
    for i in range(5):
        _seed(session, vendor_name=f"Vendor {i}")

    response = client.get("/api/observability", params={"limit": 2})
    assert len(response.json()["rows"]) == 2
    # Aggregate is always computed over ALL checks, not just the limited page.
    assert response.json()["aggregate"]["total_checks"] == 5


def test_observability_empty_db(client):
    response = client.get("/api/observability")
    body = response.json()
    assert body["rows"] == []
    assert body["aggregate"]["total_checks"] == 0
    assert body["aggregate"]["avg_latency_ms"] == 0
    assert body["aggregate"]["avg_cost_usd"] == 0
