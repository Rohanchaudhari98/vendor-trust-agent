"""backend/embeddings.py -- the one genuinely semantic retrieval surface
in this project. cosine_similarity is pure math (no mocking needed);
index_check_findings / search_findings_semantically are tested against
`mock_embeddings_client` (backend/tests/conftest.py) so no test makes a
real Nebius embeddings call."""

from __future__ import annotations

import json

import pytest

from backend.db import FindingEmbedding, VendorCheck
from backend.embeddings import cosine_similarity, index_check_findings, search_findings_semantically


# --- cosine_similarity (pure math) -------------------------------------


def test_cosine_similarity_identical_vectors_is_one():
    assert cosine_similarity([1.0, 2.0, 3.0], [1.0, 2.0, 3.0]) == pytest.approx(1.0)


def test_cosine_similarity_orthogonal_vectors_is_zero():
    assert cosine_similarity([1.0, 0.0], [0.0, 1.0]) == pytest.approx(0.0)


def test_cosine_similarity_opposite_vectors_is_negative_one():
    assert cosine_similarity([1.0, 0.0], [-1.0, 0.0]) == pytest.approx(-1.0)


def test_cosine_similarity_zero_vector_is_zero_not_nan():
    assert cosine_similarity([0.0, 0.0], [1.0, 2.0]) == 0.0


def test_cosine_similarity_mismatched_lengths_is_zero():
    assert cosine_similarity([1.0, 2.0], [1.0, 2.0, 3.0]) == 0.0


def test_cosine_similarity_empty_vectors_is_zero():
    assert cosine_similarity([], []) == 0.0


# --- index_check_findings ------------------------------------------------


def _seed_check_with_signals(session, signals: list[dict], **overrides) -> VendorCheck:
    defaults = dict(vendor_name="Embedding Test Vendor", risk_tier="needs_manual_review")
    defaults.update(overrides)
    check = VendorCheck(signals_json=json.dumps(signals), **defaults)
    session.add(check)
    session.commit()
    session.refresh(check)
    return check


async def test_index_check_findings_persists_one_row_per_finding(session, mock_embeddings_client):
    check = _seed_check_with_signals(
        session,
        [
            {
                "category": "adverse_media",
                "finding": "guaranteed daily investment returns promoted via social media",
                "fraud_pattern": "none",
                "citations": [],
            },
            {
                "category": "legitimacy",
                "finding": "no independent business registration record found",
                "fraud_pattern": "shell_company",
                "citations": [],
            },
        ],
    )

    indexed, tokens = await index_check_findings(session, check)

    assert indexed == 2
    assert tokens > 0

    from sqlmodel import select

    rows = session.exec(select(FindingEmbedding).where(FindingEmbedding.check_id == check.id)).all()
    assert len(rows) == 2
    assert {r.category for r in rows} == {"adverse_media", "legitimacy"}
    fraud_patterns = {r.category: r.fraud_pattern for r in rows}
    assert fraud_patterns["legitimacy"] == "shell_company"

    # Each embedding_json is a valid vector matching the fake client's dim.
    for row in rows:
        vector = json.loads(row.embedding_json)
        assert len(vector) == mock_embeddings_client.dim


async def test_index_check_findings_skips_when_check_id_is_none(session, mock_embeddings_client):
    check = VendorCheck(
        vendor_name="Unpersisted",
        risk_tier="clear",
        signals_json=json.dumps([{"category": "legitimacy", "finding": "some finding", "citations": []}]),
    )
    # Deliberately not added/committed -- check.id stays None.
    indexed, tokens = await index_check_findings(session, check)
    assert (indexed, tokens) == (0, 0)
    assert mock_embeddings_client.calls == []  # never even called the embeddings client


async def test_index_check_findings_handles_empty_signals(session, mock_embeddings_client):
    check = _seed_check_with_signals(session, [])
    indexed, tokens = await index_check_findings(session, check)
    assert (indexed, tokens) == (0, 0)


async def test_index_check_findings_skips_signals_with_no_finding_text(session, mock_embeddings_client):
    check = _seed_check_with_signals(session, [{"category": "legitimacy", "finding": "", "citations": []}])
    indexed, tokens = await index_check_findings(session, check)
    assert (indexed, tokens) == (0, 0)


# --- search_findings_semantically ---------------------------------------


async def test_search_findings_semantically_ranks_by_word_overlap(session, mock_embeddings_client):
    investment_check = _seed_check_with_signals(
        session,
        [
            {
                "category": "adverse_media",
                "finding": "guaranteed daily investment returns high yield scheme promoted online",
                "fraud_pattern": "none",
                "citations": [],
            }
        ],
        vendor_name="Investment Vendor",
    )
    registration_check = _seed_check_with_signals(
        session,
        [
            {
                "category": "legitimacy",
                "finding": "no independent business registration record found as of search date",
                "fraud_pattern": "shell_company",
                "citations": [],
            }
        ],
        vendor_name="Registration Vendor",
    )
    await index_check_findings(session, investment_check)
    await index_check_findings(session, registration_check)

    results = await search_findings_semantically(
        session, "guaranteed high yield investment returns", limit=5
    )

    assert len(results) == 2
    # The investment-language finding should rank above the unrelated
    # business-registration finding given the shared vocabulary.
    assert results[0]["check_id"] == investment_check.id
    assert results[0]["similarity"] > results[1]["similarity"]
    assert results[0]["vendor_name"] == "Investment Vendor"


async def test_search_findings_semantically_empty_index_returns_empty_list(session, mock_embeddings_client):
    results = await search_findings_semantically(session, "anything", limit=5)
    assert results == []
    assert mock_embeddings_client.calls == []  # short-circuits before embedding the query


async def test_search_findings_semantically_respects_limit(session, mock_embeddings_client):
    for i in range(3):
        check = _seed_check_with_signals(
            session,
            [{"category": "legitimacy", "finding": f"finding number {i} about vendor identity", "citations": []}],
            vendor_name=f"Vendor {i}",
        )
        await index_check_findings(session, check)

    results = await search_findings_semantically(session, "vendor identity", limit=2)
    assert len(results) == 2
