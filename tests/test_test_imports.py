from __future__ import annotations

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

DOTTED = re.compile(
    r"""(?:^[ \t]*(?:from|import)[ \t]+|["'])(?P<path>(?P<root>tests|sources)\.(?P<top>[A-Za-z_]\w*)[\w.]*)""",
    re.MULTILINE,
)


SOURCES_PATH = re.compile(r"sources\.\w+\.(?:src|tests)\b")


def _suite_directories() -> frozenset[str]:
    return frozenset(path.name for path in (ROOT / "tests").iterdir() if path.is_dir() and path.name != "fixtures")


def _offenders(files: dict[str, str], suites: frozenset[str]) -> list[str]:
    return [
        f"{name}:{text[: match.start()].count(chr(10)) + 1}: {match['path']}"
        for name, text in sorted(files.items())
        for match in DOTTED.finditer(text)
        if (match["root"] == "sources" and SOURCES_PATH.match(match["path"])) or match["top"] in suites
    ]


def _tracked_python() -> dict[str, str]:
    names = subprocess.run(
        ["git", "ls-files", "-z", "*.py"], cwd=ROOT, check=True, capture_output=True, text=True
    ).stdout.split("\0")
    return {name: (ROOT / name).read_text(encoding="utf-8") for name in names if name and (ROOT / name).is_file()}


def test_no_python_file_imports_a_module_through_a_suite_directory():
    files = {name: text for name, text in _tracked_python().items() if name != f"tests/{Path(__file__).name}"}
    offenders = _offenders(files, _suite_directories())

    assert offenders == [], "import these from the suite's `<distribution>_testing` package:\n" + "\n".join(offenders)


def test_the_check_sees_each_spelling_and_lets_the_stable_ones_through():
    planted = {
        "a.py": "from tests.aiq_agent.tools.canvas.conftest import DOCUMENT\n",
        "b.py": "    from tests.knowledge_layer_tests import pdf_fixtures\n",
        "c.py": "from sources.knowledge_layer.src.register import search\n",
        "d.py": 'monkeypatch.setattr("sources.knowledge_layer.src.register._get_retriever", fake)\n',
        "e.py": "import sources.ris_adapter.tests.conftest\n",
        "fine.py": (
            "from tests.provider_doubles import StrictProviderChatModel\n"
            "from tests.fixtures.drafting_turns import FILE\n"
            "from .conftest import BODY\n"
            "from knowledge_layer_testing.vector_store import write\n"
            'span.set_attribute("sources.count", 3)\n'
            "value = row['sources.0.title']\n"
            "# a comment about tests.aiq_agent.tools is prose, not an import\n"
        ),
    }

    found = _offenders(planted, frozenset({"aiq_agent", "knowledge_layer_tests"}))

    assert [line.split(":")[0] for line in found] == ["a.py", "b.py", "c.py", "d.py", "e.py"]
