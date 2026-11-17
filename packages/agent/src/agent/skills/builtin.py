"""Discovery of the platform's builtin (filesystem) skills.

Builtin skills are SKILL.md files shipped with the backend under
``packages/agent/src/agent/skills/builtin/<collection>/<name>/SKILL.md`` — the same
substrate layout deepagents' ``discover_skill_collections`` reads (collection =
mid-level dir, skill = leaf dir). Unlike deepagents' warn-and-continue scan,
GRID's own discovery validates STRICTLY: a malformed builtin skill is a
deployment error, never a silent skip.
"""

from __future__ import annotations

import logging
from pathlib import Path

from .models import Skill
from .models import parse_skill_md

logger = logging.getLogger(__name__)

BUILTIN_SKILLS_DIR = Path(__file__).resolve().parent / "builtin"

LEGACY_SKILL_NAMES: dict[str, str] = {
    "einreichcheck": "submission-check",
    "brandschutz": "fire-safety",
    "bestand": "existing-building",
    "nutzungssicherheit": "safety-in-use",
    "gebaeudeklasse": "building-class",
    "waermeschutz": "thermal-protection",
    "bebauung": "plot-development",
    "pruefbericht-writer": "inspection-report-writer",
}


def canonical_skill_name(name: str) -> str:
    """The current name for ``name``, following one renamed builtin; any other name as given."""
    return LEGACY_SKILL_NAMES.get(name, name)


def discover_builtin_skills(root: Path = BUILTIN_SKILLS_DIR) -> tuple[Skill, ...]:
    """Strictly parse every ``<root>/<collection>/<name>/SKILL.md`` file.

    Raises on any contract violation (missing frontmatter, name mismatch,
    oversized/empty description, reserved-metadata misuse) — the platform
    corpus is trusted and must stay valid. Returns skills in deterministic
    (collection, name) order.
    """
    skills: list[Skill] = []
    if not root.is_dir():
        raise FileNotFoundError(f"Builtin skills dir missing: {root}")
    for skill_file in sorted(root.glob("*/*/SKILL.md")):
        collection = skill_file.parent.parent.name
        name = skill_file.parent.name
        skill = parse_skill_md(
            skill_file.read_text(encoding="utf-8"),
            expected_dir_name=name,
            origin="platform",
            collection=collection,
        )
        logger.debug("Discovered builtin skill %s/%s", collection, skill.name)
        skills.append(skill)
    return tuple(skills)
