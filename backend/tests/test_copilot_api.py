"""Mocked LLM responses driving the manual-JSON-action loop -- asserts
correct tool dispatch and that final_answer citations are populated when
the answer references check/internal data (a grounding smoke check, not
a full eval)."""

from __future__ import annotations

import json

from backend.db import VendorCheck
from backend.tests.conftest import parse_sse_events


def _seed_check(session, **overrides) -> VendorCheck:
    defaults = dict(vendor_name="Copilot Vendor", risk_tier="clear", evidence_count=3)
    defaults.update(overrides)
    check = VendorCheck(**defaults)
    session.add(check)
    session.commit()
    session.refresh(check)
    return check


def _final_answer(text: str, citations: list[dict] | None = None) -> str:
    return json.dumps({"action": "final_answer", "input": {"text": text, "citations": citations or []}})


def test_search_past_checks_tool_dispatch_and_grounded_citation(client, session, scripted_copilot_llm):
    _seed_check(session, vendor_name="Acme Corp", risk_tier="clear")
    _seed_check(session, vendor_name="Acme Trading", risk_tier="high")

    llm = scripted_copilot_llm(
        [
            json.dumps({"action": "search_past_checks", "input": {"query": "Acme"}}),
            _final_answer(
                "We have **2** past checks on file for Acme-named vendors.",
                citations=[
                    {
                        "claim": "2 past checks on file for Acme-named vendors",
                        "source_type": "internal",
                        "source_title": "Internal check history",
                    }
                ],
            ),
        ]
    )

    response = client.post(
        "/api/copilot/chat", json={"session_id": "sess-search", "message": "What checks have we run on Acme?"}
    )

    assert response.status_code == 200
    events = parse_sse_events(response.text)

    status_events = [e for e in events if e["type"] == "status"]
    assert any("Searching past checks" in e["message"] for e in status_events)

    answer_events = [e for e in events if e["type"] == "answer"]
    assert len(answer_events) == 1
    answer = answer_events[0]
    assert "2 past checks" in answer["text"] or "2** past checks" in answer["text"]
    assert answer["citations"][0]["source_type"] == "internal"
    # search_past_checks never adds to check_ids -- only get_check_detail /
    # run_new_vendor_check do, per the plan's "ephemeral inline card" rule.
    assert answer["check_ids"] == []

    # The LLM actually received the tool's real results, not a stub.
    second_call_messages = llm.invocation_message_histories[1]
    tool_result_text = str(second_call_messages[-1].content)
    assert "Acme Corp" in tool_result_text
    assert "Acme Trading" in tool_result_text

    # Conversation was persisted and is replayable.
    history = client.get("/api/copilot/history", params={"session_id": "sess-search"}).json()
    assert [m["role"] for m in history] == ["user", "assistant"]
    assert history[1]["citations"][0]["source_type"] == "internal"


def test_get_check_detail_populates_check_ids_for_inline_card(client, session, scripted_copilot_llm):
    check = _seed_check(session, vendor_name="Detail Target Co", risk_tier="medium")

    scripted_copilot_llm(
        [
            json.dumps({"action": "get_check_detail", "input": {"check_id": check.id}}),
            _final_answer(f"Check #{check.id} for Detail Target Co came back **medium** risk."),
        ]
    )

    response = client.post(
        "/api/copilot/chat", json={"session_id": "sess-detail", "message": f"Tell me about check {check.id}"}
    )

    events = parse_sse_events(response.text)
    answer = next(e for e in events if e["type"] == "answer")
    assert answer["check_ids"] == [check.id]


def test_get_check_detail_missing_id_returns_tool_error_not_crash(client, session, scripted_copilot_llm):
    scripted_copilot_llm(
        [
            json.dumps({"action": "get_check_detail", "input": {"check_id": 999999}}),
            _final_answer("I couldn't find a check with that ID in our history."),
        ]
    )

    response = client.post(
        "/api/copilot/chat", json={"session_id": "sess-missing", "message": "Show me check 999999"}
    )

    assert response.status_code == 200
    answer = next(e for e in parse_sse_events(response.text) if e["type"] == "answer")
    assert "couldn't find" in answer["text"]
    assert answer["check_ids"] == []


def test_invalid_json_response_triggers_retry_not_crash(client, session, scripted_copilot_llm):
    scripted_copilot_llm(
        [
            "I think the vendor is probably fine, no need for JSON here.",
            _final_answer("Understood -- here's a grounded answer instead."),
        ]
    )

    response = client.post(
        "/api/copilot/chat", json={"session_id": "sess-retry", "message": "Is this vendor safe?"}
    )

    assert response.status_code == 200
    answer = next(e for e in parse_sse_events(response.text) if e["type"] == "answer")
    assert answer["text"] == "Understood -- here's a grounded answer instead."


def test_run_new_vendor_check_dispatches_through_run_and_persist(client, session, scripted_copilot_llm, mock_run_pipeline):
    mock_run_pipeline(risk_tier="clear", evidence_count=5)

    scripted_copilot_llm(
        [
            json.dumps(
                {
                    "action": "run_new_vendor_check",
                    "input": {"vendor_name": "Brand New Vendor Inc", "invoice_amount": 2500},
                }
            ),
            _final_answer("I ran a new check on Brand New Vendor Inc -- it came back **clear**."),
        ]
    )

    response = client.post(
        "/api/copilot/chat",
        json={"session_id": "sess-new-check", "message": "Please run a check on Brand New Vendor Inc"},
    )

    assert response.status_code == 200
    answer = next(e for e in parse_sse_events(response.text) if e["type"] == "answer")
    assert len(answer["check_ids"]) == 1
    new_check_id = answer["check_ids"][0]

    # The check the copilot triggered actually landed in the shared
    # vendor_checks table, tagged with source="copilot" -- it shows up in
    # the dashboard's history exactly like any other check.
    detail = client.get(f"/api/checks/{new_check_id}").json()
    assert detail["vendor_name"] == "Brand New Vendor Inc"
    assert detail["source"] == "copilot"
    assert detail["risk_tier"] == "clear"
    assert mock_run_pipeline.calls[-1]["vendor_name"] == "Brand New Vendor Inc"


def test_lookup_vendor_master_tool_dispatch(client, session, scripted_copilot_llm):
    from backend.db import VendorMaster
    from backend.internal_records import normalize_name

    session.add(
        VendorMaster(
            vendor_name="Superior Group of Companies",
            normalized_name=normalize_name("Superior Group of Companies"),
            known_address="10055 Seminole Blvd, Seminole, FL 33772",
            status="approved",
        )
    )
    session.commit()

    scripted_copilot_llm(
        [
            json.dumps({"action": "lookup_vendor_master", "input": {"vendor_name": "Superior Group of Companies"}}),
            _final_answer(
                "Superior Group of Companies is on our approved vendor master.",
                citations=[
                    {
                        "claim": "Superior Group of Companies is an approved vendor",
                        "source_type": "internal",
                        "source_title": "Internal Vendor Master",
                    }
                ],
            ),
        ]
    )

    response = client.post(
        "/api/copilot/chat",
        json={"session_id": "sess-lookup", "message": "Is Superior Group of Companies an approved vendor?"},
    )

    events = parse_sse_events(response.text)
    status_messages = [e["message"] for e in events if e["type"] == "status"]
    assert any("Superior Group of Companies" in m for m in status_messages)
    answer = next(e for e in events if e["type"] == "answer")
    assert answer["citations"][0]["source_type"] == "internal"


async def test_search_findings_semantically_tool_dispatch(client, session, scripted_copilot_llm, mock_embeddings_client):
    from backend.embeddings import index_check_findings

    check = _seed_check(
        session,
        vendor_name="Suspicious Forex Co",
        risk_tier="needs_manual_review",
        signals_json=json.dumps(
            [
                {
                    "category": "adverse_media",
                    "finding": "guaranteed daily investment returns high yield scheme promoted online",
                    "fraud_pattern": "none",
                    "citations": [],
                }
            ]
        ),
    )
    await index_check_findings(session, check)

    llm = scripted_copilot_llm(
        [
            json.dumps(
                {
                    "action": "search_findings_semantically",
                    "input": {"query": "guaranteed high yield investment returns"},
                }
            ),
            _final_answer(
                "We've seen a similar guaranteed-returns investment pattern before, on a past check.",
                citations=[
                    {
                        "claim": "A past check flagged guaranteed daily investment returns language",
                        "source_type": "internal",
                        "source_title": "Internal check history (semantic match)",
                    }
                ],
            ),
        ]
    )

    response = client.post(
        "/api/copilot/chat",
        json={
            "session_id": "sess-semantic",
            "message": "Have we seen anything like a guaranteed-returns investment scheme before?",
        },
    )

    assert response.status_code == 200
    events = parse_sse_events(response.text)
    status_messages = [e["message"] for e in events if e["type"] == "status"]
    assert any("similar patterns" in m for m in status_messages)

    answer = next(e for e in events if e["type"] == "answer")
    assert "guaranteed-returns" in answer["text"] or "guaranteed" in answer["text"]
    # The matched check surfaces as an inline report card, same mechanism
    # as get_check_detail / run_new_vendor_check.
    assert answer["check_ids"] == [check.id]

    # The LLM actually received the real ranked results, not a stub.
    second_call_messages = llm.invocation_message_histories[1]
    tool_result_text = str(second_call_messages[-1].content)
    assert "Suspicious Forex Co" in tool_result_text
    assert "guaranteed daily investment returns" in tool_result_text


def test_copilot_history_empty_for_unknown_session(client):
    response = client.get("/api/copilot/history", params={"session_id": "never-used"})
    assert response.status_code == 200
    assert response.json() == []


def test_copilot_clear_history(client, scripted_copilot_llm):
    scripted_copilot_llm([_final_answer("Hello from a short session.")])

    chat = client.post(
        "/api/copilot/chat",
        json={"session_id": "sess-clear-me", "message": "Hi"},
    )
    assert chat.status_code == 200

    before = client.get("/api/copilot/history", params={"session_id": "sess-clear-me"})
    assert len(before.json()) >= 1

    cleared = client.delete("/api/copilot/history", params={"session_id": "sess-clear-me"})
    assert cleared.status_code == 200
    assert cleared.json()["deleted"] >= 1

    after = client.get("/api/copilot/history", params={"session_id": "sess-clear-me"})
    assert after.json() == []

    empty = client.delete("/api/copilot/history", params={"session_id": "sess-clear-me"})
    assert empty.status_code == 200
    assert empty.json()["deleted"] == 0
