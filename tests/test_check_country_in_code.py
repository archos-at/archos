"""The country-in-code ratchet refuses a new country token in code, and makes the baseline follow every removal.

`scripts/check_country_in_code.py` counts the tokens of `ci/country_tokens.json` in
source code under `apps/` and `packages/`, with `ci/country_in_code_baseline.json`
recording what each file held when the check arrived. These run it on a scratch
repository with the real token list, so the real tree's baseline is not what they
depend on and the list itself is what they prove.
"""

from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
PACKS = ROOT / "configs" / "knowledge-packs"


@pytest.fixture(scope="module")
def checker():
    path = ROOT / "scripts" / "check_country_in_code.py"
    spec = importlib.util.spec_from_file_location("check_country_in_code", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    # A dataclass resolves its annotations through sys.modules, so register before running the module.
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def tokens(checker):
    return checker.load_tokens(ROOT / checker.TOKENS)


@pytest.fixture
def repo(tmp_path, monkeypatch):
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    (tmp_path / "ci").mkdir()
    shutil.copy(ROOT / "ci" / "country_tokens.json", tmp_path / "ci" / "country_tokens.json")
    monkeypatch.chdir(tmp_path)
    return tmp_path


def _add(repo: Path, path: str, text: str = "") -> None:
    """Write ``path`` and stage it: the check reads `git ls-files`, as a commit would."""
    target = repo / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")
    subprocess.run(["git", "add", path], cwd=repo, check=True)


def _baseline(repo: Path) -> dict[str, int]:
    return json.loads((repo / "ci" / "country_in_code_baseline.json").read_text(encoding="utf-8"))


def _texts(tokens, text: str) -> list[str]:
    return [hit.text for hit in tokens.hits(text)]


def test_a_new_file_that_names_a_country_fails_with_its_path_and_count(checker, repo, capsys):
    _add(repo, "packages/agent/src/agent/neutral.py", "def lookup(source):\n    return source.read()\n")
    _add(repo, "apps/workspace/bff/law/lookup.ts", "export const HOST = 'https://www.ris.bka.gv.at'\n")

    assert checker.main([]) == 1
    err = capsys.readouterr().err
    assert "apps/workspace/bff/law/lookup.ts: 1 country hit(s), baseline 0" in err
    assert "neutral.py" not in err


def test_a_baselined_file_may_stay_but_not_grow(checker, repo, capsys):
    _add(repo, "packages/agent/src/agent/law.py", "LANE = 'building_law_oib'\n")
    assert checker.main(["--rebaseline"]) == 0
    assert checker.main([]) == 0

    _add(repo, "packages/agent/src/agent/law.py", "LANE = 'building_law_oib'\nOTHER = 'building_law_ris'\n")

    assert checker.main([]) == 1
    assert "packages/agent/src/agent/law.py: 2 country hit(s), baseline 1" in capsys.readouterr().err


def test_a_removal_asks_for_the_baseline_to_follow_and_update_only_lowers_it(checker, repo, capsys):
    _add(repo, "packages/agent/src/agent/law.py", "A = 'oib'\nB = 'ris'\nC = 'Wien'\n")
    _add(repo, "packages/agent/src/agent/gone.py", "A = 'oib'\n")
    checker.main(["--rebaseline"])
    _add(repo, "packages/agent/src/agent/law.py", "A = 'oib'\n")
    _add(repo, "packages/agent/src/agent/gone.py", "A = source.publisher\n")
    _add(repo, "packages/agent/src/agent/new.py", "LAND = 'Tirol'\n")

    assert checker.main([]) == 1
    err = capsys.readouterr().err
    assert "packages/agent/src/agent/law.py: down from 3 to 1, so lower its baseline entry" in err
    assert "packages/agent/src/agent/gone.py: down from 1 to 0, so lower its baseline entry" in err

    # --update tightens what is recorded and still refuses the new file: it never adds an entry.
    assert checker.main(["--update"]) == 1
    assert _baseline(repo) == {"packages/agent/src/agent/law.py": 1}
    assert "packages/agent/src/agent/new.py: 1 country hit(s), baseline 0" in capsys.readouterr().err


def test_what_is_data_by_nature_and_what_lies_outside_the_roots_is_not_checked(checker, repo):
    austria = "LAND = 'Wien'\nSOURCE = 'ris'\n"
    for path in (
        "packages/agent/tests/test_law.py",
        "packages/ris-adapter/tests/fixtures/answers.py",
        "apps/workspace/bff/law/lookup.spec.ts",
        "apps/workspace/bff/geo/photon.fixtures.ts",
        "apps/workspace/i18n/dictionaries/de/law.ts",
        "apps/workspace/migrations/seed.ts",
        "apps/workspace/shared/vocabularies.generated.ts",
        "apps/workspace/app/dev/sources/page.tsx",
        "apps/website/src/i18n/pages/building-law.ts",
        "configs/knowledge-packs/loader.py",
        "scripts/build_catalog.py",
        "docs/examples/sample.py",
    ):
        _add(repo, path, austria)
    # Not a source file, so not this check's: a pack is where a country belongs.
    _add(repo, "packages/agent/src/agent/data/at.json", '{"name": "Wien"}\n')

    assert checker.main([]) == 0
    assert not checker.is_checked("scripts/build_catalog.py")
    assert checker.is_checked("packages/agent/src/agent/law.py")


def test_comments_and_docstrings_are_not_code_but_strings_are(checker):
    python = (
        '"""Why the OIB path went away (ADR-0175)."""\n'
        "# RIS used to be read here\n"
        "def read(source):\n"
        '    """Vienna was the only Land."""\n'
        "    return source  # not Wien\n"
        "PROMPT = 'Antworte wie ein österreichisches Architekturbüro'\n"
    )
    script = (
        "// RIS used to be read here\n"
        "/** The OIB path went away.\n * Wien was the only Land. */\n"
        "export const url = 'https://example.org/a' // not Wien\n"
        "export const PROMPT = `Frage das RIS`\n"
    )

    assert "österreichisches" in checker.code_text("a.py", python)
    for word in ("OIB", "RIS", "Vienna", "Wien"):
        assert word not in checker.code_text("a.py", python)
    assert checker.code_text("a.ts", script).count("RIS") == 1
    assert "Wien" not in checker.code_text("a.ts", script)
    # A `//` inside a string is a URL, not a comment.
    assert "example.org/a" in checker.code_text("a.ts", script)


def test_a_file_or_directory_named_for_a_country_source_is_a_hit_and_a_file_inside_it_is_not(checker, repo, capsys):
    _add(repo, "packages/ris-adapter/src/client.py", "def fetch(url):\n    return url\n")
    checker.main(["--rebaseline"])
    assert _baseline(repo) == {"packages/ris-adapter/": 1}

    _add(repo, "packages/ris-adapter/src/planner.py", "def plan(question):\n    return question\n")
    assert checker.main([]) == 0

    _add(repo, "apps/agent-host/src/agent_host/routes/oib_sync.py", "def sync():\n    return None\n")
    assert checker.main([]) == 1
    assert "apps/agent-host/src/agent_host/routes/oib_sync.py: 1 country hit(s), baseline 0" in capsys.readouterr().err


@pytest.mark.parametrize(
    "text",
    [
        "ris_lookup",
        "RIS_SOURCE_ID",
        "RisClient",
        "isRisUrl",
        "building_law_ris",
        "at-ris",
        "'ris'",
        "RIS",
        "ris_xml",
        "plugin-ris",
    ],
)
def test_the_legal_database_is_caught_as_a_word_of_an_identifier(tokens, text):
    assert [hit.kind for hit in tokens.hits(text)] == ["legal_database"]


@pytest.mark.parametrize(
    "text",
    [
        "risk_level = arise(Paris, iris, RISK, Polaris)",
        "authorisation, comparison, serialise, characteristics, prism, crisis, Risiko",
        "jurisdiction, exhibit, foible, prohibited, inhibitBoibs",
        "const stopwords = ['a', 'about', 'attach', 'updatedAt']; value.at(0); look at it; AT_MOST = 3",
        "tyre, wiener_filter_x, steered, baugruppe, nobody, noexcept, too_early, subgroup",
        "www.example.org/gv.attic, navigate, format.gv.atlas",
    ],
)
def test_unrelated_words_that_contain_a_token_are_not_hits(tokens, text):
    # `wiener` is the one exception written down here: it is a token (Wiener Bauordnung), so the
    # Wiener filter of signal processing would be a hit. Nothing in the tree uses it.
    assert [hit.text for hit in tokens.hits(text) if hit.text.lower() != "wiener"] == []


def test_one_occurrence_is_one_hit_under_the_most_specific_kind(tokens):
    assert [(hit.kind, hit.text) for hit in tokens.hits("fetch('https://www.ris.bka.gv.at/eli/x')")] == [
        ("host", "www.ris.bka.gv.at")
    ]
    assert [(hit.kind, hit.text) for hit in tokens.hits("'oib-rl_2_ausgabe_mai_2023.pdf'")] == [
        ("corpus_file_name", "oib-rl_2_ausgabe_mai_2023.pdf")
    ]
    assert _texts(tokens, "territoryId: 'AT-9', country === 'at', code: \"AT\"") == ["AT-9", "'at'", '"AT"']
    assert _texts(tokens, "NÖ Bauordnung 2014, WBTV, OibSync, Wiener Bautechnikverordnung") == [
        "NÖ",
        "Bauordnung",
        "WBTV",
        "Oib",
        "Wiener",
        "Bautechnikverordnung",
    ]


def test_the_token_list_names_every_territory_of_every_shipped_country_pack(tokens):
    """A pack for a second country is the moment its tokens are due: this fails until they are listed."""
    listed = set(json.loads((ROOT / "ci" / "country_tokens.json").read_text(encoding="utf-8"))["countries"])
    for pack_path in sorted(PACKS.glob("*.json")):
        pack = json.loads(pack_path.read_text(encoding="utf-8"))
        territories = [record for record in pack["records"] if record["type"] == "territory"]
        for territory in territories:
            if territory["kind"] not in {"country", "state"}:
                continue  # a union of countries is no country
            country = territory["id"].split("-")[0]
            assert country in listed, f"{pack_path.name}: add {country} to ci/country_tokens.json"
            assert tokens.hits(territory["name"]), f"{territory['name']} ({territory['id']}) is in no token"
            assert tokens.hits(f"'{territory['id']}'"), f"{territory['id']} is in no token"


def test_the_real_tree_is_at_its_baseline():
    result = subprocess.run(
        [sys.executable, "scripts/check_country_in_code.py"], cwd=ROOT, capture_output=True, text=True, check=False
    )
    assert result.returncode == 0, result.stderr
