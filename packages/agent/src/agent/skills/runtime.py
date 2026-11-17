from __future__ import annotations

import html
import logging
from collections.abc import Mapping
from collections.abc import Sequence
from typing import Any

from deepagents.backends import CompositeBackend
from deepagents.middleware.skills import SkillsMiddleware
from langchain.agents.middleware.types import ModelRequest

from .backend import OFFICE_SOURCE
from .backend import SKILLS_ROOT
from .backend import SkillsBackend
from .backend import skill_path
from .legacy_names import canonical_skill_name
from .legacy_names import find_skill
from .models import Skill
from .models import preferred_cards
from .models import skill_hidden

logger = logging.getLogger(__name__)

SKILLS_PROMPT = (
    "## Skills\n"
    "Working methods you may follow, one line each. A skill is an offer: you decide whether the task is its subject.\n"
    "{skills_locations}{skills_load_warnings}\n\n"
    "{skills_list}\n\n"
    "To follow a skill, read its whole `SKILL.md` first with `read_file` at the path shown, passing `limit=1000`, "
    "then follow it. A skill that says to load another is asking you to read that one too."
)

_PINNED_HEADING = "### Given in full for this question"
_PINNED_DOCTRINE = (
    "This method is probably what the question is about, so it is here already: do not read it again. "
    "If your answer follows it, name it in the `skills_applied` field of your answer envelope; "
    "that is how the reader learns which method shaped the answer."
)
_CARDS_LINE = "Preferred cards: {types} — the author's preference, not a requirement."
_CARDS_HEADING = "## Preferred cards"
_CARDS_DOCTRINE = (
    "Where the content supports it, present the result as one of these cards: {types}. "
    "This is the skill author's preference, not a requirement — if none of them fits the "
    "result, pick the card that does or answer in prose. Never invent content just to fill "
    "one of these cards. Their exact shapes follow, so you can emit them without looking them up."
)


def skills_middleware(backend: Any, sources: Sequence[str]) -> SkillsMiddleware:
    return SkillsMiddleware(backend=backend, sources=list(sources), system_prompt=SKILLS_PROMPT)


def source_path(source: str) -> str:
    return f"{SKILLS_ROOT}{source}/"


def preferred_cards_block(skill: Skill) -> str | None:
    cards = preferred_cards(skill.metadata)
    if not cards:
        return None
    types = ", ".join(f"`{card}`" for card in cards)
    block = f"{_CARDS_HEADING}\n{_CARDS_DOCTRINE.format(types=types)}"
    from agent.cards.catalog import render_card_details

    details = render_card_details(cards)
    return f"{block}\n\n{details}" if details else block


class SkillRuntime:
    def __init__(self, sources: Mapping[str, Sequence[Skill]] | None = None) -> None:
        self._sources = {name: tuple(skills) for name, skills in (sources or {}).items() if skills}
        self._by_name: dict[str, Skill] = {}
        self._path: dict[str, str] = {}
        for source, skills in self._sources.items():
            for skill in skills:
                self._by_name[skill.name] = skill
                self._path[skill.name] = f"{SKILLS_ROOT.rstrip('/')}{skill_path(source, skill.name)}"
        self._activated: list[str] = []
        self._pinned: list[str] = []
        self.backend = SkillsBackend(self._sources, on_read=self._record_activation, read_suffix=preferred_cards_block)

    @classmethod
    def office(cls, skills: Sequence[Skill]) -> SkillRuntime:
        return cls({OFFICE_SOURCE: skills})

    @property
    def skills(self) -> tuple[Skill, ...]:
        return tuple(self._by_name.values())

    @property
    def sources(self) -> tuple[str, ...]:
        return tuple(self._sources)

    def mounted(self) -> CompositeBackend:
        return CompositeBackend(default=self.backend, routes={SKILLS_ROOT: self.backend})

    def catalog_block(self) -> str | None:
        if not self._sources:
            return None
        middleware = skills_middleware(self.mounted(), [source_path(s) for s in self._sources])
        loaded = middleware.before_agent({}, None, None) or {}  # ty: ignore[invalid-argument-type]
        request = ModelRequest(model=None, messages=[], state=dict(loaded))  # ty: ignore[invalid-argument-type]
        message = middleware.modify_request(request).system_message
        return message.text if message is not None else None

    def pin(self, name: str) -> bool:
        skill = find_skill(self._by_name, name)
        if skill is None or skill.name in self._pinned:
            return False
        self._pinned.append(skill.name)
        return True

    @property
    def pinned(self) -> tuple[str, ...]:
        return tuple(self._pinned)

    def pinned_block(self) -> str | None:
        if not self._pinned:
            return None
        parts = [f"{_PINNED_HEADING}\n{_PINNED_DOCTRINE}"]
        for name in self._pinned:
            skill = self._by_name[name]
            body = skill.body.strip()
            cards = preferred_cards(skill.metadata)
            if cards:
                body = f"{body}\n\n{_CARDS_LINE.format(types=', '.join(f'`{c}`' for c in cards))}"
            attrs = f'name="{html.escape(name, quote=True)}" path="{html.escape(self._path[name], quote=True)}"'
            parts.append(f"<skill {attrs}>\n{body}\n</skill>")
        return "\n\n".join(parts)

    def prompt_block(self) -> str | None:
        blocks = [block for block in (self.catalog_block(), self.pinned_block()) if block]
        return "\n\n".join(blocks) or None

    @property
    def activated(self) -> tuple[str, ...]:
        return tuple(self._activated)

    @property
    def hidden_activated(self) -> tuple[str, ...]:
        return tuple(name for name in self._activated if skill_hidden(self._by_name[name].metadata))

    def _record_activation(self, skill: Skill) -> None:
        if skill.name in self._activated:
            return
        self._activated.append(skill.name)
        from .events import emit_skill_activated

        emit_skill_activated(skill)

    def record_applied(self, names: Sequence[str]) -> tuple[str, ...]:
        accepted: list[str] = []
        for raw in names:
            asked = canonical_skill_name(str(raw).strip().strip("`"))
            name = next((pinned for pinned in self._pinned if canonical_skill_name(pinned) == asked), None)
            if name is None:
                logger.debug("skills_applied names %r, which was not pinned this run; ignored", asked)
                continue
            if name in self._activated:
                continue
            self._record_activation(self._by_name[name])
            accepted.append(name)
        return tuple(accepted)
