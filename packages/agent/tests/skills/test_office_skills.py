from __future__ import annotations

import re
from pathlib import Path

import pytest

from agent.common import cache as shared_cache
from agent.skills.builtin import BUILTIN_SKILLS_DIR
from agent.skills.builtin import discover_builtin_skills
from agent.skills.resolver import SkillResolver
from agent.skills.runtime import SkillRuntime

OFFICE = BUILTIN_SKILLS_DIR / "office"

ENTRY = "office-files"

OFFICE_SKILLS = {
    "office-files",
    "office-word",
    "office-excel",
    "office-powerpoint",
    "office-pdf-charts",
    "office-html-pdf",
}

JS_FENCE = re.compile(r"^```js\n(.*?)\n```$", re.DOTALL | re.MULTILINE)

IMPORT = re.compile(r"""^import\s.*?\sfrom\s+"([^"]+)";$""", re.MULTILINE | re.DOTALL)

MODULE_SCOPE_IO = re.compile(r"^(?:const|let|var)\s.*\bawait\s+(?:readFile|writeFile|readdir)\b", re.MULTILINE)


@pytest.fixture(autouse=True)
def _reset_cache():
    shared_cache.reset_local_store()
    yield
    shared_cache.reset_local_store()


def _examples(skill: str) -> list[Path]:
    return sorted((OFFICE / skill / "examples").glob("*.mjs"))


def _every_example() -> list[Path]:
    return sorted(OFFICE.glob("*/examples/**/*.mjs"))


def _library_table() -> set[str]:
    body = (OFFICE / ENTRY / "SKILL.md").read_text(encoding="utf-8")
    return set(re.findall(r"^\| `([@/a-z.-]+)` [\d.]+", body, re.MULTILINE)) | set(
        re.findall(r", `([a-z.-]+)` [\d.]+", body)
    )


def test_the_office_collection_ships_its_skills() -> None:
    office = {skill.name: skill for skill in discover_builtin_skills() if skill.collection == "office"}
    assert set(office) == OFFICE_SKILLS
    for skill in office.values():
        assert skill.metadata == {"agents": "researcher", "title": skill.metadata.get("title")}, skill.name
        assert skill.metadata["title"], skill.name


def test_the_chat_agent_is_offered_every_office_skill_without_an_organization() -> None:
    chat = {skill.name for skill in SkillResolver(agent="researcher").resolve(None)}
    assert chat >= OFFICE_SKILLS


def test_deep_research_is_not_offered_the_office_skills() -> None:
    deep = {skill.name for skill in SkillResolver(agent="deep_researcher").resolve(None)}
    assert not deep & OFFICE_SKILLS


def test_the_entry_skill_is_in_the_chat_catalog_and_readable() -> None:
    runtime = SkillRuntime.office(SkillResolver(agent="researcher").resolve(None))
    assert f"/skills/office/{ENTRY}/SKILL.md" in (runtime.catalog_block() or "")
    read = runtime.mounted().read(f"/skills/office/{ENTRY}/SKILL.md", limit=1000)
    assert "export default async function" in str(read)


def test_the_execute_tool_points_at_the_entry_skill() -> None:
    from agent.tools.execute.register import EXECUTE_DESCRIPTION

    assert f"`{ENTRY}`" in EXECUTE_DESCRIPTION


def test_every_sibling_is_named_by_the_entry_skill() -> None:
    entry = (OFFICE / ENTRY / "SKILL.md").read_text(encoding="utf-8")
    for name in OFFICE_SKILLS - {ENTRY}:
        assert f"`{name}`" in entry, name


@pytest.mark.parametrize("skill", sorted(OFFICE_SKILLS))
def test_each_code_example_in_a_skill_is_a_file_beside_it(skill: str) -> None:
    fences = JS_FENCE.findall((OFFICE / skill / "SKILL.md").read_text(encoding="utf-8"))
    files = [path.read_text(encoding="utf-8").rstrip("\n") for path in _examples(skill)]
    assert fences == files


@pytest.mark.parametrize("path", _every_example(), ids=lambda path: f"{path.parent.parent.name}/{path.name}")
def test_an_example_imports_only_what_the_runner_offers(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    imported = set(IMPORT.findall(text)) - {"node:fs/promises"}
    assert imported <= _library_table(), imported - _library_table()
    assert "export default" in text
    assert not MODULE_SCOPE_IO.search(text)


def test_the_example_scan_sees_the_examples() -> None:
    assert len(_every_example()) >= 10
    assert {
        "docx",
        "exceljs",
        "pptxgenjs",
        "pdf-lib",
        "unpdf",
        "vega",
        "decimal.js",
        "@cloudflare/puppeteer",
    } <= _library_table()
