"""Shared pytest fixtures for the backend test suite.

Two things every test needs isolation from:
1. The real `vendor_trust.db` at the project root -- each test gets its
   own temp-file SQLite DB, wired in by monkeypatching the module-level
   `backend.db.engine` (both `get_session()` and `init_db()` look this up
   as a module global at call time, so patching it here is sufficient --
   no FastAPI `dependency_overrides` needed).
2. Real Tavily/Nebius API calls -- `mock_run_pipeline` patches
   `backend.pipeline_service.run_pipeline` (the external-pipeline call)
   with a scriptable fake; `scripted_copilot_llm` patches
   `backend.copilot._build_llm` with a scriptable fake chat model. No
   test in this suite makes a real network call.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
from collections.abc import Generator

import pytest

os.environ.setdefault("NEBIUS_API_KEY", "test-nebius-key")
os.environ.setdefault("TAVILY_API_KEY", "test-tavily-key")

from sqlmodel import Session, SQLModel, create_engine  # noqa: E402

import backend.db as db_module  # noqa: E402
from vendor_trust.schema import RiskTier, VendorRiskReport  # noqa: E402


@pytest.fixture()
def test_engine(tmp_path, monkeypatch):
    """A fresh temp-file SQLite DB per test, swapped in as the module-level
    engine every other piece of backend code (get_session, init_db) reads
    from at call time."""
    db_path = tmp_path / "test_vendor_trust.db"
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(engine)
    monkeypatch.setattr(db_module, "engine", engine)
    yield engine
    SQLModel.metadata.drop_all(engine)


@pytest.fixture()
def session(test_engine) -> Generator[Session, None, None]:
    """Direct DB access for seeding rows a test needs to already exist."""
    with Session(test_engine) as s:
        yield s


@pytest.fixture()
def client(test_engine):
    """A TestClient wired to the isolated test_engine. Imported lazily
    (not at module scope) so `test_engine`'s monkeypatch of
    `backend.db.engine` is already active before `backend.api`'s
    startup event (which calls `init_db()`) fires."""
    from fastapi.testclient import TestClient

    from backend.api import app

    with TestClient(app) as c:
        yield c


@pytest.fixture()
def mock_run_pipeline(monkeypatch):
    """Patches out the real Tavily-search + Nebius-LLM pipeline call with a
    scriptable fake. Returns a `configure(**kwargs)` callable; the fake's
    call arguments are recorded on `configure.calls`.

    Defaults produce a "clear" tier report with zero-signal, low-cost
    usage -- enough for tests that only care about persistence/API shape.
    Tests that care about specific tiers/signals/internal_match_status
    call `configure(...)` before exercising the endpoint under test.
    """
    calls: list[dict] = []
    state = {
        "risk_tier": "clear",
        "evidence_count": 3,
        "recommendation": "No adverse findings in available evidence.",
        "signals": None,
        "usage": None,
        "internal_match_status": "__use_lookup__",
        "raise_error": None,
    }

    async def _fake_run_pipeline(vendor_name, address=None, invoice_amount=None, internal_match=None, model=None):
        calls.append(
            {
                "vendor_name": vendor_name,
                "address": address,
                "invoice_amount": invoice_amount,
                "internal_match": internal_match,
                "model": model,
            }
        )
        if state["raise_error"] is not None:
            raise state["raise_error"]

        if state["internal_match_status"] == "__use_lookup__":
            internal_status = internal_match.status if internal_match else None
        else:
            internal_status = state["internal_match_status"]

        report = VendorRiskReport(
            vendor_name=vendor_name,
            invoice_amount=invoice_amount,
            risk_tier=RiskTier(state["risk_tier"]),
            evidence_count=state["evidence_count"],
            internal_match_status=internal_status,
            signals=state["signals"] or [],
            recommendation=state["recommendation"],
        )
        usage = state["usage"] or {
            "search_credits": 2,
            "extract_credits": 1,
            "llm_input_tokens": 500,
            "llm_output_tokens": 150,
        }
        return report, usage

    monkeypatch.setattr("backend.pipeline_service.run_pipeline", _fake_run_pipeline)

    def configure(**kwargs):
        state.update(kwargs)

    configure.calls = calls
    return configure


class _FakeAIMessage:
    def __init__(self, content: str):
        self.content = content


class ScriptedLLM:
    """A fake `ChatNebius` -- `.ainvoke()` pops the next canned response
    off a list, in order, and wraps it as an `AIMessage`-shaped object
    (the copilot loop only ever reads `.content`)."""

    def __init__(self, responses: list[str]):
        self._responses = list(responses)
        self.invocation_message_histories: list[list] = []

    async def ainvoke(self, messages):
        self.invocation_message_histories.append(messages)
        if not self._responses:
            raise AssertionError("ScriptedLLM ran out of scripted responses for this turn")
        return _FakeAIMessage(self._responses.pop(0))


@pytest.fixture()
def scripted_copilot_llm(monkeypatch):
    """Patches `backend.copilot._build_llm` so the copilot's agent loop
    drives against a scripted sequence of JSON-action responses instead
    of a real Nebius call. Usage: `llm = scripted_copilot_llm([...])`."""

    def _install(responses: list[str]) -> ScriptedLLM:
        llm = ScriptedLLM(responses)
        monkeypatch.setattr("backend.copilot._build_llm", lambda model=None: llm)
        return llm

    return _install


class FakeEmbeddingsClient:
    """Deterministic fake for `NebiusEmbeddings` -- a hashed bag-of-words
    vector (not a real semantic model), but good enough to exercise the
    ranking/ordering logic in backend/embeddings.py without a real Nebius
    call: texts sharing more words land in more of the same hash buckets
    and score higher on cosine similarity, so tests can pick deliberately
    overlapping vs. disjoint vocabulary to assert expected ranking."""

    def __init__(self, dim: int = 64):
        self.dim = dim
        self.calls: list[list[str] | str] = []

    def _vector(self, text: str) -> list[float]:
        vec = [0.0] * self.dim
        for word in text.lower().split():
            idx = int(hashlib.md5(word.encode()).hexdigest(), 16) % self.dim
            vec[idx] += 1.0
        norm = math.sqrt(sum(v * v for v in vec)) or 1.0
        return [v / norm for v in vec]

    async def aembed_documents(self, texts: list[str]) -> list[list[float]]:
        self.calls.append(list(texts))
        return [self._vector(t) for t in texts]

    async def aembed_query(self, text: str) -> list[float]:
        self.calls.append(text)
        return self._vector(text)


@pytest.fixture()
def mock_embeddings_client(monkeypatch) -> FakeEmbeddingsClient:
    """Patches backend.embeddings._build_embeddings_client so no test
    makes a real Nebius embeddings call."""
    client = FakeEmbeddingsClient()
    monkeypatch.setattr("backend.embeddings._build_embeddings_client", lambda: client)
    return client


def parse_sse_events(body: str) -> list[dict]:
    """Parses the raw `text/event-stream` response body from a copilot
    chat call back into a list of `{"type": ..., ...}` event dicts, in
    the same way the frontend's `streamCopilotChat()` does."""
    events: list[dict] = []
    for chunk in body.split("\n\n"):
        line = chunk.strip()
        if not line.startswith("data:"):
            continue
        raw = line[len("data:") :].strip()
        if not raw:
            continue
        events.append(json.loads(raw))
    return events
