"""Evidence gathering pipeline: query planning -> Tavily search -> curation
-> Tavily extract.

This is the fix for the starter script's biggest weakness: raw Tavily
search JSON piped straight into the LLM. Here, retrieval and reasoning are
separate steps. Search results are score-filtered and deduped *before*
anything reaches the LLM, and only the shortlisted URLs get a full,
targeted Extract call — so the model reasons over real page text, not a
Google-style ten-blue-links snippet.

Tavily is used directly via `tavily-python` (not the LangChain tool
wrapper) because this pipeline needs per-query control over `topic`,
`time_range`, and `include_domains`/`exclude_domains` — parameters suited
to a single deterministic pipeline stage, not a tool an LLM calls freely.
"""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass, field
from urllib.parse import urlparse

from langfuse import observe
from tavily import AsyncTavilyClient

from vendor_trust.schema import SignalCategory

SCORE_THRESHOLD = 0.5
MAX_CURATED_SOURCES = 8
MAX_EXTRACT_SOURCES = 5
CHUNKS_PER_SOURCE = 3

# Authoritative-ish domains to bias toward for legitimacy checks. Not
# exhaustive — a real deployment would tune this per jurisdiction.
LEGITIMACY_DOMAINS = [
    "sec.gov",
    "opencorporates.com",
    "bbb.org",
    "*.gov",
    "linkedin.com",
]

# Low-signal domains that tend to be SEO content farms, not evidence.
EXCLUDE_DOMAINS = ["pinterest.com", "quora.com"]


@dataclass
class QuerySpec:
    category: SignalCategory
    query: str
    topic: str = "general"
    time_range: str | None = None
    include_domains: list[str] | None = None
    exclude_domains: list[str] | None = None


@dataclass
class EvidenceItem:
    category: SignalCategory
    title: str
    url: str
    score: float
    snippet: str
    extracted_text: str = ""


@dataclass
class EvidencePack:
    items: list[EvidenceItem] = field(default_factory=list)
    search_credits: int = 0
    extract_credits: int = 0

    @property
    def source_count(self) -> int:
        return len(self.items)

    def as_prompt_text(self) -> str:
        """Render the curated, extracted evidence as a single block for
        the LLM. Every block is tagged with its source URL up front so
        the synthesis step can cite it directly."""
        if not self.items:
            return "No web evidence was found for this vendor."
        blocks = []
        for i, item in enumerate(self.items, start=1):
            body = item.extracted_text or item.snippet
            blocks.append(
                f"[Source {i}] category={item.category} url={item.url} "
                f"title={item.title!r}\n{body}"
            )
        return "\n\n".join(blocks)


def plan_queries(vendor_name: str, address: str | None = None) -> list[QuerySpec]:
    """Three targeted sub-queries instead of one generic search — each
    maps to a distinct, named fraud-signal category (see schema.py)."""
    location_hint = f" {address}" if address else ""
    return [
        QuerySpec(
            category="legitimacy",
            query=f'"{vendor_name}" business registration OR incorporation OR "secretary of state"{location_hint}',
            topic="finance",
            include_domains=LEGITIMACY_DOMAINS,
        ),
        QuerySpec(
            category="adverse_media",
            query=f'"{vendor_name}" fraud OR scam OR lawsuit OR bankruptcy OR "shell company"',
            topic="news",
            time_range="year",
            exclude_domains=EXCLUDE_DOMAINS,
        ),
        QuerySpec(
            category="entity_consistency",
            query=f'"{vendor_name}"{location_hint} official website headquarters',
            topic="general",
            exclude_domains=EXCLUDE_DOMAINS,
        ),
    ]


@observe(name="tavily_search_all")
async def gather(specs: list[QuerySpec]) -> tuple[list[EvidenceItem], int]:
    """Run all sub-queries in parallel. Returns raw (unfiltered) items
    plus a rough credit count, pulled from Tavily's `include_usage`."""
    client = AsyncTavilyClient(api_key=os.environ.get("TAVILY_API_KEY"))

    async def _run(spec: QuerySpec) -> tuple[QuerySpec, dict]:
        response = await client.search(
            query=spec.query,
            search_depth="advanced",
            topic=spec.topic,
            time_range=spec.time_range,
            include_domains=spec.include_domains or [],
            exclude_domains=spec.exclude_domains or [],
            max_results=5,
            include_usage=True,
        )
        return spec, response

    results = await asyncio.gather(*(_run(s) for s in specs), return_exceptions=True)

    items: list[EvidenceItem] = []
    credits_used = 0
    for result in results:
        if isinstance(result, Exception):
            # A single failed sub-query (timeout, transient error) should
            # not take down the whole vendor check — the other
            # categories still produce a usable, if partial, report.
            continue
        spec, response = result
        credits_used += (response.get("usage") or {}).get("credits", 1)
        for r in response.get("results", []):
            items.append(
                EvidenceItem(
                    category=spec.category,
                    title=r.get("title", ""),
                    url=r.get("url", ""),
                    score=r.get("score", 0.0),
                    snippet=" ".join((r.get("content") or "").split()),
                )
            )
    return items, credits_used


def curate(items: list[EvidenceItem]) -> list[EvidenceItem]:
    """Filter by relevance score and dedupe by domain before anything is
    sent to Extract or the LLM. Tavily's `score` measures query
    relevance, not "is this definitely about the right company" — that
    entity-disambiguation gap is a known limitation, not solved here."""
    filtered = [i for i in items if i.score >= SCORE_THRESHOLD]
    filtered.sort(key=lambda i: i.score, reverse=True)

    seen_domains: set[str] = set()
    deduped: list[EvidenceItem] = []
    for item in filtered:
        domain = urlparse(item.url).netloc
        if domain in seen_domains:
            continue
        seen_domains.add(domain)
        deduped.append(item)
        if len(deduped) >= MAX_CURATED_SOURCES:
            break
    return deduped


@observe(name="tavily_extract_top_sources")
async def extract_evidence(vendor_name: str, curated: list[EvidenceItem]) -> tuple[list[EvidenceItem], int]:
    """Full, targeted extraction on the shortlisted URLs only — this is
    what lets the LLM reason over real page text instead of a truncated
    search snippet that might miss the one sentence that matters."""
    if not curated:
        return [], 0

    client = AsyncTavilyClient(api_key=os.environ.get("TAVILY_API_KEY"))
    top = curated[:MAX_EXTRACT_SOURCES]
    urls = [i.url for i in top]

    try:
        response = await client.extract(
            urls=urls,
            query=vendor_name,
            chunks_per_source=CHUNKS_PER_SOURCE,
            extract_depth="advanced",
            include_usage=True,
        )
    except Exception:
        # Extraction failing entirely still leaves the search snippets
        # as usable (lower-fidelity) evidence.
        return top, 0

    credits_used = (response.get("usage") or {}).get("credits", 0)
    extracted_by_url = {r["url"]: r.get("raw_content", "") for r in response.get("results", [])}

    for item in top:
        item.extracted_text = extracted_by_url.get(item.url, "")

    return top, credits_used


async def build_evidence_pack(vendor_name: str, address: str | None = None) -> EvidencePack:
    """End-to-end: plan -> search -> curate -> extract."""
    specs = plan_queries(vendor_name, address)
    raw_items, search_credits = await gather(specs)
    curated = curate(raw_items)
    extracted, extract_credits = await extract_evidence(vendor_name, curated)
    return EvidencePack(items=extracted, search_credits=search_credits, extract_credits=extract_credits)
