from __future__ import annotations

from pathlib import Path

from agent.common import load_prompt

PROMPTS_DIR = Path(__file__).parent / "prompts"
"""Where this agent's Jinja templates live."""

CLARIFICATION_PROMPT = load_prompt(PROMPTS_DIR, "research_clarification")
PLAN_GENERATION_PROMPT = load_prompt(PROMPTS_DIR, "plan_generation")
"""Read once, at import. A deployment that ships without a prompt file fails
here, loudly, instead of running degraded on an inline stub nobody reviews."""

JSON_REMINDER_AFTER_TOOLS = (
    "Based on the search results above, now make your clarification decision. "
    "IMPORTANT: You must respond with ONLY a valid JSON object, nothing else. "
    "Do NOT write a report, summary, or analysis. "
    "Output exactly: "
    '{"needs_clarification": true, "clarification_question": "your question", "options": []} '
    "OR "
    '{"needs_clarification": false, "clarification_question": null, "options": []}'
)
"""Reminder after tool results. Only the tool-bound binding needs it: the
tool-free one gets the schema natively (see :func:`_clarifier_llm`)."""
