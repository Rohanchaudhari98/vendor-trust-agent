"""Cross-references an incoming vendor name/address against the client's
internal approved-vendor master (backend/db.py::VendorMaster) -- the
internal-knowledge half of every check, alongside Tavily's external half.

Why this matters for AP fraud specifically: the highest-value case this
catches is an invoice claiming to be from an *already-approved* vendor,
but with a changed address/remittance detail. Externally this can look
completely unremarkable -- a real, legitimate-looking company with a
clean web presence. Only an internal cross-reference against what the
client actually has on file catches it. This is the real-world "vendor
changed their bank/remittance details" business-email-compromise (BEC)
pattern, and it is exactly the pattern pure external web search cannot
see.

Fuzzy matching uses stdlib `difflib.SequenceMatcher` -- no new
dependency (e.g. rapidfuzz) is justified at this project's scale
(dozens, not millions, of vendor-master rows).
"""

from __future__ import annotations

import json
import re
from difflib import SequenceMatcher

from sqlmodel import Session, select

from backend.db import VendorMaster
from vendor_trust.schema import InternalMatchResult

# Below this similarity, we don't consider it the same vendor at all --
# just a coincidentally similar name (e.g. two unrelated companies that
# both have "Global" or "Trading" in the name).
NAME_MATCH_THRESHOLD = 0.82


def normalize_name(name: str) -> str:
    """Lowercase, strip punctuation/legal suffixes, collapse whitespace --
    so 'Procter & Gamble Co.' and 'procter and gamble company' compare
    sensibly. Deliberately simple (regex, no NLP) for this scale."""
    name = name.lower()
    name = re.sub(r"[.,&/\\-]", " ", name)
    name = re.sub(
        r"\b(inc|incorporated|corp|corporation|co|company|llc|ltd|limited|the)\b", "", name
    )
    name = re.sub(r"\s+", " ", name).strip()
    return name


def _addresses_consistent(provided: str | None, known: str | None) -> bool | None:
    """Returns None (unknown) when either address is missing -- we should
    never claim a discrepancy we can't actually evidence. Otherwise a
    generous fuzzy-consistency check (not exact string equality -- real
    addresses get formatted differently invoice to invoice)."""
    if not provided or not known:
        return None
    provided_norm = re.sub(r"[^a-z0-9]", "", provided.lower())
    known_norm = re.sub(r"[^a-z0-9]", "", known.lower())
    if not provided_norm or not known_norm:
        return None
    similarity = SequenceMatcher(None, provided_norm, known_norm).ratio()
    return similarity >= 0.6


def parse_aliases(record: VendorMaster) -> list[str]:
    try:
        aliases = json.loads(record.aliases_json or "[]")
        return [a for a in aliases if isinstance(a, str) and a.strip()]
    except (json.JSONDecodeError, TypeError):
        return []


def _best_similarity_for_record(target_norm: str, record: VendorMaster) -> float:
    """Compares against the canonical name AND every enumerated alias
    (ticker symbols, DBA names, common abbreviations -- e.g. "P&G" for
    Procter & Gamble), taking the best match. Aliases exist precisely
    because these often share little-to-no character overlap with the
    full legal name, so matching the canonical name alone would miss
    them even with a generous SequenceMatcher threshold."""
    best = SequenceMatcher(None, target_norm, record.normalized_name).ratio()
    for alias in parse_aliases(record):
        alias_similarity = SequenceMatcher(None, target_norm, normalize_name(alias)).ratio()
        best = max(best, alias_similarity)
    return best


def lookup_vendor_master(
    session: Session, vendor_name: str, address: str | None = None
) -> InternalMatchResult:
    """Fuzzy-matches `vendor_name` (against the canonical name AND any
    known aliases) against every VendorMaster row and returns the single
    best match (if any clears NAME_MATCH_THRESHOLD), with the resulting
    internal_match_status computed deterministically here in Python --
    never left for the LLM to infer."""
    target_norm = normalize_name(vendor_name)
    records = session.exec(select(VendorMaster)).all()

    best_record: VendorMaster | None = None
    best_similarity = 0.0
    for record in records:
        similarity = _best_similarity_for_record(target_norm, record)
        if similarity > best_similarity:
            best_similarity = similarity
            best_record = record

    if best_record is None or best_similarity < NAME_MATCH_THRESHOLD:
        return InternalMatchResult(found=False, status="no_match")

    address_consistent = _addresses_consistent(address, best_record.known_address)

    if best_record.status == "blocked":
        status = "blocked_match"
    elif best_record.status == "watchlist":
        status = "watchlist_match"
    elif best_record.status == "approved":
        status = "approved_match_discrepancy" if address_consistent is False else "approved_match"
    else:
        status = "approved_match"

    return InternalMatchResult(
        found=True,
        status=status,
        matched_vendor_name=best_record.vendor_name,
        name_similarity=round(best_similarity, 4),
        address_consistent=address_consistent,
        notes=best_record.notes,
    )
