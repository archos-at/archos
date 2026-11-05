"""Tests for the release-note pipeline (`scripts/release_notes.py` and its `release_notes_*` modules).

The pipeline publishes text straight to a public marketing page, so the parts
worth pinning are the ones whose failure a reviewer cannot see in a diff: the
lint that decides what may be published, the grouping that decides where a note
appears, the translation cache that decides what a German reader gets, and the
drift between reno's section list and the German titles for it.

The git-scanning half (`load_notes_from_reno`) is deliberately not exercised
here: it is reno's, it needs a repository with history, and everything after it
works on the plain structures these tests build directly.
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]


def _load(name: str, relative: str):
    """Import a top-level script by path."""
    if str(REPO_ROOT) not in sys.path:
        sys.path.insert(0, str(REPO_ROOT))
    spec = importlib.util.spec_from_file_location(name, REPO_ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


rn = _load("scripts.release_notes", "scripts/release_notes.py")
# Loading the command line put scripts/ on sys.path; its parts are modules of their own.
import release_notes_areas as areas  # noqa: E402
import release_notes_build as build  # noqa: E402
import release_notes_rules as rules  # noqa: E402
import release_notes_translate as tr  # noqa: E402

require_note = _load("ci.require_release_note", "ci/require_release_note.py")

CONFIG_PATH = REPO_ROOT / "releasenotes" / "config.yaml"
SECTIONS = build.read_config_sections(CONFIG_PATH)
SECTION_KEYS = {key for key, _ in SECTIONS}

GOOD = "Projects can now be renamed from the settings page, without contacting support."


def lint_entry(text: str) -> list[str]:
    return rules.lint_note("note.yaml", yaml.safe_dump({"features": [text]}), SECTION_KEYS)


# ── the published-prose rules ───────────────────────────────────────────────


def test_a_plain_sentence_passes():
    assert lint_entry(GOOD) == []


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("The `re-index` button now works as documented for everyone.", "backtick"),
        (".. note:: the re-index button now works as documented for everyone.", "directive"),
        ("Re-indexing works again, see #1423 for the details of the fix.", "issue or PR number"),
        ("Re-indexing works again after the fix in ingest_oib.py landed here.", "file name"),
        ("Re-indexing works again after the change to packages/agent/src/agent landed here.", "repository path"),
        ("Re-indexing works again as of commit 4f2a91c in the ingest path.", "commit sha"),
        ("Re-indexing is fixed, details at https://github.com/GRID-check/grid-oib-agent.", "link"),
    ],
)
def test_internal_and_markup_references_are_rejected(text, expected):
    problems = lint_entry(text)
    assert problems, f"expected {expected!r} to be rejected"
    assert any(expected in problem for problem in problems)


def test_a_product_link_is_allowed():
    assert lint_entry("The full changelog now lives at https://piloti.at/changelog for everyone.") == []
    assert lint_entry(f"The full changelog now lives at https://{rules.SITE_DOMAIN}/changelog for everyone.") == []


def test_a_stub_is_rejected():
    assert any("too short" in problem for problem in lint_entry("Fixed a bug."))


def test_an_essay_is_rejected():
    assert any("too long" in problem for problem in lint_entry("Word word. " * 60))


def test_a_fragment_is_rejected():
    assert any("full sentence" in problem for problem in lint_entry("Re-indexing from the settings page"))


def test_untouched_template_text_is_rejected():
    problems = lint_entry("Say what is new, from the reader's side, in a sentence.")
    assert any("template" in problem for problem in problems)


def test_the_shipped_template_fails_its_own_lint():
    """`reno new` output is a stub, and a stub must never reach the website."""
    config = yaml.safe_load(CONFIG_PATH.read_text(encoding="utf-8"))
    assert rules.lint_note("new.yaml", config["template"], SECTION_KEYS)


# ── the structural rules ────────────────────────────────────────────────────


def test_an_unknown_section_is_rejected():
    problems = rules.lint_note("note.yaml", yaml.safe_dump({"awesome": [GOOD]}), SECTION_KEYS)
    assert any("unknown section" in problem for problem in problems)


def test_an_empty_section_is_rejected():
    problems = rules.lint_note("note.yaml", yaml.safe_dump({"features": []}), SECTION_KEYS)
    assert any("empty" in problem for problem in problems)


def test_a_section_that_is_not_a_list_is_rejected():
    problems = rules.lint_note("note.yaml", yaml.safe_dump({"features": GOOD}), SECTION_KEYS)
    assert any("must be a list" in problem for problem in problems)


def test_a_prelude_is_allowed_as_prose():
    assert rules.lint_note("note.yaml", yaml.safe_dump({"prelude": GOOD}), SECTION_KEYS) == []


def test_an_empty_file_is_rejected():
    assert rules.lint_note("note.yaml", "", SECTION_KEYS)


def test_german_prose_is_rejected():
    problems = lint_entry("Piloti zeigt jetzt die Fundstelle mit dem Punkt der Richtlinie an.")
    assert any("reads as German" in problem for problem in problems)


def test_english_that_quotes_a_german_label_passes():
    assert lint_entry("The filter „Von Piloti erstellt“ now also finds diagrams in the project.") == []


def test_more_than_two_sentences_are_rejected():
    problems = lint_entry("Folders can be renamed. They can be moved. They can be deleted too.")
    assert any("3 sentences" in problem for problem in problems)


def test_a_reference_with_a_point_number_is_one_sentence():
    assert rules.sentence_count("Citations name the point, as in Pkt. 3.5.2 on S. 7, not only the page.") == 1


@pytest.mark.parametrize(
    "text",
    [
        "Platform operators can now choose the default model for new conversations.",
        "Under Platform → Models the reasoning effort now applies to every agent.",
        "New installations start with an empty knowledge base and load it once.",
    ],
)
def test_operator_notes_are_sent_to_the_operators_section(text):
    assert any("operators" in problem for problem in lint_entry(text))
    note_yaml = yaml.safe_dump({"operators": [text]})
    assert rules.lint_note("note.yaml", note_yaml, SECTION_KEYS) == []


@pytest.mark.parametrize(
    ("section", "text"),
    [
        ("security", "Langfuse moves to a release that fixes a remote code execution flaw in a bundled library."),
        ("security", "The telemetry dashboard picks up upstream fixes for vulnerabilities in its bundled code."),
        ("security", "A dependency is updated for CVE-2026-1234, which affected file previews."),
        ("security", "A viewer could bypass the permission check by opening a conversation directly."),
        ("incident", "Opening a conversation during a reload no longer causes data loss on another device."),
    ],
)
def test_security_and_severe_fixes_are_sent_to_an_internal_section(section, text):
    problems = lint_entry(text)
    assert any("security or severe fix" in problem for problem in problems), problems
    assert rules.lint_note("note.yaml", yaml.safe_dump({section: [text]}), SECTION_KEYS) == []


@pytest.mark.parametrize(
    "text",
    [
        "Deleting a folder now asks first, and its documents stay in the Archiv.",
        "Project admins can create and run scheduled skills again after a permission was renamed.",
        "A security officer can now be named in the project settings, next to the site manager.",
        "Data from the IFC model now loads twice as fast on large projects.",
    ],
)
def test_ordinary_fixes_do_not_trip_the_severe_fix_check(text):
    assert lint_entry(text) == []


def test_every_lint_message_names_the_fix():
    problems = lint_entry("Fixed #12 in `x.py`")
    assert problems and all("Fix:" in problem for problem in problems)


# ── public jargon ───────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("text", "word"),
    [
        ("Documents can now be searched through the API by partner offices.", "API"),
        ("Re-indexing a project is faster now for folders with many files.", "Re-indexing"),
        ("The new webhook fires whenever the status of a permit changes.", "webhook"),
        ("Tokens used by a conversation are now shown beside its title.", "Tokens"),
        ("A feature flag now decides who sees the new export dialog.", "feature flag"),
        ("Answers are cached for a day, so a repeated question returns at once.", "cached"),
        ("Buckets on S3 can now be connected to Piloti as a source.", "S3"),
        ("Die neue Warteschlange verarbeitet Dokumente schneller.", "Warteschlange"),
        ("Der Index wird jetzt bei jeder Änderung aktualisiert.", "Index"),
        ("Das Feature-Flag steuert den neuen Export für jedes Büro.", "Feature-Flag"),
        ("Die Konfiguration des Projekts wird jetzt beim Speichern geprüft.", "Konfiguration"),
    ],
)
def test_jargon_is_rejected_in_english_and_german(text, word):
    problems = lint_entry(text)
    assert any(f'"{word}"' in problem for problem in problems), problems


def test_the_jargon_message_names_the_word_and_gives_the_fix():
    problems = lint_entry("Documents can now be searched through the API by partner offices.")
    (problem,) = [problem for problem in problems if '"API"' in problem]
    assert "Fix:" in problem
    assert "Papierkorb" in problem  # the fix points at the words the screens use


@pytest.mark.parametrize(
    "text",
    [
        "Deleted folders stay in the Papierkorb for thirty days before they are removed.",
        "Files Piloti cannot read end up in the Quarantäne, where an admin can review them.",
        "The Steckbrief of every project now lists its address and its phase.",
    ],
)
def test_ui_product_terms_pass(text):
    assert lint_entry(text) == []


@pytest.mark.parametrize("section", ["security", "operators", "incident"])
def test_internal_sections_may_keep_the_technical_word(section):
    text = "The API key check now runs on every endpoint of the deployment pipeline."
    assert rules.lint_note("note.yaml", yaml.safe_dump({section: [text]}), SECTION_KEYS) == []


@pytest.mark.parametrize("term", rules.PUBLIC_JARGON)
def test_every_listed_term_matches_itself(term):
    assert rules.jargon_hits(term) == [term]


def test_the_ui_product_terms_are_not_on_the_list():
    ui_terms = {
        "Papierkorb",
        "Quarantäne",
        "Archiv",
        "Steckbrief",
        "Fassung",
        "Herleitung",
        "Büroablage",
        "Zugriffsliste",
        "Projektspeicher",
        "Bescheid",
        "Auflage",
        "IFC",
        "OIB",
        "RIS",
        "Prüfbuch",
        "Tiefenrecherche",
        "Aufgabe",
    }
    listed = {term.lower() for term in rules.PUBLIC_JARGON}
    assert not {term.lower() for term in ui_terms} & listed


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("The S30 series of drawings now opens without delay for every architect.", []),
        ("Das Kapitel zur Baugenehmigung ist jetzt im Projekt sichtbar.", []),
        ("A Tokenizer-free export is now the default for every office.", []),
        ("Civil works are listed under their own heading.", []),
        ("The S3-Bucket is connected.", ["S3"]),
        ("Each api call is logged.", ["api"]),
        ("Piloti runs its CI/CD checks on every change.", ["CI"]),
        ("A feature-flag and a flag.", ["feature-flag", "flag"]),
        ("Tokens, tokens and Tokenizer.", ["Tokens"]),
    ],
)
def test_short_terms_match_whole_words_only(text, expected):
    assert rules.jargon_hits(text) == expected


def test_the_repos_own_summaries_pass():
    path = REPO_ROOT / "releasenotes" / "summaries.yaml"
    assert rules.lint_summaries(path.read_text(encoding="utf-8")) == []


def test_a_summary_key_must_be_a_week_or_a_version():
    assert rules.lint_summaries(yaml.safe_dump({"last week": GOOD}))
    assert rules.lint_summaries(yaml.safe_dump({"2026-W60": GOOD}))


def test_a_summary_cannot_be_written_for_a_week_that_has_not_started():
    raw = yaml.safe_dump({"2026-W45": GOOD})
    assert rules.lint_summaries(raw, today=date(2026, 11, 2)) == []  # its Monday
    assert any("not started" in problem for problem in rules.lint_summaries(raw, today=date(2026, 11, 1)))


def test_the_repos_own_notes_pass():
    """The notes actually committed here are publishable, not just lintable in theory."""
    problems: list[str] = []
    for path in sorted((REPO_ROOT / "releasenotes" / "notes").glob("*.yaml")):
        problems.extend(rules.lint_note(path.name, path.read_text(encoding="utf-8"), SECTION_KEYS))
    assert not problems, f"{len(problems)} problem(s) in the committed notes:\n" + "\n".join(problems)


# ── grouping ────────────────────────────────────────────────────────────────


def note(version: str, date: str | None, area: str = "documents", **sections) -> object:
    return build.Note(filename=f"{version}-{date}.yaml", version=version, date=date, sections=dict(sections), area=area)


CUSTOMER = [key for key, _ in build.customer_sections(SECTIONS)]


def test_untagged_notes_group_by_the_week_they_shipped():
    groups = build.group_notes(
        [
            note("0.0.0", "2026-08-19", features=["A."]),
            note("0.0.0", "2026-09-21", fixes=["B."]),
            note("0.0.0", "2026-09-26", area="search", features=["C."]),
        ],
        [key for key, _ in SECTIONS],
    )
    assert [g["id"] for g in groups] == ["2026-W39", "2026-W34"]
    assert groups[0]["kind"] == "week"
    assert (groups[0]["date"], groups[0]["dateEnd"]) == ("2026-09-21", "2026-09-27")
    # Within a week, the configured section order wins over the note order; each note keeps its area.
    assert groups[0]["notes"] == [
        {"section": "features", "area": "search", "text": "C."},
        {"section": "fixes", "area": "documents", "text": "B."},
    ]


def test_a_week_spanning_two_months_is_one_group():
    assert build.week_of("2026-09-01") == ("2026-W36", "2026-08-31", "2026-09-06")
    assert build.week_of("2027-01-01") == ("2026-W53", "2026-12-28", "2027-01-03")


@pytest.mark.parametrize("section", ["operators", "security", "incident"])
def test_internal_notes_reach_neither_artifact(section):
    """Product news, not a bug register: these are kept in the repository and shown to nobody."""
    assert section in SECTION_KEYS
    assert section not in CUSTOMER
    groups = build.group_notes(
        [
            note("0.0.0", "2026-09-26", **{section: ["Kept in the repository only."]}),
            note("0.0.0", "2026-08-19", **{section: ["Also internal."], "fixes": ["For customers."]}),
        ],
        CUSTOMER,
        {"2026-W34": "The week."},
    )
    assert [g["id"] for g in groups] == ["2026-W34"]
    assert build.collect_strings(groups) == ["The week.", "For customers."]
    customer = rn.dump_json(build.build_customer_changelog(groups, build.customer_sections(SECTIONS), {}))
    public = rn.dump_json(build.build_public_changelog(groups, {}))
    assert "repository only" not in customer and "Also internal" not in customer
    assert "For customers" not in public  # the public page carries the summary alone


def test_ordinary_fixes_reach_customers():
    assert {"features", "improvements", "fixes"} <= set(CUSTOMER)


def test_an_edited_note_keeps_the_day_it_first_shipped():
    """reno dates a note by its latest revision; an edit must not move it to this week."""
    log = "\n".join(
        [
            "@2026-08-19T10:00:00+00:00",
            "A\treleasenotes/notes/old-1234567890abcdef.yaml",
            "@2026-09-01T10:00:00+00:00",
            "R100\treleasenotes/notes/old-1234567890abcdef.yaml\treleasenotes/notes/new-1234567890abcdef.yaml",
            "@2026-09-26T10:00:00+00:00",
            "M\treleasenotes/notes/new-1234567890abcdef.yaml",
            "A\treleasenotes/notes/fresh-fedcba0987654321.yaml",
        ]
    )
    added = build.parse_added_dates(log)
    assert added["new-1234567890abcdef.yaml"] == "2026-08-19"
    assert added["fresh-fedcba0987654321.yaml"] == "2026-09-26"


def test_a_summary_file_entry_becomes_the_week_summary():
    groups = build.group_notes([note("0.0.0", "2026-09-26", features=["A."])], ["features"], {"2026-W39": "The week."})
    assert groups[0]["summary"] == "The week."


def test_a_tagged_release_groups_under_its_version():
    groups = build.group_notes([note("2.1.0", "2026-08-19", features=["A."])], ["features"])
    assert groups[0]["kind"] == "version"
    assert groups[0]["version"] == "2.1.0"


def test_reno_placeholders_are_not_treated_as_releases():
    for placeholder in ("*working-copy*", "0.0.0", "2.1.0-3"):
        assert not build._is_release_version(placeholder)
    assert build._is_release_version("2.1.0")


def test_folded_yaml_becomes_one_clean_sentence():
    groups = build.group_notes([note("0.0.0", "2026-08-19", features=["A\n  sentence\n  over lines.\n"])], ["features"])
    assert groups[0]["notes"][0]["text"] == "A sentence over lines."


def test_a_prelude_becomes_the_release_summary():
    notes = [build.Note(filename="n.yaml", version="0.0.0", date="2026-08-19", prelude="A summary of it all.")]
    assert build.group_notes(notes, ["features"])[0]["summary"] == "A summary of it all."


def test_a_finished_week_without_a_summary_is_reported_due():
    groups = build.group_notes(
        [note("0.0.0", "2026-09-26", features=["A."]), note("0.0.0", "2026-10-01", features=["B."])],
        ["features"],
        {"2026-W39": "The week."},
    )
    assert build.summaries_due(groups, date(2026, 10, 2)) == []  # W40 is not over yet
    assert build.summaries_due(groups, date(2026, 10, 5)) == ["2026-W40"]


# ── product areas ───────────────────────────────────────────────────────────


def test_a_notes_own_area_line_wins_over_the_guess():
    raw = "---\n# area: bim\nfeatures:\n  - >\n    Uploads of whole folders now keep their structure.\n"
    assert areas.note_area("folder-upload-1234567890abcdef.yaml", raw, "Uploads of whole folders.") == "bim"


def test_without_a_line_the_area_is_guessed_from_name_and_text():
    assert areas.note_area("ifc-viewer-sections-1234567890abcdef.yaml", None, "Cut the model.") == "bim"
    assert areas.derive_area("x-1234567890abcdef.yaml", "Answers now cite the passage they rest on.") == "answers"
    assert areas.derive_area("x-1234567890abcdef.yaml", "Something nobody can place.") == areas.FALLBACK_AREA


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("# area: documents\nfeatures: []\n", None),
        ("features: []\n", None),
        ("# area: choose one of projects, documents\n", "template"),
        ("# area: dokumente\n", "unknown area"),
        ("# area: documents\n# area: search\n", "one area"),
    ],
)
def test_the_area_line_is_linted(raw, expected):
    problems = areas.lint_area("note.yaml", raw)
    assert (expected is None and problems == []) or any(expected in problem for problem in problems)


def test_every_committed_note_gets_a_known_area():
    for path in sorted((REPO_ROOT / "releasenotes" / "notes").glob("*.yaml")):
        assert areas.note_area(path.name, path.read_text(encoding="utf-8"), "") in areas.AREAS


def test_the_template_offers_every_area():
    template = yaml.safe_load(CONFIG_PATH.read_text(encoding="utf-8"))["template"]
    assert areas.TEMPLATE_AREA in (areas.area_line(template) or "")
    offered = template.split("# Keep the line above")[0]
    assert all(re.search(rf"\b{re.escape(area)}\b", offered) for area in areas.AREAS)


# ── translation ─────────────────────────────────────────────────────────────


def test_a_cached_translation_is_reused_without_calling_the_api(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-test")
    monkeypatch.setattr(tr, "translate", lambda *a, **k: pytest.fail("should not call the API"))
    cache = {tr.text_key(GOOD): {"en": GOOD, "de": "Deutsch."}}
    mapping, untranslated = tr.resolve_translations([GOOD], cache, enabled=True, require=True)
    assert mapping[GOOD] == "Deutsch."
    assert untranslated == []


def test_a_new_string_is_translated_once_and_cached(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-test")
    calls = []

    def fake_translate(text, api_key, **kwargs):
        calls.append(text)
        return "Deutsch."

    monkeypatch.setattr(tr, "translate", fake_translate)
    cache: dict = {}
    mapping, untranslated = tr.resolve_translations([GOOD, GOOD], cache, enabled=True, require=True)
    assert calls == [GOOD]  # de-duplicated by collect_strings' caller and by the cache
    assert cache[tr.text_key(GOOD)] == {"en": GOOD, "de": "Deutsch."}
    assert mapping[GOOD] == "Deutsch." and untranslated == []


def test_without_a_key_the_english_is_published_and_reported(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    mapping, untranslated = tr.resolve_translations([GOOD], {}, enabled=True, require=False)
    assert mapping[GOOD] == GOOD
    assert untranslated == [GOOD]


def test_require_translations_fails_rather_than_shipping_english(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    with pytest.raises(SystemExit):
        tr.resolve_translations([GOOD], {}, enabled=True, require=True)


class FakeResponse:
    """Stands in for the object urlopen returns."""

    def __init__(self, content=" Deutscher Satz. "):
        self.content = content

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self):
        return json.dumps({"choices": [{"message": {"content": self.content}}]}).encode()


def test_translate_posts_to_openrouter_and_returns_the_sentence(monkeypatch):
    captured = {}

    def fake_urlopen(request, timeout=None):
        captured["url"] = request.full_url
        captured["auth"] = request.headers["Authorization"]
        captured["body"] = json.loads(request.data.decode())
        return FakeResponse()

    monkeypatch.setattr(tr.urllib.request, "urlopen", fake_urlopen)
    assert tr.translate(GOOD, "sk-test", model="test/model") == "Deutscher Satz."
    assert captured["url"] == tr.OPENROUTER_URL
    assert captured["url"].startswith("https://")
    assert captured["auth"] == "Bearer sk-test"
    assert captured["body"]["model"] == "test/model"
    assert captured["body"]["messages"][-1]["content"] == GOOD


def test_an_empty_translation_is_not_published(monkeypatch):
    monkeypatch.setattr(tr.urllib.request, "urlopen", lambda request, timeout=None: FakeResponse("   "))
    monkeypatch.setattr(tr.time, "sleep", lambda _s: None)
    with pytest.raises(RuntimeError):
        tr.translate(GOOD, "sk-test", attempts=2)


def test_translate_retries_then_gives_up(monkeypatch):
    attempts = []

    def always_fails(request, timeout=None):
        attempts.append(1)
        raise TimeoutError("nope")

    monkeypatch.setattr(tr.urllib.request, "urlopen", always_fails)
    monkeypatch.setattr(tr.time, "sleep", lambda _s: None)
    with pytest.raises(RuntimeError):
        tr.translate(GOOD, "sk-test", attempts=3)
    assert len(attempts) == 3


def test_the_translation_file_round_trips(tmp_path):
    path = tmp_path / "de.json"
    tr.save_translations(path, {tr.text_key(GOOD): {"en": GOOD, "de": "Deutsch."}})
    assert tr.load_translations(path) == {tr.text_key(GOOD): {"en": GOOD, "de": "Deutsch."}}


def test_the_translation_file_stores_no_digests(tmp_path):
    """A 16-hex-character key in a JSON file reads as a credential to every scanner.

    detect-secrets failed CI on exactly that (Hex High Entropy String) when the
    cache keyed its entries by digest, and JSON cannot carry the inline
    `pragma: allowlist secret` that would answer it. The key is derived on load
    instead, so there is nothing to allowlist.
    """
    path = tmp_path / "de.json"
    tr.save_translations(path, {tr.text_key(GOOD): {"en": GOOD, "de": "Deutsch."}})
    assert not re.search(r"\b[0-9a-f]{12,}\b", path.read_text(encoding="utf-8"))
    assert json.loads(path.read_text(encoding="utf-8")) == [{"en": GOOD, "de": "Deutsch."}]


def test_the_committed_translation_file_has_the_same_shape():
    entries = json.loads((REPO_ROOT / "releasenotes" / "translations" / "de.json").read_text("utf-8"))
    assert isinstance(entries, list)
    assert all(set(entry) == {"en", "de"} and entry["en"] and entry["de"] for entry in entries)


def test_pruning_drops_translations_no_note_uses_any_more():
    cache = {tr.text_key(GOOD): {"en": GOOD, "de": "x"}, "deadbeef": {"en": "gone", "de": "weg"}}
    assert tr.prune_translations(cache, [GOOD]) == {tr.text_key(GOOD): {"en": GOOD, "de": "x"}}


# ── the two artifacts ───────────────────────────────────────────────────────


def week_groups():
    return build.group_notes(
        [note("0.0.0", "2026-08-19", features=[GOOD]), note("0.0.0", "2026-09-26", area="search", fixes=["B."])],
        CUSTOMER,
        {"2026-W34": "The week in short."},
    )


def test_the_public_artifact_holds_the_summaries_and_never_a_note():
    data = build.build_public_changelog(week_groups(), {"The week in short.": "Die Woche kurz."})
    assert [release["id"] for release in data["releases"]] == ["2026-W34"]  # W39 has no summary
    assert data["releases"][0]["summary"] == {"en": "The week in short.", "de": "Die Woche kurz."}
    assert GOOD not in rn.dump_json(data)
    assert set(data["releases"][0]) == {"id", "kind", "version", "date", "dateEnd", "summary"}


def test_the_customer_artifact_holds_every_note_with_section_and_area():
    data = build.build_customer_changelog(week_groups(), build.customer_sections(SECTIONS), {GOOD: "Deutsch."})
    assert data["sections"] == CUSTOMER
    assert data["areas"] == list(areas.AREAS)
    assert [release["id"] for release in data["releases"]] == ["2026-W39", "2026-W34"]
    assert data["releases"][1]["notes"] == [
        {"section": "features", "area": "documents", "text": {"en": GOOD, "de": "Deutsch."}}
    ]
    assert data["releases"][0]["summary"] is None


def test_the_artifacts_are_serialised_deterministically():
    data = build.build_customer_changelog(week_groups(), build.customer_sections(SECTIONS), {})
    assert rn.dump_json(data) == rn.dump_json(
        build.build_customer_changelog(week_groups(), build.customer_sections(SECTIONS), {})
    )
    assert rn.dump_json(data).endswith("\n")


def test_the_committed_public_artifact_is_summaries_only():
    """The file the website imports: a summary per listed week, in both languages, and nothing else."""
    data = json.loads(rn.CHANGELOG_FILE.read_text("utf-8"))
    assert data["releases"], "the public changelog lists no week"
    for release in data["releases"]:
        assert set(release) == {"id", "kind", "version", "date", "dateEnd", "summary"}
        assert release["summary"]["en"] and release["summary"]["de"]


def test_the_committed_customer_artifact_is_well_formed():
    """The file the app imports: every note bilingual, in a customer section and a known area."""
    data = json.loads(rn.CUSTOMER_FILE.read_text("utf-8"))
    assert data["sections"] == CUSTOMER
    assert data["areas"] == list(areas.AREAS)
    for release in data["releases"]:
        assert release["kind"] in ("version", "week")
        for item in release["notes"]:
            assert item["section"] in CUSTOMER and item["area"] in areas.AREAS
            assert item["text"]["en"] and item["text"]["de"]
            assert not rules.looks_german(item["text"]["en"]), item["text"]["en"]


TRANSLATIONS_JSON = REPO_ROOT / "releasenotes" / "translations" / "de.json"


def public_changelog_strings() -> list[str]:
    """Every English string the public page shows: the summaries."""
    data = json.loads(rn.CHANGELOG_FILE.read_text(encoding="utf-8"))
    return list(dict.fromkeys(release["summary"]["en"] for release in data["releases"]))


def test_every_public_changelog_string_has_a_german_entry():
    translations = tr.load_translations(TRANSLATIONS_JSON)
    missing = [text for text in public_changelog_strings() if not translations.get(tr.text_key(text), {}).get("de")]
    assert not missing, f"{len(missing)} public string(s) have no German entry in de.json, e.g. {missing[:3]}"


def test_the_german_of_a_public_changelog_string_is_not_its_english():
    translations = tr.load_translations(TRANSLATIONS_JSON)
    same = [text for text in public_changelog_strings() if translations.get(tr.text_key(text), {}).get("de") == text]
    assert not same, f"{len(same)} public string(s) are untranslated in de.json, e.g. {same[:3]}"


def test_no_public_changelog_string_reads_as_german():
    german = [text for text in public_changelog_strings() if rules.looks_german(text)]
    assert not german, f"{len(german)} public English string(s) read as German, e.g. {german[:3]}"


# ── the PR gate ─────────────────────────────────────────────────────────────


def test_a_product_change_needs_a_note():
    assert require_note.needs_note(["packages/agent/src/agent/tools/bim/register.py"])
    assert require_note.needs_note(["apps/workspace/app/page.tsx"])


def test_tests_and_docs_do_not_need_a_note():
    assert not require_note.needs_note(
        [
            "tests/test_release_notes.py",
            "packages/agent/src/agent/tools/bim/tests/test_measure.py",
            "apps/workspace/app/page.spec.tsx",
            "docs/architecture/overview.md",
            "deploy/pulumi/src/index.ts",
            "apps/website/src/pages/changelog.astro",
        ]
    )


def test_a_note_in_the_pr_satisfies_the_gate():
    assert require_note.has_note(["releasenotes/notes/re-index-4f2a91c0deadbeef.yaml"])
    assert not require_note.has_note(["releasenotes/config.yaml"])


def _git(repo: Path, *args: str) -> str:
    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "t",
        "GIT_AUTHOR_EMAIL": "t@t",
        "GIT_COMMITTER_NAME": "t",
        "GIT_COMMITTER_EMAIL": "t@t",
        # A developer's signing setup must not reach these throwaway commits.
        "GIT_CONFIG_COUNT": "1",
        "GIT_CONFIG_KEY_0": "commit.gpgsign",
        "GIT_CONFIG_VALUE_0": "false",
    }
    result = subprocess.run(["git", *args], cwd=repo, capture_output=True, text=True, check=True, env=env)
    return result.stdout.strip()


@pytest.fixture
def pr_repo(tmp_path, monkeypatch):
    """A repository with one product file and one old note, on its base commit."""
    _git(tmp_path, "init", "-q", "-b", "develop")
    (tmp_path / "packages/agent/src/agent").mkdir(parents=True)
    (tmp_path / "packages/agent/src/agent/tool.py").write_text("X = 1\n")
    (tmp_path / "releasenotes/notes").mkdir(parents=True)
    (tmp_path / "releasenotes/notes/old-0000.yaml").write_text("features:\n  - Old.\n")
    _git(tmp_path, "add", "-A")
    _git(tmp_path, "commit", "-qm", "base")
    monkeypatch.chdir(tmp_path)
    return tmp_path


def _pr(repo: Path, files: dict[str, str]) -> int:
    base = _git(repo, "rev-parse", "HEAD")
    for path, text in files.items():
        (repo / path).write_text(text)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "change")
    return require_note.main(["require_release_note.py", base, _git(repo, "rev-parse", "HEAD")])


def test_a_comment_only_edit_to_a_product_file_still_needs_a_note(pr_repo):
    # The check goes by file; a change nobody can notice takes the label instead.
    assert _pr(pr_repo, {"packages/agent/src/agent/tool.py": "# why X is one\nX = 1\n"}) == 1


def test_a_note_the_pr_adds_satisfies_the_gate(pr_repo):
    files = {
        "packages/agent/src/agent/tool.py": "X = 2\n",
        "releasenotes/notes/new-1111.yaml": "fixes:\n  - New.\n",
    }

    assert _pr(pr_repo, files) == 0


def test_a_note_in_an_internal_section_satisfies_the_gate(pr_repo):
    """The failure message promises it: a security fix needs a note, not a public one."""
    files = {
        "packages/agent/src/agent/tool.py": "X = 2\n",
        "releasenotes/notes/hole-2222.yaml": "security:\n  - Closed.\n",
    }

    assert _pr(pr_repo, files) == 0


def test_editing_an_old_note_does_not_satisfy_the_gate(pr_repo):
    files = {
        "packages/agent/src/agent/tool.py": "X = 2\n",
        "releasenotes/notes/old-0000.yaml": "features:\n  - Edited.\n",
    }

    assert _pr(pr_repo, files) == 1


def test_a_pr_without_product_files_needs_no_note(pr_repo):
    (pr_repo / "docs").mkdir()

    assert _pr(pr_repo, {"docs/readme.md": "Hello\n"}) == 0
