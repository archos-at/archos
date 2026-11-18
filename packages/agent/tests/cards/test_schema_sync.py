import importlib.util
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
SCHEMA_PATH = REPO_ROOT / "contracts" / "cards" / "schemas.json"


def _load_generator():
    if str(REPO_ROOT) not in sys.path:
        sys.path.insert(0, str(REPO_ROOT))
    spec = importlib.util.spec_from_file_location(
        "scripts.generate_card_schema",
        REPO_ROOT / "scripts" / "generate_card_schema.py",
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_committed_schema_matches_models():
    generator = _load_generator()
    generated = generator.generate()
    committed = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    assert generated == committed, (
        "contracts/cards/schemas.json is out of sync with the Pydantic models. "
        "Run `uv run python scripts/generate_card_schema.py` and commit the result."
    )


def test_the_generator_explains_itself_rather_than_writing(monkeypatch, capsys):
    import pytest

    generator = _load_generator()
    writes: list[object] = []
    monkeypatch.setattr(generator, "write", lambda *args, **kwargs: writes.append(args))
    with pytest.raises(SystemExit) as helped:
        generator.main(["--help"])
    assert helped.value.code == 0 and "usage" in capsys.readouterr().out
    with pytest.raises(SystemExit) as refused:
        generator.main(["--out", "x.json"])
    assert refused.value.code == 2
    assert writes == []
