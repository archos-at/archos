from __future__ import annotations

import hashlib
import json
import re

import pytest
from agent_testing.seeded_skill_rows import DRIZZLE_DIR
from agent_testing.seeded_skill_rows import EFFECTIVE_SEEDS
from agent_testing.seeded_skill_rows import REPO_ROOT
from agent_testing.seeded_skill_rows import RETIRED_NAMES
from agent_testing.seeded_skill_rows import SEEDS
from agent_testing.seeded_skill_rows import effective_row as _effective_row

from agent.cards.catalog import model_facing_card_types
from agent.cards.catalog import render_card_details
from agent.skills.models import MAX_DESCRIPTION_CHARS
from agent.skills.models import Skill
from agent.skills.models import _validate_metadata
from agent.skills.models import preferred_cards
from agent.skills.models import skill_hidden
from agent.skills.models import split_metadata_list
from agent.skills.resolver import KNOWN_AGENTS
from agent.skills.resolver import canonical_agent

SEED_IDS = [tag for tag, _ in SEEDS]
EFFECTIVE_IDS = [tag for tag, _ in EFFECTIVE_SEEDS]


def test_the_seeds_are_found_at_all():
    seeded = {row["name"] for _, row in SEEDS}
    assert seeded >= {"piloti-voice", "piloti-cards"}
    vanished = seeded - {row["name"] for _, row in EFFECTIVE_SEEDS} - RETIRED_NAMES
    assert vanished == set(), f"seed rows dropped out of EFFECTIVE_SEEDS with no retiring migration: {vanished}"


@pytest.mark.parametrize(("tag", "row"), EFFECTIVE_SEEDS, ids=EFFECTIVE_IDS)
def test_seeded_metadata_passes_strict_validation(tag: str, row: dict[str, str]):
    metadata = json.loads(row["metadata"])
    assert _validate_metadata(metadata, strict=True) == metadata


@pytest.mark.parametrize(("tag", "row"), SEEDS, ids=SEED_IDS)
def test_seeded_row_loads_as_a_skill(tag: str, row: dict[str, str]):
    skill = Skill(
        name=row["name"],
        description=row["description"],
        body=row["body"],
        metadata=json.loads(row["metadata"]),
        origin="platform",
        standard=row["delivery"] == "standard",
    )
    assert skill.body.strip(), f"{tag} seeds an empty body"
    assert 0 < len(skill.description) <= MAX_DESCRIPTION_CHARS


@pytest.mark.parametrize(("tag", "row"), EFFECTIVE_SEEDS, ids=EFFECTIVE_IDS)
def test_seeded_answer_cards_survive_the_read_path(tag: str, row: dict[str, str]):
    metadata = json.loads(row["metadata"])
    declared = split_metadata_list(metadata.get("grid-cards", ""))
    assert preferred_cards(metadata) == tuple(declared)
    assert set(declared) <= model_facing_card_types()


@pytest.mark.parametrize(("tag", "row"), SEEDS, ids=SEED_IDS)
def test_seeded_agents_are_agents_the_resolver_knows(tag: str, row: dict[str, str]):
    metadata = json.loads(row["metadata"])
    named = {canonical_agent(name) for name in split_metadata_list(metadata.get("grid-agents", ""))}
    assert named <= KNOWN_AGENTS


@pytest.mark.parametrize(("tag", "row"), SEEDS, ids=SEED_IDS)
def test_a_standard_seed_is_published_and_hidden(tag: str, row: dict[str, str]):
    if row["delivery"] != "standard":
        pytest.skip(f"{tag} is not a standard-delivery seed")
    assert row["published"].lower() == "true"
    assert skill_hidden(json.loads(row["metadata"]))


@pytest.mark.parametrize(("tag", "row"), SEEDS, ids=SEED_IDS)
def test_every_seed_has_a_matching_down_migration(tag: str, row: dict[str, str]):
    down = DRIZZLE_DIR / f"{tag}.down.sql"
    assert down.exists(), f"{tag} seeds a row with no .down.sql to remove it"
    text = down.read_text(encoding="utf-8")
    assert f"'{row['name']}'" in text
    assert "'system'" in text


def test_the_generic_card_seed_inlined_only_generic_cards():
    assert split_metadata_list(json.loads(_effective_row("piloti-cards")["metadata"])["grid-cards"]) == [
        "verdict_header",
        "condition_tree",
        "typed_table",
        "key_takeaways",
        "callout",
        "process_map",
    ]


def test_the_generic_card_seed_carries_the_craft_the_tool_no_longer_states():
    from agent.cards.register import _CARD_DOCTRINE

    body = next(row for _, row in SEEDS if row["name"] == "piloti-cards")["body"]

    assert "Anschlussfragen" in body
    assert "Kernaussagen" in body
    assert "Hinweis" in body
    assert "Urteilskarte" in body

    assert "GENERIC ones" not in _CARD_DOCTRINE
    assert "NAME something" not in _CARD_DOCTRINE


CHAT_PROMPT_FILES = (
    REPO_ROOT / "packages/agent/src/agent/agents/piloti/prompts/chat_static.md",
    REPO_ROOT / "packages/agent/src/agent/agents/piloti/prompts/piloti.j2",
)
DEEP_WRITER_PROMPT = REPO_ROOT / "packages/agent/src/agent/agents/deep_researcher/prompts/writer.j2"
DEEP_AGENT = REPO_ROOT / "packages/agent/src/agent/agents/deep_researcher/agent.py"


def _chat_prompt_text() -> str:
    return "\n".join(path.read_text(encoding="utf-8") for path in CHAT_PROMPT_FILES)


def _prompt_section(name: str) -> str:
    prompt = _chat_prompt_text()
    match = re.search(rf"<{name}>.*?</{name}>", prompt, re.DOTALL)
    assert match is not None, f"The agent's prompt no longer has a <{name}> section"
    return match.group(0)


def _agents_with_a_delivery_surface() -> set[str]:
    from agent.agents.deep_researcher.agent import SKILL_AGENT as DEEP_SKILL_AGENT

    agents = {
        agent
        for path in (REPO_ROOT / "packages" / "agent" / "src").rglob("*.py")
        for agent in re.findall(r'SkillResolver\(agent="([a-z_]+)"\)', path.read_text(encoding="utf-8"))
    }
    if "resolve_served_skills(" in DEEP_AGENT.read_text(encoding="utf-8"):
        agents.add(DEEP_SKILL_AGENT)
    return agents


def _unwrapped(text: str) -> str:
    return re.sub(r"\s+", " ", text)


def _guard_hashes(tag: str) -> list[str]:
    sql = (DRIZZLE_DIR / f"{tag}.sql").read_text(encoding="utf-8")
    return re.findall(r"md5\([^)]*\)\s*=\s*'([0-9a-f]{32})'", sql)


def test_the_prompt_carries_the_voice_craft_the_retired_seed_taught():
    section = _prompt_section("voice")
    body = _unwrapped(_effective_row("piloti-voice")["body"])
    ruling = _prompt_section("answer_envelope").split("- `ruling`")[1].split("\n- `")[0]

    assert "The first sentence is the answer" in ruling
    assert "Reservations" in ruling
    assert "never mid-paragraph" in ruling
    assert "the correction is the answer" in section
    assert "the correction follows the Richtlinie, never the person" in section
    assert "no „gute Frage“" in section
    assert "neighbouring class, older edition, other component" in section
    assert "per PART, not per answer" in section
    assert "follows the weaker part" in _prompt_section("answer_envelope")
    good = _prompt_section("good_answer")
    assert "Entwurfsverfasser" in good
    assert "Behörde" in good
    assert "Bescheid" in good
    assert "Einschätzung, nicht Empfehlung" not in _chat_prompt_text()
    assert "Decimal comma" in section and "Thousands point" in section
    assert "U+00A0" in section
    assert "EI₂ 30-C" in section
    assert "never as padding before a contradiction" in section
    formatting = _prompt_section("formatting")
    assert "The form follows the content" in formatting
    assert "Structure is not length" in formatting
    assert "never as the first line" in formatting
    assert "A long answer to a short question is no service" in _prompt_section("good_answer")
    assert "never answered instead from another Regelwerk" in section

    for rule in ("Der erste Satz ist die Antwort", "Dezimalkomma", "nie als Polster vor"):
        assert rule in body

    prompt = _chat_prompt_text()
    assert "<answer_shape>" not in prompt
    assert "writing skill active for this turn" not in prompt


def test_the_voice_seed_teaches_the_three_cases_a_shape_rule_does_not_settle():
    body = _unwrapped(_effective_row("piloti-voice")["body"])

    assert "## Wenn die Frage von einer falschen Annahme ausgeht" in body
    assert "Die Berichtigung ist die Antwort und steht im ersten Satz" in body
    assert "entlang der Richtlinie, nicht entlang der Person" in body
    assert "Die Fundstelle steht" in body
    assert 'kein „gute Frage"' in body
    assert "woher der genannte Wert stammt" in body
    assert "nie als Polster vor" in body

    assert "## Wenn nur die Hälfte beantwortbar ist" in body
    assert "gilt pro Teil, nicht pro Antwort" in body
    assert "in voller Schärfe, ohne jede Abschwächung" in body
    assert "wo er entschieden wird: in der Bautechnikverordnung des Landes" in body

    assert "## Zahlen im Satz" in body
    assert "Dezimalkomma" in body
    assert "Tausenderpunkt" in body
    assert "geschütztes Leerzeichen (U+00A0)" in body
    assert "≤ und ≥ als Zeichen" in body
    assert "EI₂ 30-C" in body

    assert "nie ersatzweise aus einem anderen Regelwerk beantwortet" in body


def test_the_notation_rule_and_the_prompt_formatting_rule_stay_on_their_own_questions():
    prompt = _chat_prompt_text()
    match = re.search(r"<formatting>.*?</formatting>", prompt, re.DOTALL)
    assert match is not None, "The agent's prompt no longer has a <formatting> section"
    formatting = match.group(0)
    body = _unwrapped(_effective_row("piloti-voice")["body"])

    assert "KaTeX" in formatting
    assert "math mode" in formatting
    assert "Dezimalkomma" not in formatting
    assert "Tausenderpunkt" not in formatting

    assert "KaTeX" not in body
    assert "$" not in body
    assert body.count("Formelsatz") == 1
    assert "eine andere Frage und anderswo geregelt" in body

    assert "1.200 m²" in formatting
    assert "1.200 m²" in body


def test_the_voice_carries_the_certainty_split_the_confidence_field_cannot():
    prompt = _chat_prompt_text()
    body = _unwrapped(_effective_row("piloti-voice")["body"])

    assert "Every researched answer carries `confidence`" in prompt
    assert "follows the weaker part" in prompt
    assert "the split exists only in the prose" in prompt

    assert "[CONFIDENCE:…]" in body
    assert "ein Wert für den ganzen Zug" in body
    assert "nur in der Prosa" in body


@pytest.mark.parametrize(("tag", "row"), SEEDS, ids=SEED_IDS)
def test_seeded_agents_all_have_a_surface_that_delivers_the_skill(tag: str, row: dict[str, str]):
    delivering = _agents_with_a_delivery_surface()
    assert delivering == KNOWN_AGENTS, "an agent the resolver knows has nowhere to deliver a skill"
    metadata = json.loads(row["metadata"])
    named = {canonical_agent(name) for name in split_metadata_list(metadata.get("grid-agents", ""))}
    assert named <= delivering


def test_the_reachable_shapes_migration_added_the_two_redirect_targets():
    row = next(row for tag, row in SEEDS if tag.startswith("0061_"))
    declared = split_metadata_list(json.loads(row["metadata"])["grid-cards"])

    assert "typed_table" in declared
    assert "process_map" in declared
    assert declared[-1] == "follow_ups"
    assert render_card_details(["typed_table", "process_map"]) == ""


def test_retiring_the_card_takes_its_craft_and_its_inlined_shape_together():
    previous = next(row for tag, row in SEEDS if tag.startswith("0061_"))
    current = _effective_row("piloti-cards")
    assert current["name"] == "piloti-cards"

    assert "## Anschlussfragen" in previous["body"]
    assert "Anschlussfragen" not in current["body"]
    assert "Anschlussfragen" not in current["description"]

    def sections(body: str) -> list[str]:
        return [line for line in body.splitlines() if line.startswith("## ")]

    kept = [s for s in sections(previous["body"]) if not s.startswith("## Anschlussfragen")]
    assert sections(current["body"]) == kept
    assert sections(current["body"])[-1] == "## Das Kartenbudget einer Antwort"

    before = split_metadata_list(json.loads(previous["metadata"])["grid-cards"])
    after = split_metadata_list(json.loads(current["metadata"])["grid-cards"])
    assert set(before) - set(after) == {"follow_ups"}
    assert after == [c for c in before if c != "follow_ups"]

    assert {k: v for k, v in json.loads(current["metadata"]).items() if k != "grid-cards"} == {
        k: v for k, v in json.loads(previous["metadata"]).items() if k != "grid-cards"
    }

    forward = (DRIZZLE_DIR / "0062_piloti_cards_retire_follow_ups.sql").read_text(encoding="utf-8")
    conflict = forward.split("ON CONFLICT")[1]
    assert '"description" = EXCLUDED."description"' in conflict
    assert '"body" = EXCLUDED."body"' in conflict
    assert '"metadata" = EXCLUDED."metadata"' in conflict
    assert '"created_by"' not in conflict
    assert _guard_hashes("0062_piloti_cards_retire_follow_ups") == [
        hashlib.md5(previous["body"].encode("utf-8")).hexdigest()
    ]


def test_the_card_skill_is_not_promised_to_a_surface_that_emits_no_cards():
    from agent.agents.deep_researcher.custom_middleware import SourceRegistryMiddleware
    from agent.agents.deep_researcher.factory import build_deep_research_tool_set

    tool_set = build_deep_research_tool_set(
        [],
        source_registry_middleware=SourceRegistryMiddleware(source_tool_names=set()),
        max_concurrent_source_tool_calls=1,
        max_source_tool_batch_size=1,
    )
    assert "emit_card" not in {tool.name for tool in tool_set.writer_tools}

    metadata = json.loads(_effective_row("piloti-cards")["metadata"])
    assert "deep_researcher" not in split_metadata_list(metadata["grid-agents"])
    voice = json.loads(_effective_row("piloti-voice")["metadata"])
    assert "deep_researcher" in split_metadata_list(voice["grid-agents"])


def test_the_deep_writer_carries_the_report_sized_voice():
    writer = DEEP_WRITER_PROMPT.read_text(encoding="utf-8")
    assert "- Open with the answer." in writer
    assert "must still leave with the right answer" in writer
    assert "Caveats come after the finding they qualify" in writer
    assert "per PART" in writer
    assert "the correction IS the lead" in writer
    assert "Assess, do not recommend" in writer
    assert "Dezimalkomma" in writer
    assert "REI 90, GK 4" in writer
    assert "must still be produced when the voice cannot be fetched" not in writer


def test_the_card_seed_names_the_failure_of_recognising_a_card_and_not_emitting_it():
    body = _unwrapped(_effective_row("piloti-cards")["body"])

    assert "## Die erkannte Karte, die nicht kommt" in body
    assert "Wenn Sie die Karte benennen können, emittieren Sie sie" in body
    assert "Der Auslöser ist bereits die Entscheidung" in body
    assert "nie, weil die Prosa schneller fertig ist" in body
    assert "billiger als die Karte, die nicht kommt" in body
    assert "Wie läuft das Baubewilligungsverfahren in Wien ab?" in body
    assert "Fertigstellungsanzeige" in body

    headings = [line for line in _effective_row("piloti-cards")["body"].splitlines() if line.startswith("## ")]
    assert headings[0] == "## Die erkannte Karte, die nicht kommt"

    assert "Anschlussfragen" not in body

    assert "## Das Kartenbudget einer Antwort" in body
    assert "es ist zum Ausgeben da" in body
    assert "keine ist richtig, wenn die Antwort ein Satz ist" in body
    assert "## Wie viele Karten zu viele sind" not in body


def test_the_card_seed_keeps_every_honesty_rule_the_rebalance_could_have_softened():
    body = _unwrapped(_effective_row("piloti-cards")["body"])

    assert "Eingangswerte, nicht das Ergebnis" in body
    assert "Fehlt ein Wert, lassen Sie ihn leer" in body
    assert "Eine geschätzte Zahl, damit die Rechnung aufgeht, ist schlechter als gar keine Karte" in body
    assert "Übernehmen Sie **Herkunft und Toleranz** genau so" in body
    assert "nur, wenn das Gespräch ihn hergibt" in body
    assert "Ohne Angabe wird nichts markiert" in body
    assert "Löschen Sie gedanklich alle Karten" in body


MAX_INLINED_SHAPE_TOKENS = 2_500


def test_widening_the_inlined_shapes_stayed_a_priced_decision():
    metadata = json.loads(_effective_row("piloti-cards")["metadata"])
    inlined = preferred_cards(metadata)

    assert "calculation" not in inlined
    assert len(inlined) < 10, "grid-cards is becoming the catalog; that is what describe_card is for"

    tiktoken = pytest.importorskip("tiktoken")
    encoding = tiktoken.get_encoding("cl100k_base")
    cost = len(encoding.encode(render_card_details(inlined)))
    assert cost <= MAX_INLINED_SHAPE_TOKENS, (
        f"the inlined card shapes cost {cost} cl100k tokens, over the {MAX_INLINED_SHAPE_TOKENS} "
        "ceiling. Every turn that delivers this standard skill pays it whether or not a card is "
        "emitted. Re-measure and decide rather than letting the list widen because nothing objected."
    )


def test_the_card_seed_carries_the_craft_for_the_three_dossier_types():
    from agent.cards.register import _CARD_DOCTRINE

    body = _unwrapped(_effective_row("piloti-cards")["body"])

    for card_type in ("document_checklist", "deadline_timeline", "change_impact"):
        assert f"-> {card_type}" not in _CARD_DOCTRINE

    assert "## Unterlagenliste: Zustände, nicht Namen" in body
    assert "Setzen Sie `status` ausschließlich dort, wo das Gespräch es hergegeben hat" in body
    assert "verfälscht daher nicht nur seine Zeile, sondern auch die Bilanz" in body
    assert "## Fristenlauf: die Reihenfolge ist die Auskunft" in body
    assert "Eine einzelne Frist ist ein Hinweis" in body
    assert "niemals als Datum" in body
    assert "lassen Sie die Frist weg, statt sie ohne Anker hinzuschreiben" in body
    assert "zeichnet die Reihenfolge, nicht die Dauer" in body
    assert "## Auswirkung einer Änderung: was ein Wechsel kostet" in body
    assert "ohne Fundstelle lassen Sie sie weg" in body
    assert 'scheuen Sie „unverändert" nicht' in body
    assert "Den Ausgangswert setzen Sie nur, wenn das Gespräch ihn hergegeben hat" in body

    for wire_name in ("`condition_tree`", "`typed_table`", "`callout`", "`document_checklist`"):
        assert wire_name not in body


def test_the_bedingungsbaum_vorfrage_sits_with_the_selection_guidance():
    raw = _effective_row("piloti-cards")["body"]
    body = _unwrapped(raw)

    assert "### Die Vorfrage zum Bedingungsbaum: kann mehr als eine Zeile gelten?" in body
    assert "**Kann mehr als eine Zeile gleichzeitig zutreffen?**" in body
    assert "Wenn ja, ist es nie ein Baum" in body
    assert "sehen aus wie eine getroffene Entscheidung, obwohl keine getroffen wurde" in body
    assert '„ich weiß es nicht" ist eine Auskunft, geraten ist keine' in body
    assert "Feuerwiderstand tragender Bauteile in GK 4" in body
    assert "gelten alle drei zugleich" in body

    headings = [line for line in raw.splitlines() if line.startswith("## ") or line.startswith("### ")]
    vorfrage = headings.index("### Die Vorfrage zum Bedingungsbaum: kann mehr als eine Zeile gelten?")
    assert headings[vorfrage - 1] == "## Bedingungsbaum, typisierte Tabelle, Vergleich"


def test_the_closing_calibration_stays_the_last_word_of_the_body():
    headings = [line for line in _effective_row("piloti-cards")["body"].splitlines() if line.startswith("## ")]
    assert headings[-1] == "## Das Kartenbudget einer Antwort"


def test_every_card_type_with_a_trigger_has_its_craft_in_the_seed():
    from agent.cards.register import _CARD_DOCTRINE

    body = [row for _, row in SEEDS if row["name"] == "piloti-cards"][-1]["body"]

    assert "calculation" in _CARD_DOCTRINE
    assert "-> process_map" not in _CARD_DOCTRINE  # deleted since (RETIRED_CARD_TYPES)

    assert "Rechenweg" in body
    assert "Eingangswerte, nicht das Ergebnis" in body
    assert "Der Faktor gehört der" in body
    assert "Verfahrensablauf" in body
    assert "nummerierte Liste" in body
    assert "nur, wenn das Gespräch ihn hergibt" in body


def test_the_card_craft_the_retired_seed_taught_lives_in_the_tool():
    from agent.cards.catalog import render_card_doctrine
    from agent.cards.register import _build_tool_description

    doctrine = " ".join(render_card_doctrine().split())
    assert "there is no result field, on purpose" in doctrine
    assert "never a second operand" in doctrine
    assert "delete the cards mentally" in _build_tool_description().lower()

    from agent.agents.piloti.prompt import bundled_static_block
    from agent.agents.piloti.prompt import render_static_block

    system = render_static_block(bundled_static_block().text)
    assert "[[card:N]]" in system
    for craft in ("does ONE row hold", "stations must CARRY", "describe_card"):
        assert craft not in _chat_prompt_text(), craft


def test_the_answer_envelope_replaces_the_envelope_cards():
    from agent.cards.catalog import RETIRED_CARD_TYPES
    from agent.cards.catalog import model_facing_card_types
    from agent.cards.catalog import render_card_catalog
    from agent.cards.catalog import retired_refusal

    section = _prompt_section("answer_envelope")
    assert "`verdict`" in section and "60 characters" in section
    assert "`takeaways`" in section and "2 to 5" in section
    assert "`callout`" in section and "at most one" in section
    assert "masthead" in section
    assert "[[callout]]" in section
    assert "invented value here is worse than none" in section
    assert "{{ answer_envelope_schema }}" in section
    assert "`confidence`" in section
    assert "`escalate_to_deep`" in section

    envelope_twins = {"summary", "verdict_header", "key_takeaways", "callout"}
    assert envelope_twins <= RETIRED_CARD_TYPES
    assert model_facing_card_types().isdisjoint(RETIRED_CARD_TYPES)
    catalog = render_card_catalog()
    for card_type in ("verdict_header", "key_takeaways", "callout"):
        assert f'"{card_type}"' not in catalog
    for card_type in envelope_twins:
        assert "answer_json" in retired_refusal(card_type)
        assert "no longer exists" in retired_refusal(card_type)
