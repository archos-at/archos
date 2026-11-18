from __future__ import annotations

from pathlib import Path

import pytest

from agent.skills.builtin import BUILTIN_SKILLS_DIR
from agent.skills.builtin import discover_builtin_skills
from agent.skills.models import SkillValidationError

EXPECTED = {
    ("bim", "ifc-spatial-reasoning"),
    ("drawing", "excalidraw-sketch"),
    ("oib", "plot-development"),
    ("oib", "existing-building"),
    ("oib", "fire-safety"),
    ("oib", "submission-check"),
    ("oib", "building-class"),
    ("oib", "hygiene"),
    ("oib", "safety-in-use"),
    ("oib", "thermal-protection"),
    ("office", "office-files"),
    ("office", "office-word"),
    ("office", "office-excel"),
    ("office", "office-powerpoint"),
    ("office", "office-pdf-charts"),
    ("research", "data-table-analysis"),
    ("research", "forecast-analysis"),
    ("research", "lightweight-calculation"),
    ("synthesis", "long-form-report-writer"),
    ("synthesis", "prediction-report-writer"),
    ("synthesis", "inspection-report-writer"),
}


def test_builtin_dir_layout() -> None:
    assert BUILTIN_SKILLS_DIR.name == "builtin"
    assert BUILTIN_SKILLS_DIR.parent.name == "skills"
    assert (BUILTIN_SKILLS_DIR.parent.parent / "agents").is_dir()


def test_discovery_finds_every_builtin_skill() -> None:
    skills = discover_builtin_skills()
    assert {(s.collection, s.name) for s in skills} == EXPECTED
    assert len(skills) == len(EXPECTED)
    assert [s.name for s in skills if s.collection == "research"] == [
        "data-table-analysis",
        "forecast-analysis",
        "lightweight-calculation",
    ]


def test_discovery_parses_metadata_and_body() -> None:
    by_name = {s.name: s for s in discover_builtin_skills()}
    skill = by_name["long-form-report-writer"]
    assert skill.origin == "platform"
    assert skill.description
    assert skill.body.startswith("#")
    assert len(skill.body) > 0


def test_builtin_frontmatter_declares_only_its_audience() -> None:
    from agent.skills.legacy_names import LEGACY_METADATA_KEYS
    from agent.skills.legacy_names import metadata_value

    allowed = {"agents", "cards", "catalog", "auto-invoke", "title", "hidden"}
    for skill in discover_builtin_skills():
        assert set(skill.metadata) <= allowed | {LEGACY_METADATA_KEYS[key] for key in allowed}, skill.name
        assert metadata_value(skill.metadata, "agents"), skill.name

    by_name = {s.name: s for s in discover_builtin_skills()}
    assert by_name["long-form-report-writer"].metadata == {"grid-agents": "deep_researcher"}

    spatial = by_name["ifc-spatial-reasoning"]
    assert "researcher" in spatial.metadata["grid-agents"]

    for name in ("submission-check", "existing-building"):
        assert by_name[name].metadata.get("grid-catalog") == "curated", name
    for name in (
        "forecast-analysis",
        "prediction-report-writer",
        "data-table-analysis",
        "lightweight-calculation",
    ):
        assert by_name[name].metadata.get("grid-catalog") == "curated", name
    for name in ("fire-safety", "building-class", "hygiene", "long-form-report-writer"):
        assert "grid-catalog" not in by_name[name].metadata, name


def test_discovery_rejects_name_mismatch(tmp_path: Path) -> None:
    root = tmp_path / "builtin"
    skill_dir = root / "research" / "wrong-name"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        "---\nname: right-name\ndescription: okay\n---\nbody\n",
        encoding="utf-8",
    )
    with pytest.raises(SkillValidationError, match="directory name"):
        discover_builtin_skills(root)


def test_discovery_missing_dir() -> None:
    with pytest.raises(FileNotFoundError):
        discover_builtin_skills(BUILTIN_SKILLS_DIR / "nonexistent")


def test_a_renamed_builtin_still_answers_to_the_name_it_had():
    from agent.skills.legacy_names import LEGACY_SKILL_NAMES
    from agent.skills.legacy_names import canonical_skill_name

    shipped = {skill.name for skill in discover_builtin_skills()}
    for legacy, current in LEGACY_SKILL_NAMES.items():
        assert current in shipped
        assert legacy not in shipped
        assert canonical_skill_name(legacy) == current
    assert canonical_skill_name("hygiene") == "hygiene"
    assert canonical_skill_name("an-org-skill") == "an-org-skill"


def test_a_stored_house_skill_is_found_under_either_name():
    from agent.skills.legacy_names import LEGACY_PLATFORM_SKILL_NAMES
    from agent.skills.legacy_names import find_skill

    for legacy, current in LEGACY_PLATFORM_SKILL_NAMES.items():
        assert find_skill({legacy: "row"}, current) == "row"
        assert find_skill({legacy: "row"}, legacy) == "row"
        assert find_skill({current: "row"}, legacy) == "row"
    assert find_skill({"answer-cards": "row"}, "hygiene") is None
