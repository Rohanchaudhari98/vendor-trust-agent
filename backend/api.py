"""FastAPI backend for the Vendor Trust Agent web dashboard.

Serves both the REST API (checks, KPIs, observability, vendor master,
copilot) and the built React frontend (frontend/dist) from one process
on one port: `uv run uvicorn backend.api:app`.

Every check-producing route funnels through
`backend.pipeline_service.run_and_persist()` -- the same function the
CLI and eval harness use -- so the dashboard's history is always a
complete, accurate record of every check ever run, from any entry
point.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session, select

from backend.copilot import router as copilot_router
from backend.db import VendorCheck, VendorMaster, get_session, init_db
from backend.pipeline_service import run_and_persist
from backend.schemas import (
    CheckCreateRequest,
    CheckDetail,
    CheckSummary,
    KPIResponse,
    ObservabilityAggregate,
    ObservabilityResponse,
    TierBreakdown,
    VendorMasterOut,
)
from backend.serializers import (
    check_to_detail,
    check_to_observability_row,
    check_to_summary,
    vendor_master_to_out,
)
from vendor_trust.agent import DEFAULT_MODEL

load_dotenv()

app = FastAPI(title="Vendor Trust Agent API", version="0.2.0")

# Local-only app: the API and the built frontend are served from the
# same origin in the normal run path (uvicorn serving frontend/dist).
# CORS is only needed for `npm run dev`'s separate Vite dev server
# during development, so this stays scoped to localhost rather than "*".
_DEV_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_DEV_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _on_startup() -> None:
    init_db()


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


# --- Checks -----------------------------------------------------------


@app.post("/api/checks", response_model=CheckDetail)
async def create_check(
    payload: CheckCreateRequest, session: Session = Depends(get_session)
) -> CheckDetail:
    try:
        check = await run_and_persist(
            session,
            vendor_name=payload.vendor_name,
            address=payload.address,
            invoice_amount=payload.invoice_amount,
            source="web",
            model=DEFAULT_MODEL,
        )
    except Exception as exc:  # noqa: BLE001 - surface a clean 502 instead of a stack trace
        raise HTTPException(status_code=502, detail=f"Vendor check failed: {exc}") from exc
    return check_to_detail(check)


@app.get("/api/checks", response_model=list[CheckSummary])
def list_checks(
    tier: str | None = Query(default=None),
    source: str | None = Query(default=None),
    q: str | None = Query(default=None, description="Search by vendor name (case-insensitive substring)"),
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
) -> list[CheckSummary]:
    statement = select(VendorCheck)
    if tier:
        statement = statement.where(VendorCheck.risk_tier == tier)
    if source:
        statement = statement.where(VendorCheck.source == source)
    if q:
        statement = statement.where(VendorCheck.vendor_name.ilike(f"%{q}%"))
    statement = statement.order_by(VendorCheck.created_at.desc()).offset(offset).limit(limit)
    checks = session.exec(statement).all()
    return [check_to_summary(c) for c in checks]


@app.get("/api/checks/{check_id}", response_model=CheckDetail)
def get_check(check_id: int, session: Session = Depends(get_session)) -> CheckDetail:
    check = session.get(VendorCheck, check_id)
    if check is None:
        raise HTTPException(status_code=404, detail=f"Check {check_id} not found")
    return check_to_detail(check)


# --- KPIs ---------------------------------------------------------------

FLAGGED_TIERS = ("needs_manual_review", "medium", "high")
CLEARED_TIERS = ("clear", "low")
INTERNAL_FLAG_STATUSES = ("approved_match_discrepancy", "blocked_match", "watchlist_match")


@app.get("/api/kpis", response_model=KPIResponse)
def get_kpis(source: str | None = Query(default=None), session: Session = Depends(get_session)) -> KPIResponse:
    statement = select(VendorCheck)
    if source:
        statement = statement.where(VendorCheck.source == source)
    checks = session.exec(statement).all()

    total_checks = len(checks)
    dollars_flagged = sum(c.invoice_amount or 0 for c in checks if c.risk_tier in FLAGGED_TIERS)
    dollars_cleared = sum(c.invoice_amount or 0 for c in checks if c.risk_tier in CLEARED_TIERS)
    total_cost_usd = sum(c.cost_usd for c in checks)
    avg_cost_per_check = total_cost_usd / total_checks if total_checks else 0.0
    internal_discrepancy_count = sum(1 for c in checks if c.internal_match_status in INTERNAL_FLAG_STATUSES)

    tier_breakdown = TierBreakdown()
    for c in checks:
        if hasattr(tier_breakdown, c.risk_tier):
            setattr(tier_breakdown, c.risk_tier, getattr(tier_breakdown, c.risk_tier) + 1)

    return KPIResponse(
        total_checks=total_checks,
        dollars_flagged=dollars_flagged,
        dollars_cleared=dollars_cleared,
        avg_cost_per_check=avg_cost_per_check,
        total_cost_usd=total_cost_usd,
        tier_breakdown=tier_breakdown,
        internal_discrepancy_count=internal_discrepancy_count,
    )


# --- Observability --------------------------------------------------------


@app.get("/api/observability", response_model=ObservabilityResponse)
def get_observability(
    limit: int = Query(default=100, le=500), session: Session = Depends(get_session)
) -> ObservabilityResponse:
    statement = select(VendorCheck).order_by(VendorCheck.created_at.desc()).limit(limit)
    checks = session.exec(statement).all()
    rows = [check_to_observability_row(c) for c in checks]

    all_checks = session.exec(select(VendorCheck)).all()
    total_checks = len(all_checks)
    total_cost_usd = sum(c.cost_usd for c in all_checks)
    avg_latency_ms = sum(c.latency_ms for c in all_checks) / total_checks if total_checks else 0.0
    avg_cost_usd = total_cost_usd / total_checks if total_checks else 0.0

    return ObservabilityResponse(
        rows=rows,
        aggregate=ObservabilityAggregate(
            total_checks=total_checks,
            total_cost_usd=total_cost_usd,
            avg_latency_ms=avg_latency_ms,
            avg_cost_usd=avg_cost_usd,
        ),
    )


# --- Vendor Master (internal knowledge layer, read-only) -------------------


@app.get("/api/vendor-master", response_model=list[VendorMasterOut])
def list_vendor_master(session: Session = Depends(get_session)) -> list[VendorMasterOut]:
    records = session.exec(select(VendorMaster).order_by(VendorMaster.vendor_name)).all()
    return [vendor_master_to_out(r) for r in records]


# --- Copilot (backend/copilot.py owns the actual agent loop) --------------

app.include_router(copilot_router, prefix="/api/copilot", tags=["copilot"])


# --- Serve built frontend ---------------------------------------------

_FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"
if _FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(_FRONTEND_DIST), html=True), name="frontend")

    # StaticFiles(html=True) only serves index.html for "/" itself -- a
    # direct navigation or hard refresh on a client-side route (e.g.
    # /copilot, /checks/3) has no matching file on disk and 404s. This is
    # a single-page app (react-router-dom), so any 404 that isn't under
    # /api should fall back to index.html and let the client-side router
    # resolve the path, exactly like every standard SPA deployment.
    @app.exception_handler(404)
    async def spa_fallback(request: Request, exc: HTTPException) -> JSONResponse | FileResponse:
        if request.url.path.startswith("/api"):
            return JSONResponse(status_code=404, content={"detail": "Not found"})
        index_path = _FRONTEND_DIST / "index.html"
        if index_path.exists():
            return FileResponse(index_path)
        return JSONResponse(status_code=404, content={"detail": "Not found"})
