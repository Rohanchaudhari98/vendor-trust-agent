"""The grounded copilot -- deliberately agentic, unlike the deterministic
main pipeline (vendor_trust/agent.py). Conversational Q&A over a variable,
open-ended request ("what's our riskiest vendor this month?", "run a
check on X and tell me if it's safe to pay") is exactly the case a
tool-using loop fits, and a fixed pipeline does not -- this contrast is
intentional and documented in TECHNICAL_STATEMENT.md.

Because Nebius's `moonshotai/Kimi-K2.6` endpoint has an unreliable
native tool-calling JSON encoder (see vendor_trust/json_utils.py), the
copilot reuses the exact same manual-JSON-protocol pattern as the main
pipeline instead of LangChain's `.bind_tools()`: each turn the model
emits one JSON action object `{"action": "...", "input": {...}}`, parsed
and dispatched manually here, looped until a `final_answer` action.

Anti-hallucination / grounding: the system prompt hard-rule is "only
state facts returned by tool calls in this conversation" -- never
general world knowledge about a vendor. Every `final_answer` must carry
`citations` sourced from whatever tool results were actually used in the
conversation, tagged web (clickable URL) vs. internal (vendor-master
reference, no URL).
"""

from __future__ import annotations

import json
import logging
import os
from collections.abc import AsyncGenerator

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_nebius import ChatNebius
from sqlmodel import Session, select

from backend.copilot_fastpath import try_fast_answer
from backend.db import ChatMessage, VendorCheck, get_session
from backend.embeddings import search_findings_semantically
from backend.internal_records import lookup_vendor_master
from backend.pipeline_service import run_and_persist
from backend.schemas import ChatMessageOut, ChatRequest
from backend.serializers import chat_message_to_out, check_to_detail, check_to_summary
from vendor_trust.agent import DEFAULT_MODEL
from vendor_trust.json_utils import extract_json_object

logger = logging.getLogger(__name__)
router = APIRouter()

MAX_STEPS = 4
HISTORY_TURNS = 12

TOOLS_SCHEMA = """\
Each turn, respond with ONLY a single JSON object -- no markdown fences, no \
commentary before or after -- matching one of these shapes:

1. Call a tool:
   {"action": "<tool_name>", "input": {<tool arguments>}}

2. Give your final answer (only once you have enough grounded evidence, or \
have determined no tool can answer the question):
   {"action": "final_answer", "input": {"text": "<markdown-formatted answer>", \
"citations": [{"claim": "<specific claim this supports>", "source_type": \
"web"|"internal", "source_url": "<url, only for web>", "source_title": \
"<title>"}]}}

Available tools:
- search_past_checks: {"query": "<optional vendor-name substring>", "tier": \
"<optional: clear|low|medium|high|needs_manual_review>", "limit": <int, default 10>} \
-- EXACT/structured lookup by vendor name substring, tier, or recency. Returns \
each check's recommendation AND decision_status (pending / paid_simulated / held). \
Use this when the user names a specific vendor or tier, asks what was paid or \
held, or asks "have we checked X" / "show me high-risk checks."
- search_findings_semantically: {"query": "<a description of a fraud \
pattern, red flag, or finding -- not a vendor name>", "limit": <int, \
default 5>} -- SEMANTIC/meaning-based search across every finding text \
ever recorded, regardless of vendor name or exact wording. Use this when \
the user asks something like "have we seen a pattern like this before", \
"any past checks with guaranteed-return investment language", or \
"similar red flags to X" -- questions about MEANING, not a specific known \
vendor or tier. Do not use this to look up a specific named vendor -- use \
search_past_checks or lookup_vendor_master for that.
- get_check_detail: {"check_id": <int>} -- returns the FULL report for one \
past check, including every signal and citation (web and internal), plus \
the human decision outcome (decision_status: pending|paid_simulated|held).
- lookup_vendor_master: {"vendor_name": "<name>"} -- checks whether a vendor \
name matches an internal approved-vendor record RIGHT NOW (does not run a \
new web check), returns match status/address consistency/notes.
- run_new_vendor_check: {"vendor_name": "<name>", "address": "<optional>", \
"invoice_amount": <optional number>} -- runs a brand-new, real, live check \
(Tavily web search + internal vendor-master lookup + LLM synthesis). This \
takes 15-60 seconds and has a real API cost -- only call this when the user \
is clearly asking to check a vendor that hasn't already been checked, not \
for every message.
"""

SYSTEM_PROMPT = f"""You are the Vendor Trust Agent copilot -- a conversational \
assistant for an accounts-payable / finance team reviewing vendor risk \
before payment. You help users understand past vendor checks, look up \
internal approved-vendor records, and trigger brand-new checks, all through \
natural conversation instead of clicking through dashboard screens.

{TOOLS_SCHEMA}

HARD RULES (violating these is a critical failure):
1. You may ONLY state facts that came from a tool result IN THIS \
CONVERSATION -- never from your own general knowledge about a company, \
even if you believe you know something about it. If no tool result \
supports a claim, do not make the claim.
2. If the user asks something no available tool can answer (e.g. a \
general knowledge question unrelated to vendor risk, or something no \
past check or internal record covers), say so plainly and suggest a next \
step (e.g. "I don't have that in past checks or the internal vendor \
master -- would you like me to run a new check on this vendor?"). Never \
guess or fill the gap with outside knowledge.
3. Every `final_answer` must include `citations` for every factual claim \
you make, each tagged `source_type: "web"` (with the real `source_url` \
from a tool result) or `source_type: "internal"` (vendor-master record, \
no URL) -- copy citations from the actual tool results you received, \
never invent a URL or claim.
4. Use hedged, evidentiary language, matching the underlying reports -- \
never an unqualified "this vendor is fraudulent" or "this vendor is 100% \
safe". If a report says "needs_manual_review", reflect that nuance; don't \
round it up to "clear" or down to "high risk".
5. `run_new_vendor_check` is a real, costed, ~15-60 second operation -- \
only call it when the user is clearly asking you to check a vendor, not \
speculatively.
6. Format `final_answer.text` as clean, readable markdown (short \
paragraphs, bullet points, bold for key numbers/verdicts) -- never a wall \
of raw JSON or unformatted text. This is read directly by a business user, \
not a developer.
7. Be efficient: for simple list questions (awaiting decisions, held, \
paid, discrepancies, recent high-risk), call ONE tool then `final_answer` \
immediately. Do not chain extra tools unless the first result is empty \
or the user asked for deep evidence.
"""


def _build_llm(model: str = DEFAULT_MODEL) -> ChatNebius:
    return ChatNebius(model=model, api_key=os.environ.get("NEBIUS_API_KEY"), temperature=0)


def _sse(event_type: str, data: dict) -> str:
    return f"data: {json.dumps({'type': event_type, **data}, default=str)}\n\n"


def _status_message(action: str, tool_input: dict) -> str:
    if action == "search_past_checks":
        q = tool_input.get("query")
        return f"Searching past checks{f' for \"{q}\"' if q else ''}..."
    if action == "search_findings_semantically":
        return "Searching past findings for similar patterns..."
    if action == "get_check_detail":
        return f"Pulling up check #{tool_input.get('check_id')}..."
    if action == "lookup_vendor_master":
        return f"Looking up \"{tool_input.get('vendor_name', '')}\" in the internal vendor master..."
    if action == "run_new_vendor_check":
        vendor = tool_input.get("vendor_name", "this vendor")
        return f"Running a live check on {vendor} -- this can take up to a minute..."
    return f"Running {action}..."


async def _dispatch_tool(session: Session, action: str, tool_input: dict) -> dict:
    if action == "search_past_checks":
        statement = select(VendorCheck)
        if tool_input.get("tier"):
            statement = statement.where(VendorCheck.risk_tier == tool_input["tier"])
        if tool_input.get("query"):
            statement = statement.where(VendorCheck.vendor_name.ilike(f"%{tool_input['query']}%"))
        limit = min(int(tool_input.get("limit") or 10), 25)
        statement = statement.order_by(VendorCheck.created_at.desc()).limit(limit)
        checks = session.exec(statement).all()
        return {"results": [check_to_summary(c).model_dump(mode="json") for c in checks]}

    if action == "search_findings_semantically":
        results = await search_findings_semantically(
            session,
            tool_input.get("query", ""),
            limit=min(int(tool_input.get("limit") or 5), 25),
        )
        return {"results": results}

    if action == "get_check_detail":
        check_id = tool_input.get("check_id")
        check = session.get(VendorCheck, check_id) if check_id is not None else None
        if check is None:
            return {"error": f"No check found with id {check_id}"}
        return check_to_detail(check).model_dump(mode="json")

    if action == "lookup_vendor_master":
        result = lookup_vendor_master(session, tool_input.get("vendor_name", ""))
        return result.model_dump(mode="json")

    if action == "run_new_vendor_check":
        check = await run_and_persist(
            session,
            vendor_name=tool_input.get("vendor_name", ""),
            address=tool_input.get("address"),
            invoice_amount=tool_input.get("invoice_amount"),
            source="copilot",
        )
        return check_to_detail(check).model_dump(mode="json")

    return {"error": f"Unknown action '{action}'. Choose one of the available tools or final_answer."}


async def _run_agent_loop(
    session: Session,
    session_id: str,
    user_message: str,
    context_check_id: int | None = None,
) -> AsyncGenerator[str, None]:
    session.add(ChatMessage(session_id=session_id, role="user", content=user_message))
    session.commit()

    # Instant path for FAQ / history list questions — no Nebius round-trips.
    # (asyncio already streams the response; LLM sequential latency is the
    # real cost. Skipping the model is the meaningful speedup here.)
    if context_check_id is None:
        fast = try_fast_answer(session, user_message)
        if fast is not None:
            final_text, final_citations = fast
            yield _sse("status", {"message": "Pulling from invoice history…"})
            session.add(
                ChatMessage(
                    session_id=session_id,
                    role="assistant",
                    content=final_text,
                    citations_json=json.dumps(final_citations),
                )
            )
            session.commit()
            yield _sse(
                "answer",
                {"text": final_text, "citations": final_citations, "check_ids": []},
            )
            return

    yield _sse("status", {"message": "Working on your question…"})

    history = session.exec(
        select(ChatMessage).where(ChatMessage.session_id == session_id).order_by(ChatMessage.created_at)
    ).all()

    messages: list = [SystemMessage(content=SYSTEM_PROMPT)]
    for m in history[-HISTORY_TURNS:]:
        messages.append(HumanMessage(content=m.content) if m.role == "user" else AIMessage(content=m.content))

    llm = _build_llm()
    final_text: str | None = None
    final_citations: list[dict] = []
    # Check ids surfaced by get_check_detail/run_new_vendor_check this
    # turn -- passed back to the frontend so it can render a compact
    # ReportCard inline under the answer, not just a text citation. This
    # is ephemeral (recomputed per-turn from tool results), not
    # persisted on ChatMessage.
    referenced_check_ids: list[int] = []

    # Seed page context (e.g. user is viewing /checks/42) so deictic
    # questions like "why was this held?" don't need a name. Prefetch
    # the report as a synthetic tool result so the model can answer
    # without an extra get_check_detail round-trip.
    if context_check_id is not None:
        referenced_check_ids.append(context_check_id)
        yield _sse("status", {"message": f"Loading report #{context_check_id}…"})
        try:
            context_result = await _dispatch_tool(
                session, "get_check_detail", {"check_id": context_check_id}
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("Failed to load context check %s", context_check_id)
            context_result = {"error": str(exc)}
        messages.append(
            HumanMessage(
                content=(
                    f"PAGE CONTEXT: the user is currently viewing vendor check "
                    f"#{context_check_id}. When they say \"this\", \"this vendor\", "
                    f"\"this report\", or ask why something was flagged/held, they "
                    f"mean this check. Prefer answering from the report below; call "
                    f"get_check_detail again only if you need a fresher copy.\n\n"
                    f"TOOL RESULT for get_check_detail:\n"
                    f"{json.dumps(context_result, default=str)}"
                )
            )
        )

    for _ in range(MAX_STEPS):
        try:
            response: AIMessage = await llm.ainvoke(messages)
        except Exception as exc:  # noqa: BLE001 - surface to the client, don't crash the stream
            logger.exception("Copilot LLM call failed")
            yield _sse("error", {"message": f"Copilot LLM call failed: {exc}"})
            return

        raw = extract_json_object(str(response.content))
        try:
            action_obj = json.loads(raw)
            action = action_obj.get("action")
            tool_input = action_obj.get("input") or {}
        except (json.JSONDecodeError, AttributeError):
            messages.append(response)
            messages.append(
                HumanMessage(
                    content=(
                        'Your last response was not valid JSON matching the required '
                        '{"action": ..., "input": ...} envelope. Respond again with ONLY '
                        "the corrected JSON object -- no markdown fences, no commentary."
                    )
                )
            )
            continue

        if action == "final_answer":
            final_text = tool_input.get("text", "") or ""
            final_citations = tool_input.get("citations") or []
            break

        yield _sse("status", {"message": _status_message(action, tool_input)})

        try:
            result = await _dispatch_tool(session, action, tool_input)
        except Exception as exc:  # noqa: BLE001 - a tool failure is data for the model, not a crash
            logger.exception("Copilot tool '%s' failed", action)
            result = {"error": str(exc)}

        if action in ("get_check_detail", "run_new_vendor_check") and isinstance(result.get("id"), int):
            referenced_check_ids.append(result["id"])
        if action == "search_findings_semantically":
            for match in result.get("results") or []:
                check_id = match.get("check_id")
                if isinstance(check_id, int):
                    referenced_check_ids.append(check_id)

        messages.append(response)
        messages.append(
            HumanMessage(
                content=(
                    f"TOOL RESULT for {action}:\n{json.dumps(result, default=str)}\n\n"
                    'Continue: respond with your next {"action": ..., "input": ...} JSON '
                    "object, or a final_answer once you have enough grounded information."
                )
            )
        )

    if final_text is None:
        final_text = (
            "I wasn't able to reach a grounded answer within my tool-call budget for this "
            "turn. Could you narrow your question -- e.g. a specific vendor name or check ID?"
        )
        final_citations = []

    session.add(
        ChatMessage(
            session_id=session_id,
            role="assistant",
            content=final_text,
            citations_json=json.dumps(final_citations),
        )
    )
    session.commit()

    # de-duplicate while preserving order
    unique_check_ids = list(dict.fromkeys(referenced_check_ids))
    yield _sse("answer", {"text": final_text, "citations": final_citations, "check_ids": unique_check_ids})


@router.post("/chat")
async def chat(payload: ChatRequest, session: Session = Depends(get_session)) -> StreamingResponse:
    return StreamingResponse(
        _run_agent_loop(
            session,
            payload.session_id,
            payload.message,
            context_check_id=payload.context_check_id,
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/history", response_model=list[ChatMessageOut])
def get_history(session_id: str, session: Session = Depends(get_session)) -> list[ChatMessageOut]:
    history = session.exec(
        select(ChatMessage).where(ChatMessage.session_id == session_id).order_by(ChatMessage.created_at)
    ).all()
    return [chat_message_to_out(m) for m in history]


@router.delete("/history")
def clear_history(session_id: str, session: Session = Depends(get_session)) -> dict[str, int]:
    """Wipe persisted turns for a browser Ask AI session so a new chat can start clean."""
    messages = session.exec(select(ChatMessage).where(ChatMessage.session_id == session_id)).all()
    for message in messages:
        session.delete(message)
    session.commit()
    return {"deleted": len(messages)}
