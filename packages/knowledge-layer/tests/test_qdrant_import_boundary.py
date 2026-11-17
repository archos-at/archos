from __future__ import annotations

import functools
import os
import pathlib
import re

REPO = pathlib.Path(__file__).resolve().parents[3]
ALLOWED = REPO / "packages" / "knowledge-layer" / "src" / "vector_store"
SEARCHED = ("src", "packages", "apps/agent-host/src", "scripts")
IMPORT = re.compile(r"^\s*(from\s+qdrant_client\b|import\s+qdrant_client\b)", re.MULTILINE)

NOT_OURS = frozenset({".venv", "node_modules", ".git", ".claude", ".agents"})
CHROMA_IMPORT = re.compile(
    r"^\s*(from\s+(chromadb|llama_index\.vector_stores\.chroma)\b"
    r"|import\s+(chromadb|llama_index\.vector_stores\.chroma)\b)"
    r"|importorskip\(\s*[\"'](chromadb|llama_index\.vector_stores\.chroma)\b",
    re.MULTILINE,
)
CHROMA_CLIENT_USE = re.compile(
    r"_get_chroma_client|\bchroma_client\b|\.get_collection\(\s*name=|include=\[\s*[\"']documents[\"']"
)


def _python_files(repo: pathlib.Path) -> list[pathlib.Path]:
    found: list[pathlib.Path] = []
    for directory, subdirs, names in os.walk(repo):
        subdirs[:] = [name for name in subdirs if name not in NOT_OURS]
        found.extend(pathlib.Path(directory, name) for name in names if name.endswith(".py"))
    return found


@functools.cache
def _real_python_files() -> tuple[pathlib.Path, ...]:
    return tuple(_python_files(REPO))


def _offenders(repo: pathlib.Path = REPO) -> list[str]:
    offenders: list[str] = []
    files = _real_python_files() if repo == REPO else _python_files(repo)
    roots = tuple(repo / root for root in SEARCHED)
    allowed = repo / "packages" / "knowledge-layer" / "src" / "vector_store"
    for path in files:
        relative = path.relative_to(repo)
        test_code = {"tests", "testing"} & set(relative.parts)
        if not any(root in path.parents for root in roots) or allowed in path.parents or test_code:
            continue
        if IMPORT.search(path.read_text(encoding="utf-8", errors="ignore")):
            offenders.append(str(relative))
    return offenders


def _chroma_users(pattern: re.Pattern[str], repo: pathlib.Path = REPO) -> list[str]:
    offenders: list[str] = []
    files = _real_python_files() if repo == REPO else _python_files(repo)
    for path in files:
        if path == pathlib.Path(__file__).resolve():  # this file plants the strings it looks for
            continue
        if pattern.search(path.read_text(encoding="utf-8", errors="ignore")):
            offenders.append(str(path.relative_to(repo)))
    return offenders


def _chroma_importers(repo: pathlib.Path = REPO) -> list[str]:
    return _chroma_users(CHROMA_IMPORT, repo)


def test_only_the_qdrant_package_imports_qdrant_client():
    assert _offenders() == []


def _plant(root: pathlib.Path, relative: str, text: str) -> pathlib.Path:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def test_the_boundary_check_would_see_an_offender(tmp_path):
    _plant(tmp_path, "scripts/_planted_qdrant_import_check.py", "from qdrant_client import QdrantClient\n")
    assert "scripts/_planted_qdrant_import_check.py" in _offenders(tmp_path)


def test_nothing_imports_chromadb():
    assert _chroma_importers() == []


def test_the_chroma_check_sees_an_offender_in_code_and_tests_alike(tmp_path):
    planted = [
        _plant(tmp_path, "src/_planted_chroma_check.py", "import chromadb\n"),
        _plant(
            tmp_path,
            "tests/_planted_chroma_check.py",
            "from llama_index.vector_stores.chroma import ChromaVectorStore\n",
        ),
        _plant(tmp_path, "tests/_planted_chroma_skip_check.py", '    chromadb = pytest.importorskip("chromadb")\n'),
    ]
    found = _chroma_importers(tmp_path)
    assert {str(path.relative_to(tmp_path)) for path in planted} <= set(found)


def test_nothing_reaches_for_a_chroma_client_by_name():
    assert _chroma_users(CHROMA_CLIENT_USE) == []


def test_the_client_check_would_see_a_lookup_by_name(tmp_path):
    _plant(
        tmp_path,
        "scripts/_planted_chroma_client_check.py",
        'client_of = getattr(retriever, "_get_chroma_client", None)\n',
    )
    assert "scripts/_planted_chroma_client_check.py" in _chroma_users(CHROMA_CLIENT_USE, tmp_path)
