from __future__ import annotations

from typing import TYPE_CHECKING

from agent.common.turn_status import CHANNEL_LIVE
from agent.common.turn_status import CHANNEL_TECHNICAL
from agent.common.turn_status import emit_step
from agent.common.wire_v2 import SkillStep

from .models import Skill
from .models import skill_hidden
from .models import skill_title

if TYPE_CHECKING:  # pragma: no cover - typing only
    from .runtime import SkillRuntime

SELECTION_STEP_ID = "skill_selection"

SKILL_STEP_PREFIX = "skill:"

KEY_SKILL_ACTIVATED = "skill.activated"

ALL_SKILL_KEYS: tuple[str, ...] = ("skill.activated",)


def emit_skills_offered(runtime: SkillRuntime) -> None:
    count = len(tuple(runtime.skills))
    if count:
        emit_step(SkillStep(id=SELECTION_STEP_ID, phase="offered", count=count, channel=CHANNEL_TECHNICAL))


def emit_skill_activated(skill: Skill) -> None:
    title = skill_title(skill)
    hidden = skill_hidden(skill.metadata)
    live = bool(title) and not hidden
    emit_step(
        SkillStep(
            id=f"{SKILL_STEP_PREFIX}{skill.name}",
            phase="activated",
            skill=skill.name,
            title=title,
            hidden=hidden,
            channel=CHANNEL_LIVE if live else CHANNEL_TECHNICAL,
        )
    )
