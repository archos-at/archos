from __future__ import annotations

import importlib
import importlib.util
import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SEARCH = "packages/knowledge-layer/src/knowledge_layer/search"
INIT = '_LAZY: dict[str, str] = {"RankedSearch": ".ranked_search"}\n'


@pytest.fixture(scope="module")
def checker():
    spec = importlib.util.spec_from_file_location(
        "check_package_surfaces", ROOT / "scripts" / "check_package_surfaces.py"
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def repo(tmp_path, monkeypatch):
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    add(tmp_path, f"{SEARCH}/__init__.py", INIT)
    add(tmp_path, f"{SEARCH}/ranked_search.py", "class RankedSearch: ...\n_private = 1\n")
    add(tmp_path, f"{SEARCH}/fusion.py", "from knowledge_layer.search.ranked_search import RankedSearch\n")
    monkeypatch.chdir(tmp_path)
    return tmp_path


def add(repo: Path, path: str, text: str) -> None:
    target = repo / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")
    subprocess.run(["git", "add", path], cwd=repo, check=True)


def flagged_lines(err: str, path: str) -> set[int]:
    return {int(line) for line in re.findall(rf"^  - {re.escape(path)}:(\d+): names ", err, flags=re.MULTILINE)}


def test_each_way_of_naming_a_submodule_from_outside_is_a_finding(checker, repo, capsys):
    add(
        repo,
        "tests/test_x.py",
        "import knowledge_layer.search.ranked_search\n"
        "from knowledge_layer.search import ranked_search\n"
        "from knowledge_layer.search.ranked_search import _private\n"
        "from knowledge_layer.search import RankedSearch\n"
        "def test(monkeypatch):\n"
        '    """Patches knowledge_layer.search.ranked_search, which a docstring may say."""\n'
        '    monkeypatch.setattr("knowledge_layer.search.ranked_search._private", 2)\n',
    )

    assert checker.main([]) == 1

    assert flagged_lines(capsys.readouterr().err, "tests/test_x.py") == {1, 2, 3, 7}


def test_a_docstring_naming_a_submodule_is_not_a_finding(checker, repo):
    add(
        repo,
        "tests/test_x.py",
        'def test():\n    """Uses knowledge_layer.search.ranked_search, in prose."""\n',
    )

    assert checker.main([]) == 0


def test_a_finding_names_the_package_import_when_the_name_is_exported(checker, repo, capsys):
    add(repo, "app.py", "from knowledge_layer.search.ranked_search import RankedSearch\n")

    assert checker.main([]) == 1

    assert (
        "app.py:1: names knowledge_layer.search.ranked_search. Import "
        "`from knowledge_layer.search import RankedSearch`, its surface"
    ) in capsys.readouterr().err


def test_a_finding_names_the_package_when_the_name_is_not_exported(checker, repo, capsys):
    add(repo, "app.py", "from knowledge_layer.search.ranked_search import _private\n")

    assert checker.main([]) == 1

    assert "app.py:1: names knowledge_layer.search.ranked_search. Import a name from `knowledge_layer.search`" in (
        capsys.readouterr().err
    )


@pytest.mark.parametrize("path", ["scripts/backfill.py", "packages/knowledge-layer/tests/test_search.py"])
def test_importing_a_name_the_surface_does_not_export_is_a_finding(checker, repo, capsys, path):
    add(repo, path, "from knowledge_layer.search import RankedSearch, fusion, NotThere\n")

    assert checker.main([]) == 1

    assert (
        f"{path}:1: imports `NotThere` from knowledge_layer.search, which does not export it "
        "and raises ImportError at run time. Add it to `_LAZY` and `__all__` in "
        f"{SEARCH}/__init__.py."
    ) in capsys.readouterr().err


@pytest.mark.parametrize(
    "path",
    [
        "packages/knowledge-layer/tests/test_search.py",
        "packages/knowledge-layer/testing/helpers.py",
        "tests/knowledge_layer_tests/test_search.py",
    ],
)
def test_a_white_box_suite_is_never_a_finding(checker, repo, path):
    add(
        repo,
        path,
        "import knowledge_layer.search.ranked_search\n"
        "from knowledge_layer.search.ranked_search import RankedSearch\n"
        'PATCH = "knowledge_layer.search.ranked_search._private"\n',
    )

    assert checker.main([]) == 0


def test_a_sibling_subpackage_is_outside_the_package(checker, repo, capsys):
    add(
        repo,
        "packages/knowledge-layer/src/knowledge_layer/ingest/worker.py",
        "from knowledge_layer.search.ranked_search import RankedSearch\n",
    )

    assert checker.main([]) == 1

    assert "ingest/worker.py:1: names knowledge_layer.search.ranked_search." in capsys.readouterr().err


def test_code_inside_the_package_imports_its_siblings(checker, repo):
    assert checker.main([]) == 0


def test_the_real_tree_names_no_submodule_from_outside():
    done = subprocess.run(
        [sys.executable, "scripts/check_package_surfaces.py"], cwd=ROOT, capture_output=True, text=True, check=False
    )

    assert done.returncode == 0, done.stderr


@pytest.mark.parametrize("package", ["browse", "estate", "ingest", "read_passage", "search", "vector_store"])
def test_every_export_resolves_and_is_listed(checker, package):
    assert f"knowledge_layer.{package}" in checker.PACKAGES
    module = importlib.import_module(f"knowledge_layer.{package}")

    assert module.__all__ == sorted(module._LAZY)
    for name in module.__all__:
        getattr(module, name)
