"""Semantic search over past findings -- the one retrieval surface in
this project where meaning-based matching is genuinely the right tool
(see backend/db.py::FindingEmbedding and TECHNICAL_STATEMENT.md for the
full rationale). Every other "search" in this app is either structured
field filtering (backend/api.py's `/api/checks` list, the copilot's
`search_past_checks`) or character-level fuzzy matching for known-vendor
identity (backend/internal_records.py) -- neither of those problems is
improved by embeddings, and this module deliberately doesn't touch them.

Model: Nebius-hosted `Qwen/Qwen3-Embedding-8B` (4096-dim), the same
Nebius Token Factory account already used for the main LLM. No vector
database / vector index is introduced -- at this project's scale
(dozens-to-hundreds of findings) a linear-scan cosine similarity over
`embedding_json` rows, done in plain Python, is exact (not
approximate-nearest-neighbor) and fast enough. Standing up pgvector /
sqlite-vss / a hosted vector DB for this row count would be premature
infrastructure, the same call already made (and documented) for the
main pipeline's retrieval.
"""

from __future__ import annotations

import json
import logging
import math
import os

from langchain_nebius import NebiusEmbeddings
from sqlmodel import Session, select

from backend.db import FindingEmbedding, VendorCheck
from backend.pipeline_service import parse_signals
from vendor_trust.pricing import estimate_tokens

logger = logging.getLogger(__name__)

EMBEDDING_MODEL = "Qwen/Qwen3-Embedding-8B"


def _build_embeddings_client() -> NebiusEmbeddings:
    return NebiusEmbeddings(model=EMBEDDING_MODEL, api_key=os.environ.get("NEBIUS_API_KEY"))


def cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


async def index_check_findings(session: Session, check: VendorCheck) -> tuple[int, int]:
    """Embeds every `finding` string in `check.signals_json` and persists
    one `FindingEmbedding` row each. Returns (rows_indexed, embedding_tokens)
    so the caller (backend/pipeline_service.py) can add the real embedding
    cost onto the check's `cost_usd`.

    Best-effort by design -- called only after `check` is already
    successfully persisted; a failure here must never un-persist or
    invalidate an already-completed vendor check. Callers are expected to
    wrap this in their own try/except (see run_and_persist)."""
    signals = parse_signals(check)
    findings = [s for s in signals if s.get("finding")]
    if not findings or check.id is None:
        return 0, 0

    client = _build_embeddings_client()
    texts = [s["finding"] for s in findings]
    vectors = await client.aembed_documents(texts)

    indexed = 0
    total_tokens = 0
    for signal_index, (signal, vector) in enumerate(zip(findings, vectors)):
        total_tokens += estimate_tokens(signal["finding"])
        session.add(
            FindingEmbedding(
                check_id=check.id,
                signal_index=signal_index,
                vendor_name=check.vendor_name,
                category=signal.get("category", ""),
                finding=signal["finding"],
                fraud_pattern=signal.get("fraud_pattern", "none"),
                embedding_json=json.dumps(vector),
            )
        )
        indexed += 1
    session.commit()
    return indexed, total_tokens


async def search_findings_semantically(
    session: Session, query: str, limit: int = 5
) -> list[dict]:
    """Embeds `query` and ranks every indexed finding by cosine
    similarity -- "have we seen a fraud pattern like this before,
    anywhere, regardless of exact vendor name or wording" is a genuine
    semantic-similarity question that structured filtering and
    character-level fuzzy matching both fail at. Linear scan: exact, no
    approximation, correct at this project's row count."""
    rows = session.exec(select(FindingEmbedding)).all()
    if not rows:
        return []

    client = _build_embeddings_client()
    query_vector = await client.aembed_query(query)

    scored = []
    for row in rows:
        try:
            vector = json.loads(row.embedding_json)
        except (json.JSONDecodeError, TypeError):
            continue
        score = cosine_similarity(query_vector, vector)
        scored.append((score, row))

    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [
        {
            "check_id": row.check_id,
            "vendor_name": row.vendor_name,
            "category": row.category,
            "finding": row.finding,
            "fraud_pattern": row.fraud_pattern,
            "similarity": round(score, 4),
        }
        for score, row in scored[: max(1, min(limit, 25))]
    ]
