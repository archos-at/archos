import ast
import importlib.util
import re
import sys
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]


def _load_generator():
    if str(REPO_ROOT) not in sys.path:
        sys.path.insert(0, str(REPO_ROOT))
    spec = importlib.util.spec_from_file_location(
        "scripts.generate_vocabularies", REPO_ROOT / "scripts" / "generate_vocabularies.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_committed_modules_are_what_the_generator_writes() -> None:
    generator = _load_generator()
    for path, rendered in (
        (generator.OUT_PATH, generator.render()),
        (generator.LEGACY_BRAND_OUT_PATH, generator.render_legacy_brand_names()),
    ):
        assert path.read_text(encoding="utf-8") == rendered, (
            f"{path.relative_to(REPO_ROOT)} is out of sync with its Python sources. "
            "Run `uv run python scripts/generate_vocabularies.py` and commit the result."
        )


def test_every_vocabulary_is_exported() -> None:
    generator = _load_generator()
    for vocabularies, module in (
        (generator.VOCABULARIES, generator.render()),
        (generator.LEGACY_BRAND_VOCABULARIES, generator.render_legacy_brand_names()),
    ):
        for name, value, _ in vocabularies:
            assert f"export const {name} = " in module
            assert value, f"{name} is read from an empty source"


def test_the_legacy_brand_module_expires_with_its_python_source() -> None:
    generator = _load_generator()
    source = REPO_ROOT / "packages" / "agent" / "src" / "agent" / "skills" / "legacy_brand_names.py"
    marker = f"drop after release {generator.LEGACY_BRAND_RELEASE}"
    assert source.read_text(encoding="utf-8").splitlines()[0] == f"# {marker}"
    assert generator.render_legacy_brand_names().splitlines()[0] == f"// {marker}"


def test_a_change_to_any_source_module_regenerates_the_modules() -> None:
    config = yaml.safe_load((REPO_ROOT / ".pre-commit-config.yaml").read_text(encoding="utf-8"))
    hook = next(hook for repo in config["repos"] for hook in repo["hooks"] if hook["id"] == "vocabularies")
    files = re.compile(hook["files"])
    generator = ast.parse((REPO_ROOT / "scripts" / "generate_vocabularies.py").read_text(encoding="utf-8"))
    _load_generator()
    sources = {
        node.module
        for node in ast.walk(generator)
        if isinstance(node, ast.ImportFrom) and node.module and node.module.startswith(("agent.", "public_sources."))
    }
    assert sources
    for module in sorted(sources):
        origin = Path(importlib.util.find_spec(module).origin).resolve().relative_to(REPO_ROOT).as_posix()
        assert files.search(origin), f"the vocabularies hook does not run when {origin} changes; add it to `files:`"
