from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

from agent.common.source_kinds import RETIRED_SHELF_QUALIFIERS
from agent.common.source_kinds import SHELF_QUALIFIERS
from agent.common.source_kinds import SOURCE_KINDS
from agent.common.source_kinds import Shelf

REPO_ROOT = Path(__file__).resolve().parents[1]
DICTIONARIES = REPO_ROOT / "apps" / "workspace" / "i18n" / "dictionaries"
PROMPTS = sorted((REPO_ROOT / "packages" / "agent" / "src" / "agent" / "agents").glob("*/prompts/*"))
BUILTIN_SKILLS = sorted((REPO_ROOT / "packages" / "agent" / "src" / "agent" / "skills" / "builtin").rglob("SKILL.md"))

NAME_DE = "Büroablage"
NAME_EN = "Office filing"

_OFFICE_ARCHIVE_TERM = re.compile(r"B(?:ü|ue|u)ro-?\s?[Aa]rchiv", re.IGNORECASE)
_BARE_OFFICE_SHELF = re.compile(r"(?<![\w-])Archiv(?![\wäöü])")
_EN_OLD = re.compile(r"(?i:office[- ]archive|office-wide archive)|(?<![\w/-])Archiv(?![\w])")

_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)
_LINE_COMMENT = re.compile(r"^\s*//.*$", re.MULTILINE)
_STRING = re.compile(r"'(?:[^'\\\n]|\\.)*'|\"(?:[^\"\\\n]|\\.)*\"|`(?:[^`\\]|\\.)*`")


def _strings(source: str) -> list[str]:
    code = _LINE_COMMENT.sub("", _BLOCK_COMMENT.sub("", source))
    return [literal[1:-1] for literal in _STRING.findall(code)]


def _dictionary_files(language: str) -> list[Path]:
    files = sorted(path for path in (DICTIONARIES / language).glob("*.ts") if path.name != "index.ts")
    if not files:
        pytest.skip("frontend not present in this checkout")
    return files


def _hits(files: list[Path], pattern: re.Pattern[str], *, copy_only: bool) -> list[str]:
    found = []
    for path in files:
        text = path.read_text(encoding="utf-8")
        for chunk in _strings(text) if copy_only else text.splitlines():
            if pattern.search(chunk):
                found.append(f"{path.relative_to(REPO_ROOT)}: {chunk.strip()[:120]}")
    return found


class TestTheOldNamesStayOut:
    def test_no_german_dictionary_says_office_archive(self):
        assert _hits(_dictionary_files("de"), _OFFICE_ARCHIVE_TERM, copy_only=True) == []

    def test_no_german_dictionary_names_the_shelf_office_shelf(self):
        assert _hits(_dictionary_files("de"), _BARE_OFFICE_SHELF, copy_only=True) == []

    def test_no_english_dictionary_uses_an_old_name(self):
        assert _hits(_dictionary_files("en"), _EN_OLD, copy_only=True) == []
        assert _hits(_dictionary_files("en"), _OFFICE_ARCHIVE_TERM, copy_only=True) == []

    def test_no_agent_prompt_says_office_archive_or_office_archive(self):
        assert PROMPTS, "no prompt files found under packages/agent/src/agent/agents/*/prompts"
        pattern = re.compile(rf"{_OFFICE_ARCHIVE_TERM.pattern}|office[- ]archive", re.IGNORECASE)
        assert _hits(PROMPTS, pattern, copy_only=False) == []

    def test_no_builtin_skill_says_office_archive(self):
        assert BUILTIN_SKILLS
        assert _hits(BUILTIN_SKILLS, _OFFICE_ARCHIVE_TERM, copy_only=False) == []

    def test_no_knowledge_tool_tells_the_model_the_old_name(self):
        offenders: list[str] = []
        for path in sorted((REPO_ROOT / "packages" / "knowledge-layer" / "src").rglob("*.py")):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            docstrings = {
                id(node.body[0].value)
                for node in ast.walk(tree)
                if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
                and node.body
                and isinstance(node.body[0], ast.Expr)
                and isinstance(node.body[0].value, ast.Constant)
            }
            for node in ast.walk(tree):
                if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in docstrings:
                    if _OFFICE_ARCHIVE_TERM.search(node.value) or re.search(r"(?<![\w-])project/Archiv\b", node.value):
                        offenders.append(f"{path.relative_to(REPO_ROOT)}: {node.value[:80]!r}")
        assert offenders == []

    def test_the_document_action_is_not_caught(self):
        for word in ("Archivieren", "archiviert", "Archiviert", "IFC-Archiv", "Archive"):
            assert not _BARE_OFFICE_SHELF.search(word), word
        for phrase in ("im Archiv", "Archiv öffnen", "„Archiv“", "Archiv:"):
            assert _BARE_OFFICE_SHELF.search(phrase), phrase


class TestOneNameInBothRuntimes:
    def test_the_backend_names_the_kind_and_the_shelf_office_shelf(self):
        assert SOURCE_KINDS["office"].label == NAME_DE
        assert SHELF_QUALIFIERS[Shelf.OFFICE_SHELF] == NAME_DE

    def test_the_retired_name_is_read_but_never_written(self):
        assert RETIRED_SHELF_QUALIFIERS == {"Büroarchiv": Shelf.OFFICE_SHELF}
        assert "Büroarchiv" not in SHELF_QUALIFIERS.values()

    @pytest.mark.parametrize(
        "path",
        [
            r"kinds:\s*\{[^}]*?office:\s*'([^']+)'",
            r"shelves:\s*\{\s*office_shelf:\s*'([^']+)'",
            r"shelf:\s*\{[^}]*?office:\s*'([^']+)'",
        ],
    )
    def test_the_german_dictionary_renders_the_same_name(self, path: str):
        chat = DICTIONARIES / "de" / "chat.ts"
        if not chat.is_file():
            pytest.skip("frontend not present in this checkout")
        match = re.search(path, chat.read_text(encoding="utf-8"), re.DOTALL)
        assert match, f"{path!r} not found in {chat}"
        assert match.group(1) == SOURCE_KINDS["office"].label

    def test_the_navigation_names_the_page_in_both_languages(self):
        nav = {lang: (DICTIONARIES / lang / "nav.ts") for lang in ("de", "en")}
        if not all(path.is_file() for path in nav.values()):
            pytest.skip("frontend not present in this checkout")
        for lang, expected in (("de", NAME_DE), ("en", NAME_EN)):
            match = re.search(r"\bofficeShelf:\s*'([^']+)'", nav[lang].read_text(encoding="utf-8"))
            assert match and match.group(1) == expected, lang
