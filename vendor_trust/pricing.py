"""Shared cost constants, used by eval.py and backend/pipeline_service.py
so every entry point (CLI, eval harness, web dashboard, copilot) computes
`cost_usd` the exact same way from the exact same source of truth.

Pricing constants (sourced 2026-09-10 — verify against current pricing
pages before relying on these for anything beyond illustrative POC math):
- Tavily pay-as-you-go tier: https://docs.tavily.com/documentation/api-credits
- Nebius Token Factory catalog, moonshotai/Kimi-K2.6: https://tokenfactory.nebius.com/model-catalog.md
- Nebius Token Factory catalog, Qwen/Qwen3-Embedding-8B (embeddings): https://tokenfactory.nebius.com/model-catalog.md
"""

from __future__ import annotations

TAVILY_USD_PER_CREDIT = 0.008
NEBIUS_USD_PER_M_INPUT = 0.95
NEBIUS_USD_PER_M_OUTPUT = 4.00
NEBIUS_USD_PER_M_EMBEDDING_TOKENS = 0.01

# Illustrative assumption for the "hours saved" business framing: a
# manual pre-payment vendor check (registry lookup, news search, address
# cross-check) by an AP clerk. This is a placeholder assumption for POC
# math, not a benchmarked time-and-motion study — see README.
MANUAL_CHECK_MINUTES = 10
AP_CLERK_FULLY_LOADED_HOURLY_RATE = 35.0


def compute_cost_usd(
    search_credits: int,
    extract_credits: int,
    llm_input_tokens: int,
    llm_output_tokens: int,
) -> float:
    """Single source of truth for cost-per-check math — used identically
    by eval.py and backend/pipeline_service.py so the number shown on the
    Observability dashboard always matches the eval harness's math."""
    tavily_cost = (search_credits + extract_credits) * TAVILY_USD_PER_CREDIT
    llm_cost = (llm_input_tokens / 1_000_000) * NEBIUS_USD_PER_M_INPUT + (
        llm_output_tokens / 1_000_000
    ) * NEBIUS_USD_PER_M_OUTPUT
    return tavily_cost + llm_cost


def compute_embedding_cost_usd(embedding_tokens: int) -> float:
    """Cost of embedding the findings from one check (backend/embeddings.py
    indexes each finding for semantic search). Added on top of
    `compute_cost_usd()`'s result for the same check -- see
    backend/pipeline_service.py."""
    return (embedding_tokens / 1_000_000) * NEBIUS_USD_PER_M_EMBEDDING_TOKENS


def estimate_tokens(text: str) -> int:
    """Rough word-count-based token estimate for embedding cost tracking.
    `NebiusEmbeddings` (langchain_nebius) doesn't surface exact token
    usage through its `aembed_documents()` interface, so this is a
    labeled estimate, not exact metering -- consistent with this
    project's convention of explicitly flagging illustrative math (see
    eval.py's Business Impact Summary) rather than presenting an
    estimate as a precise figure. At NEBIUS_USD_PER_M_EMBEDDING_TOKENS =
    $0.01/M tokens, the actual dollar exposure of this estimate being
    off by even 2x is negligible."""
    if not text:
        return 0
    return max(1, round(len(text.split()) * 1.3))
