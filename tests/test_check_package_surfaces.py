"""The surface ratchet counts every way outside code names a submodule, refuses a new one, and follows every drop.

`scripts/check_package_surfaces.py` holds code outside `knowledge_layer.search`
and its siblings to the names each package's `__init__` exports, with
`ci/package_surface_baseline.json` recording the submodule references left when
the check arrived. These run it on a scratch repository, so the real tree's
baseline is not what they depend on; the last ones hold the real packages to
their own `_LAZY` maps.
"""

from __future__ import annotations

import importlib
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SEARCH = "packages/knowledge-layer/src/search"
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
    (tmp_path / "ci").mkdir()
    add(tmp_path, f"{SEARCH}/__init__.py", INIT)
    add(tmp_path, f"{SEARCH}/ranked_search.py", "class RankedSearch: ...\n_private = 1\n")
    add(tmp_path, f"{SEARCH}/fusion.py", "from knowledge_layer.search.ranked_search import RankedSearch\n")
    monkeypatch.chdir(tmp_path)
    return tmp_path


def add(repo: Path, path: str, text: str) -> None:
    """Write ``path`` and stage it: the check reads `git ls-files`, as a commit would."""
    target = repo / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")
    subprocess.run(["git", "add", path], cwd=repo, check=True)


def baseline(repo: Path) -> dict:
    return json.loads((repo / "ci" / "package_surface_baseline.json").read_text())


def test_each_way_of_naming_a_submodule_from_outside_counts(checker, repo):
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

    assert checker.main(["--rebaseline"]) == 0

    # The package's own sibling is inside; the import from the package is the surface.
    assert baseline(repo) == {"tests/test_x.py": {"knowledge_layer.search.ranked_search": 4}}


def test_a_new_reference_fails_and_names_the_surface(checker, repo, capsys):
    assert checker.main(["--rebaseline"]) == 0
    add(repo, "app.py", "from knowledge_layer.search.ranked_search import RankedSearch\n")

    assert checker.main([]) == 1

    err = capsys.readouterr().err
    assert "app.py: 1 reference(s) to knowledge_layer.search.ranked_search, 0 allowed" in err
    assert "`from knowledge_layer.search import RankedSearch`" in err


def test_a_dropped_reference_must_lower_the_baseline_and_update_lowers_it(checker, repo):
    add(repo, "app.py", "from knowledge_layer.search import ranked_search\n")
    assert checker.main(["--rebaseline"]) == 0
    add(repo, "app.py", "from knowledge_layer.search import RankedSearch\n")

    assert checker.main([]) == 1
    assert checker.main(["--update"]) == 0
    assert baseline(repo) == {}


def test_update_never_raises_or_adds(checker, repo):
    assert checker.main(["--rebaseline"]) == 0
    add(repo, "app.py", "from knowledge_layer.search import ranked_search\n")

    assert checker.main(["--update"]) == 1
    assert baseline(repo) == {}


def test_the_real_tree_is_held_at_its_baseline():
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
