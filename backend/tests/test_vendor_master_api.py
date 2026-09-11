"""GET /api/vendor-master (list endpoint) + fuzzy-match lookup cases
(exact match, no match, name-match-with-address-discrepancy, and
alias-based match) against backend.internal_records.lookup_vendor_master
directly."""

from __future__ import annotations

import json

from backend.db import VendorMaster
from backend.internal_records import lookup_vendor_master, normalize_name


def _seed_master(session, aliases: list[str] | None = None, **overrides) -> VendorMaster:
    defaults = dict(vendor_name="Vendor", normalized_name="vendor", status="approved")
    defaults.update(overrides)
    if aliases is not None:
        defaults["aliases_json"] = json.dumps(aliases)
    record = VendorMaster(**defaults)
    session.add(record)
    session.commit()
    session.refresh(record)
    return record


# --- REST endpoint ----------------------------------------------------


def test_list_vendor_master_returns_all_records_sorted_by_name(client, session):
    _seed_master(session, vendor_name="Zylo Trader", normalized_name=normalize_name("Zylo Trader"))
    _seed_master(session, vendor_name="Acme Corp", normalized_name=normalize_name("Acme Corp"), known_address="1 Acme Way")

    response = client.get("/api/vendor-master")

    assert response.status_code == 200
    names = [r["vendor_name"] for r in response.json()]
    assert names == ["Acme Corp", "Zylo Trader"]


def test_list_vendor_master_empty(client):
    response = client.get("/api/vendor-master")
    assert response.status_code == 200
    assert response.json() == []


def test_list_vendor_master_includes_aliases(client, session):
    _seed_master(
        session,
        vendor_name="Procter & Gamble",
        normalized_name=normalize_name("Procter & Gamble"),
        aliases=["P&G", "PG"],
    )

    response = client.get("/api/vendor-master")
    record = response.json()[0]
    assert set(record["aliases"]) == {"P&G", "PG"}


def test_list_vendor_master_defaults_to_empty_aliases_list(client, session):
    _seed_master(session, vendor_name="No Alias Co", normalized_name=normalize_name("No Alias Co"))
    response = client.get("/api/vendor-master")
    assert response.json()[0]["aliases"] == []


# --- Fuzzy-match lookup (backend/internal_records.py) -----------------


def test_lookup_exact_match_consistent_address(session):
    _seed_master(
        session,
        vendor_name="Procter & Gamble",
        normalized_name=normalize_name("Procter & Gamble"),
        known_address="1 Procter and Gamble Plaza, Cincinnati, OH 45202",
        status="approved",
    )

    result = lookup_vendor_master(
        session, "Procter & Gamble", address="1 Procter and Gamble Plaza, Cincinnati, OH 45202"
    )

    assert result.found is True
    assert result.status == "approved_match"
    assert result.matched_vendor_name == "Procter & Gamble"
    assert result.address_consistent is True


def test_lookup_no_match_for_unrelated_vendor(session):
    _seed_master(
        session,
        vendor_name="Target Corporation",
        normalized_name=normalize_name("Target Corporation"),
        status="approved",
    )

    result = lookup_vendor_master(session, "Some Completely Unrelated Vendor LLC")

    assert result.found is False
    assert result.status == "no_match"
    assert result.matched_vendor_name is None


def test_lookup_no_match_on_empty_master_table(session):
    result = lookup_vendor_master(session, "Anything At All Inc")
    assert result.found is False
    assert result.status == "no_match"


def test_lookup_name_match_with_address_discrepancy(session):
    _seed_master(
        session,
        vendor_name="FedEx Corporation",
        normalized_name=normalize_name("FedEx Corporation"),
        known_address="942 South Shady Grove Road, Memphis, TN 38120",
        status="approved",
    )

    result = lookup_vendor_master(session, "FedEx Corporation", address="500 W Madison St, Chicago, IL 60661")

    assert result.found is True
    assert result.status == "approved_match_discrepancy"
    assert result.address_consistent is False


def test_lookup_blocked_vendor_returns_blocked_match(session):
    _seed_master(
        session,
        vendor_name="Blocked Co",
        normalized_name=normalize_name("Blocked Co"),
        status="blocked",
        notes="Terminated relationship 2025 -- do not process invoices.",
    )

    result = lookup_vendor_master(session, "Blocked Co")

    assert result.status == "blocked_match"
    assert result.notes == "Terminated relationship 2025 -- do not process invoices."


def test_lookup_watchlist_vendor_returns_watchlist_match(session):
    _seed_master(session, vendor_name="Watchlist Co", normalized_name=normalize_name("Watchlist Co"), status="watchlist")

    result = lookup_vendor_master(session, "Watchlist Co")

    assert result.status == "watchlist_match"


def test_lookup_matches_via_ticker_alias(session):
    """"PG" shares almost no characters with "procter gamble" -- this is
    exactly the case character-level fuzzy matching on the canonical
    name alone would miss, and the reason aliases exist at all."""
    _seed_master(
        session,
        vendor_name="Procter & Gamble",
        normalized_name=normalize_name("Procter & Gamble"),
        known_address="One Procter & Gamble Plaza, Cincinnati, OH 45202",
        status="approved",
        aliases=["P&G", "PG"],
    )

    result = lookup_vendor_master(session, "PG", address="One Procter & Gamble Plaza, Cincinnati, OH 45202")

    assert result.found is True
    assert result.status == "approved_match"
    assert result.matched_vendor_name == "Procter & Gamble"


def test_lookup_matches_via_ampersand_alias_with_discrepancy(session):
    _seed_master(
        session,
        vendor_name="FedEx Corporation",
        normalized_name=normalize_name("FedEx Corporation"),
        known_address="942 South Shady Grove Road, Memphis, TN 38120",
        status="approved",
        aliases=["FDX"],
    )

    result = lookup_vendor_master(session, "FDX", address="500 W Madison St, Chicago, IL 60661")

    assert result.found is True
    assert result.matched_vendor_name == "FedEx Corporation"
    assert result.status == "approved_match_discrepancy"


def test_lookup_without_matching_alias_falls_back_to_no_match(session):
    _seed_master(
        session,
        vendor_name="Target Corporation",
        normalized_name=normalize_name("Target Corporation"),
        aliases=["TGT"],
    )

    result = lookup_vendor_master(session, "Completely Unrelated Name Co")

    assert result.status == "no_match"


def test_lookup_missing_address_never_claims_discrepancy(session):
    """No address provided -> address_consistent is None (unknown), never
    False -- we should never claim a discrepancy we can't evidence."""
    _seed_master(
        session,
        vendor_name="Microsoft Corporation",
        normalized_name=normalize_name("Microsoft Corporation"),
        known_address="One Microsoft Way, Redmond, WA 98052",
        status="approved",
    )

    result = lookup_vendor_master(session, "Microsoft Corporation")

    assert result.status == "approved_match"
    assert result.address_consistent is None
