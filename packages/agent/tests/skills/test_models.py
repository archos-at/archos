from __future__ import annotations

import pytest

from agent.skills.legacy_names import LEGACY_METADATA_KEYS
from agent.skills.models import MAX_DESCRIPTION_CHARS
from agent.skills.models import MAX_TITLE_CHARS
from agent.skills.models import SKILL_METADATA_KEYS
from agent.skills.models import SkillValidationError
from agent.skills.models import build_skill_from_payload
from agent.skills.models import parse_skill_md
from agent.skills.models import preferred_cards
from agent.skills.models import skill_hidden
from agent.skills.models import skill_title

VALID_MD = """---
name: forecast-analysis
description: >-
  Prognose der baurechtlichen Entwicklung: Trendlinien, Sensitivität und
  Risikohinweise aus den angegebenen Bau- und Genehmigungsdaten.
license: Proprietary
compatibility: R1 line and B2 zone
metadata:
  grid-agents: researcher
---

# Prognose

Schritte:
1. Prüfe die Datenlage.
2. Berechne die Trendlinie.
3. Nenne die Risiken.
"""


def test_parse_valid_skill_md() -> None:
    skill = parse_skill_md(VALID_MD, expected_dir_name="forecast-analysis")
    assert skill.name == "forecast-analysis"
    assert skill.description.startswith("Prognose der baurechtlichen Entwicklung")
    assert len(skill.description) > 10
    assert skill.origin == "platform"
    assert skill.collection is None
    assert skill.metadata == {"grid-agents": "researcher"}
    assert skill.compatibility == "R1 line and B2 zone"
    assert skill.license == "Proprietary"
    assert skill.body.startswith("# Prognose")
    assert "3. Nenne die Risiken." in skill.body


def test_parse_folded_yaml_description_is_joined() -> None:
    skill = parse_skill_md(VALID_MD)
    assert "\n" not in skill.description
    assert "Trendlinien, Sensitivität" in skill.description


def test_missing_frontmatter_is_a_strict_error() -> None:
    with pytest.raises(SkillValidationError, match="frontmatter"):
        parse_skill_md("# Nur Inhalt\n\nohne Metadaten")


def test_invalid_yaml_is_a_strict_error() -> None:
    with pytest.raises(SkillValidationError, match="YAML"):
        parse_skill_md("---\nname: [unclosed\n---\nbody")


def test_name_must_match_directory() -> None:
    with pytest.raises(SkillValidationError, match="directory name"):
        parse_skill_md(VALID_MD, expected_dir_name="other-name")


def test_name_pattern_is_enforced() -> None:
    for bad in ("UPPER", "with_underscore", "leading-", "-trailing", "double--dash", ""):
        with pytest.raises(SkillValidationError):
            parse_skill_md(VALID_MD.replace("forecast-analysis", bad))


def test_name_length_limit() -> None:
    long_name = "a" * (64 + 1)
    with pytest.raises(SkillValidationError, match="characters"):
        parse_skill_md(VALID_MD.replace("forecast-analysis", long_name))


def test_empty_description_is_a_strict_error() -> None:
    no_desc = VALID_MD.replace(
        ">-\n  Prognose der baurechtlichen Entwicklung: Trendlinien, Sensitivität und\n  "
        "Risikohinweise aus den angegebenen Bau- und Genehmigungsdaten.",
        "",
    )
    assert "description:" in no_desc
    with pytest.raises(SkillValidationError, match="description"):
        parse_skill_md(no_desc)


def test_description_length_limit() -> None:
    long_desc = "x" * (MAX_DESCRIPTION_CHARS + 1)
    with pytest.raises(SkillValidationError, match="description"):
        parse_skill_md(
            VALID_MD.replace(
                "Prognose der baurechtlichen Entwicklung: Trendlinien, Sensitivität und\n  "
                "Risikohinweise aus den angegebenen Bau- und Genehmigungsdaten.",
                long_desc,
            )
        )


def test_legacy_execution_is_ignored_not_rejected() -> None:
    for value in ("chat", "deep-research", "browser", "gibt-es-nicht"):
        md = VALID_MD.replace(
            "  grid-agents: researcher",
            f"  grid-agents: researcher\n  grid-execution: {value}",
        )
        skill = parse_skill_md(md)
        assert skill.metadata == {"grid-agents": "researcher", "grid-execution": value}


def test_legacy_schedulable_is_ignored_not_rejected() -> None:
    skill = build_skill_from_payload(
        {
            "name": "org-skill",
            "description": "Ein Org-Skill.",
            "body": "Body",
            "metadata": {"grid-schedulable": "false", "grid-agents": "deep_researcher"},
        },
        origin="org",
    )
    assert skill.metadata == {"grid-schedulable": "false", "grid-agents": "deep_researcher"}


def test_metadata_must_map_strings_to_strings() -> None:
    with pytest.raises(SkillValidationError, match="metadata"):
        parse_skill_md(
            VALID_MD.replace(
                "  grid-agents: researcher",
                "  grid-agents:\n    nested: yes",
            )
        )


def test_compatibility_too_long_is_rejected() -> None:
    with pytest.raises(SkillValidationError, match="compatibility"):
        parse_skill_md(VALID_MD.replace("R1 line and B2 zone", "x" * 501))


def test_empty_body_is_allowed() -> None:
    head = VALID_MD.split("\n---", 2)[0] + "\n---\n"
    skill = parse_skill_md(head)
    assert skill.body == ""


def test_build_skill_from_payload_roundtrip() -> None:
    skill = build_skill_from_payload(
        {
            "name": "org-skill",
            "description": "Ein Org-Skill.",
            "body": "Body",
            "metadata": {"grid-agents": "researcher"},
            "license": "MIT",
        },
        origin="org",
        collection=None,
    )
    assert skill.origin == "org"
    assert skill.metadata == {"grid-agents": "researcher"}


def test_build_skill_from_payload_rejects_garbage() -> None:
    with pytest.raises(SkillValidationError):
        build_skill_from_payload({"name": 7})
    with pytest.raises(SkillValidationError):
        build_skill_from_payload({"name": "ok", "description": ""})


def test_reserved_key_registry() -> None:
    new_names = {"agents", "cards", "title", "hidden", "auto-invoke", "catalog"}
    assert SKILL_METADATA_KEYS == new_names | {LEGACY_METADATA_KEYS[name] for name in new_names}
    assert LEGACY_METADATA_KEYS["execution"] not in SKILL_METADATA_KEYS
    assert LEGACY_METADATA_KEYS["schedulable"] not in SKILL_METADATA_KEYS


def test_a_skill_with_only_the_new_keys_reads_the_same_as_one_with_only_the_old() -> None:
    new_keys = {
        "agents": "deep_researcher",
        "catalog": "curated",
        "hidden": "true",
        "cards": "calculation",
        "title": "Skizze",
    }
    old_keys = {LEGACY_METADATA_KEYS[key]: value for key, value in new_keys.items()}
    new_skill = build_skill_from_payload({"name": "x", "description": "d", "body": "b", "metadata": new_keys})
    old_skill = build_skill_from_payload({"name": "x", "description": "d", "body": "b", "metadata": old_keys})
    assert preferred_cards(new_skill.metadata) == preferred_cards(old_skill.metadata) == ("calculation",)
    assert skill_hidden(new_skill.metadata) is True
    assert skill_hidden(old_skill.metadata) is True
    assert skill_title(new_skill) == skill_title(old_skill) == "Skizze"


def test_the_new_key_wins_when_both_spellings_are_present() -> None:
    old = LEGACY_METADATA_KEYS["hidden"]
    assert skill_hidden({"hidden": "false", old: "true"}) is False
    assert skill_hidden({"hidden": "true", old: "false"}) is True


def test_a_new_key_is_validated_under_its_own_name() -> None:
    with pytest.raises(SkillValidationError, match="cards"):
        build_skill_from_payload(
            {"name": "x", "description": "d", "body": "b", "metadata": {"cards": "gibt_es_nicht"}},
            origin="platform",
        )


def _with_title(value: str) -> str:
    return VALID_MD.replace("  grid-agents: researcher", f"  grid-title: {value}")


def test_title_is_the_human_name() -> None:
    skill = parse_skill_md(_with_title("Prognose Baurecht"))
    assert skill_title(skill) == "Prognose Baurecht"


def test_absent_title_is_absent_and_never_synthesised_from_the_id() -> None:
    skill = parse_skill_md(VALID_MD)
    assert skill_title(skill) is None


def test_over_long_title_is_a_strict_error_for_a_file_skill() -> None:
    with pytest.raises(SkillValidationError, match="grid-title"):
        parse_skill_md(_with_title("A" * (MAX_TITLE_CHARS + 1)))


def test_title_with_a_tag_is_a_strict_error() -> None:
    with pytest.raises(SkillValidationError, match="grid-title"):
        parse_skill_md(_with_title('"Prognose <b>Baurecht</b>"'))


def test_org_row_drops_a_bad_title_instead_of_dying() -> None:
    skill = build_skill_from_payload(
        {
            "name": "org-skill",
            "description": "Ein Org-Skill.",
            "body": "Body",
            "metadata": {"grid-title": "B" * (MAX_TITLE_CHARS + 1), "grid-agents": "researcher"},
        },
        origin="org",
    )
    assert "grid-title" not in skill.metadata
    assert skill.metadata["grid-agents"] == "researcher"
    assert skill_title(skill) is None


def test_org_row_keeps_a_good_title() -> None:
    skill = build_skill_from_payload(
        {
            "name": "org-skill",
            "description": "Ein Org-Skill.",
            "body": "Body",
            "metadata": {"grid-title": "  Brandschutznachweis  "},
        },
        origin="org",
    )
    assert skill_title(skill) == "Brandschutznachweis"


def _with_hidden(value: str) -> str:
    return VALID_MD.replace("  grid-agents: researcher", f'  grid-hidden: "{value}"')


def test_unquoted_yaml_bool_metadata_is_coerced_to_a_string() -> None:
    hidden = VALID_MD.replace("  grid-agents: researcher", "  grid-hidden: true")
    assert skill_hidden(parse_skill_md(hidden).metadata) is True
    assert parse_skill_md(hidden).metadata["grid-hidden"] == "true"

    off = VALID_MD.replace("  grid-agents: researcher", "  grid-auto-invoke: false")
    assert parse_skill_md(off).metadata["grid-auto-invoke"] == "false"


def test_hidden_truthy_tokens_mark_a_skill_hidden() -> None:
    for token in ("true", "1", "yes", "TRUE", "  Yes  "):
        skill = parse_skill_md(_with_hidden(token))
        assert skill_hidden(skill.metadata) is True, token
        assert skill.metadata["grid-hidden"] == "true"


def test_hidden_falsy_tokens_drop_the_key_and_read_visible() -> None:
    for token in ("false", "0", "no", ""):
        skill = parse_skill_md(_with_hidden(token))
        assert "grid-hidden" not in skill.metadata, token
        assert skill_hidden(skill.metadata) is False, token


def test_absent_hidden_reads_visible() -> None:
    skill = parse_skill_md(VALID_MD)
    assert skill_hidden(skill.metadata) is False


def test_garbage_hidden_is_a_strict_error_for_a_file_skill() -> None:
    with pytest.raises(SkillValidationError, match="grid-hidden"):
        parse_skill_md(_with_hidden("maybe"))


def test_org_row_drops_a_bad_hidden_flag_instead_of_dying() -> None:
    skill = build_skill_from_payload(
        {
            "name": "org-skill",
            "description": "Ein Org-Skill.",
            "body": "Body",
            "metadata": {"grid-hidden": "sometimes", "grid-agents": "researcher"},
        },
        origin="org",
    )
    assert "grid-hidden" not in skill.metadata
    assert skill.metadata["grid-agents"] == "researcher"
    assert skill_hidden(skill.metadata) is False


def test_org_row_keeps_a_truthy_hidden_flag() -> None:
    skill = build_skill_from_payload(
        {
            "name": "org-skill",
            "description": "Ein Org-Skill.",
            "body": "Body",
            "metadata": {"grid-hidden": "yes"},
        },
        origin="org",
    )
    assert skill_hidden(skill.metadata) is True


def _with_auto_invoke(value: str) -> str:
    return VALID_MD.replace("  grid-agents: researcher", f'  grid-auto-invoke: "{value}"')


def test_auto_invoke_falsy_tokens_are_kept_verbatim_and_read_by_nobody() -> None:
    for token in ("false", "0", "no", "FALSE", "  No  "):
        skill = parse_skill_md(_with_auto_invoke(token))
        assert skill.metadata["grid-auto-invoke"] == "false"


def test_auto_invoke_truthy_tokens_drop_the_key() -> None:
    for token in ("true", "1", "yes", ""):
        skill = parse_skill_md(_with_auto_invoke(token))
        assert "grid-auto-invoke" not in skill.metadata, token


def test_garbage_legacy_auto_invoke_is_a_strict_error_for_a_file_skill() -> None:
    with pytest.raises(SkillValidationError, match="grid-auto-invoke"):
        parse_skill_md(_with_auto_invoke("maybe"))


def test_org_row_drops_a_bad_auto_invoke_flag_instead_of_dying() -> None:
    skill = build_skill_from_payload(
        {
            "name": "org-skill",
            "description": "Ein Org-Skill.",
            "body": "Body",
            "metadata": {"grid-auto-invoke": "sometimes", "grid-agents": "researcher"},
        },
        origin="org",
    )
    assert "grid-auto-invoke" not in skill.metadata
    assert skill.metadata["grid-agents"] == "researcher"


def test_org_row_keeps_a_falsy_auto_invoke_flag() -> None:
    skill = build_skill_from_payload(
        {
            "name": "org-skill",
            "description": "Ein Org-Skill.",
            "body": "Body",
            "metadata": {"grid-auto-invoke": "no"},
        },
        origin="org",
    )
    assert skill.metadata["grid-auto-invoke"] == "false"


def _with_cards(value: str) -> str:
    return VALID_MD.replace("  grid-agents: researcher", f"  grid-cards: {value}")


def test_answer_cards_accepts_known_card_types() -> None:
    skill = parse_skill_md(_with_cards("calculation, stair_diagram"))
    assert preferred_cards(skill.metadata) == ("calculation", "stair_diagram")


def test_answer_cards_deduplicates_and_keeps_author_order() -> None:
    skill = parse_skill_md(_with_cards("stair_diagram,calculation,stair_diagram"))
    assert preferred_cards(skill.metadata) == ("stair_diagram", "calculation")


def test_unknown_card_type_is_a_strict_error_for_a_file_skill() -> None:
    with pytest.raises(SkillValidationError, match="grid-cards"):
        parse_skill_md(_with_cards("calculation, gibt_es_nicht"))


def test_a_retired_card_type_is_a_strict_error_for_a_file_skill() -> None:
    with pytest.raises(SkillValidationError, match="grid-cards"):
        parse_skill_md(_with_cards("calculation, legal_basis"))


def test_system_card_type_is_rejected_even_though_it_is_a_real_card() -> None:
    for system_card in ("memory_proposal", "document_grid"):
        with pytest.raises(SkillValidationError, match="grid-cards"):
            parse_skill_md(_with_cards(system_card))


def test_org_row_drops_unknown_card_types_instead_of_dying() -> None:
    skill = build_skill_from_payload(
        {
            "name": "org-skill",
            "description": "Ein Org-Skill.",
            "body": "Body",
            "metadata": {"grid-cards": "calculation, memory_proposal, gibt_es_nicht, legal_basis"},
        },
        origin="org",
    )
    assert skill.metadata["grid-cards"] == "calculation"


def test_org_row_with_only_unknown_card_types_drops_the_key() -> None:
    skill = build_skill_from_payload(
        {
            "name": "org-skill",
            "description": "Ein Org-Skill.",
            "body": "Body",
            "metadata": {"grid-cards": "gibt_es_nicht"},
        },
        origin="org",
    )
    assert "grid-cards" not in skill.metadata
