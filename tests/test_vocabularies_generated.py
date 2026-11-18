import importlib.util
import sys
from pathlib import Path

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
