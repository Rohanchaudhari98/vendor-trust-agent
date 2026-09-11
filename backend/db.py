"""SQLite data layer via SQLModel (Pydantic + SQLAlchemy).

Three tables:
- VendorCheck: every risk check ever run, from any entry point (CLI, eval
  harness, web dashboard, copilot) -- see backend/pipeline_service.py's
  `run_and_persist()`, the single funnel all of them write through.
- VendorMaster: the client's own internal system of record -- the
  approved-vendor list. This is the internal-knowledge half of the
  analysis; Tavily provides the external half (see
  backend/internal_records.py).
- ChatMessage: copilot conversation history, keyed by session_id.

SQLite file `vendor_trust.db` lives at the project root, is gitignored,
and is created automatically (`SQLModel.metadata.create_all`) the first
time `get_session()` or `init_db()` is called -- no manual migration step
for this project's scope.
"""

from __future__ import annotations

from collections.abc import Generator
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import text
from sqlmodel import Field, Session, SQLModel, create_engine

DB_PATH = Path(__file__).parent.parent / "vendor_trust.db"
DATABASE_URL = f"sqlite:///{DB_PATH}"

# check_same_thread=False: FastAPI can serve a single request across
# multiple awaited steps; a fresh Session is still opened/closed per
# request via get_session(), so this does not introduce cross-request
# state sharing.
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class VendorCheck(SQLModel, table=True):
    """One row per risk check, regardless of which entry point triggered
    it. `signals_json` stores the full `VendorRiskReport.signals` list
    (including citations, both web and internal) as JSON -- kept
    denormalized rather than split into child tables since it is always
    read back as a whole report, never queried signal-by-signal."""

    id: int | None = Field(default=None, primary_key=True)
    vendor_name: str = Field(index=True)
    address: str | None = None
    invoice_amount: float | None = None
    risk_tier: str = Field(index=True)
    evidence_count: int = 0
    recommendation: str = ""
    signals_json: str = "[]"
    internal_match_status: str | None = Field(default=None, index=True)

    search_credits: int = 0
    extract_credits: int = 0
    llm_input_tokens: int = 0
    llm_output_tokens: int = 0
    cost_usd: float = 0.0
    latency_ms: int = 0
    langfuse_trace_id: str | None = None

    # "cli" | "web" | "copilot" | "eval" | "seed"
    source: str = Field(default="web", index=True)
    created_at: datetime = Field(default_factory=utcnow, index=True)

    # Human decision that closes the AP loop (separate from risk_tier
    # recommendation). "pending" until a clerk confirms pay or hold.
    # "paid_simulated" = confirmed for payment (no real bank transfer).
    # "held" = explicitly not paying.
    decision_status: str = Field(default="pending", index=True)
    decision_note: str | None = None
    decided_at: datetime | None = None


class VendorMaster(SQLModel, table=True):
    """The client's own internal system of record -- their approved
    vendor list. Deliberately holds only name, public HQ address, and a
    status flag -- no banking/remittance data is stored or fabricated
    anywhere in this project (see backend/internal_records.py docstring
    for why this is still enough to demonstrate the real fraud pattern)."""

    id: int | None = Field(default=None, primary_key=True)
    vendor_name: str
    normalized_name: str = Field(index=True)  # lowercased/punctuation-stripped, for fuzzy match
    known_address: str | None = None
    status: str = Field(default="approved", index=True)  # "approved" | "watchlist" | "blocked"
    notes: str | None = None
    # JSON list[str] of known aliases (DBA names, ticker symbols, common
    # abbreviations -- e.g. "P&G", "PG" for Procter & Gamble). Character-
    # level fuzzy matching against the canonical name alone misses these
    # (little-to-no letter overlap with the full legal name); matching
    # against enumerated real aliases is cheaper and more precise than
    # reaching for embeddings for this specific problem. See
    # backend/internal_records.py.
    aliases_json: str = Field(default="[]")
    created_at: datetime = Field(default_factory=utcnow)


class FindingEmbedding(SQLModel, table=True):
    """One row per `RiskSignal.finding` text, embedded for semantic
    similarity search across ALL past findings -- the one retrieval
    surface in this project where meaning-based matching (not exact
    field filtering, not character-level fuzzy matching) is actually the
    right tool: "have we seen a fraud pattern like this before,
    anywhere, regardless of vendor name or wording" is a genuine
    semantic-similarity question. See backend/embeddings.py.

    Deliberately NOT a vector DB / vector index -- at this project's
    scale (dozens-to-hundreds of findings) a linear-scan cosine
    similarity over `embedding_json` in Python is exact and fast enough;
    a dedicated vector index would be premature infrastructure for the
    row count this is built for."""

    id: int | None = Field(default=None, primary_key=True)
    check_id: int = Field(index=True)
    signal_index: int
    vendor_name: str = Field(index=True)
    category: str
    finding: str
    fraud_pattern: str = "none"
    embedding_json: str  # JSON list[float] -- 4096-dim Qwen/Qwen3-Embedding-8B vector
    created_at: datetime = Field(default_factory=utcnow, index=True)


class ChatMessage(SQLModel, table=True):
    """Copilot conversation turns, keyed by session_id so a session's
    history can be replayed in the UI or fed back as context."""

    id: int | None = Field(default=None, primary_key=True)
    session_id: str = Field(index=True)
    role: str  # "user" | "assistant"
    content: str
    citations_json: str | None = None
    created_at: datetime = Field(default_factory=utcnow, index=True)


def init_db() -> None:
    SQLModel.metadata.create_all(engine)
    _migrate_vendorcheck_decision_columns()


def _migrate_vendorcheck_decision_columns() -> None:
    """SQLite create_all does not ALTER existing tables — add decision
    columns for DBs created before the closed-loop fields existed."""
    with engine.connect() as conn:
        rows = conn.execute(text("PRAGMA table_info(vendorcheck)")).fetchall()
        existing = {row[1] for row in rows}
        alters: list[str] = []
        if "decision_status" not in existing:
            alters.append(
                "ALTER TABLE vendorcheck ADD COLUMN decision_status VARCHAR DEFAULT 'pending'"
            )
        if "decision_note" not in existing:
            alters.append("ALTER TABLE vendorcheck ADD COLUMN decision_note VARCHAR")
        if "decided_at" not in existing:
            alters.append("ALTER TABLE vendorcheck ADD COLUMN decided_at DATETIME")
        for stmt in alters:
            conn.execute(text(stmt))
        if alters:
            conn.execute(
                text(
                    "UPDATE vendorcheck SET decision_status = 'pending' "
                    "WHERE decision_status IS NULL"
                )
            )
            conn.commit()


def get_session() -> Generator[Session, None, None]:
    """FastAPI dependency: one Session per request, always closed."""
    with Session(engine) as session:
        yield session
