"""Shared JSON-extraction helper for Nebius's `moonshotai/Kimi-K2.6`
endpoint, which has an unreliable native tool-calling / function-call
JSON encoder (observed emitting a `<|tool_calls_section_begin|>` marker
with broken escaping instead of clean JSON). Both the main pipeline
(vendor_trust/agent.py, one structured synthesis call) and the copilot
(backend/copilot.py, a multi-turn manual JSON-action tool loop) ask the
model for plain JSON in the message body and parse it with this same
extractor, rather than relying on `with_structured_output`'s
function-calling or `bind_tools()` paths.
"""

from __future__ import annotations


def extract_json_object(text: str) -> str:
    """Pull the first balanced {...} object out of a raw LLM response.

    Defensive layer in case the model wraps the JSON in markdown fences
    or adds stray commentary before/after it.
    """
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]
    start = text.find("{")
    if start == -1:
        return text
    depth = 0
    for i, ch in enumerate(text[start:], start=start):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return text[start:]
