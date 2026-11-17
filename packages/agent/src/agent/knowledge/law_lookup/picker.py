"""The provision picker: headings in, ranked provision ids out. Never a body.

The one LLM call a lookup makes when nobody named a provision, and the reason
it is cheap: its input is the law's table of contents, so it is bounded by how
many provisions the law has rather than by how long they are. It returns IDS,
never prose: the passages the answering model reads are cut out of the law by
``sections``, so no summary of the law can stand in for the law.
"""

from __future__ import annotations

from pydantic import BaseModel
from pydantic import Field

from agent.knowledge.law_lookup.planner import invoke_structured
from agent.knowledge.law_lookup.source import LawSource


class PassagePick(BaseModel):
    """One provision the picker believes answers the question."""

    section: str = Field(description="The provision id exactly as listed")
    reason: str = Field(default="", description="One short sentence: why this provision")


class PassagePlan(BaseModel):
    """Ranked provision ids for one document. Strict structured output, like the search plan."""

    picks: list[PassagePick] = Field(default_factory=list, description="Up to six provisions, best first")


def picker_prompt(law: LawSource) -> str:
    """The picker's system prompt, its examples in the source's own signs."""
    examples = ", ".join(f"{unit.sign} 5" for unit in law.lookup.locus.units)
    return f"""You pick the provisions of a law that answer a question.

You receive the question and the law's TABLE OF CONTENTS — one line per \
provision: its id ({examples}) and its heading. You never see the text.

Rules:
- Return at most six provision ids, best first, and only ids that appear in the list.
- Copy an id EXACTLY as listed. Do not invent, merge or renumber.
- Prefer the provision that states the obligation over the one that defines a term, \
unless the question asks for the definition.
- Return an empty list when no heading plausibly answers the question. An empty list \
is a real answer; a wrong provision is not."""


def make_picker(llm, law: LawSource):
    """Wrap a chat model into the provision picker, with one bounded corrective retry."""
    system = picker_prompt(law)

    async def _pick_sections(question: str, index: str) -> PassagePlan:
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": f"Question: {question}\n\nParagraphs available:\n{index}"},
        ]
        return await invoke_structured(llm, PassagePlan, messages, "picker")

    return _pick_sections
