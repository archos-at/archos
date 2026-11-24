from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]


def _load(name: str, relative: str):
    if str(REPO_ROOT) not in sys.path:
        sys.path.insert(0, str(REPO_ROOT))
    spec = importlib.util.spec_from_file_location(name, REPO_ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


pull = _load("scripts.prompts_pull", "scripts/prompts_pull.py")

BUNDLED = REPO_ROOT / "packages/agent/src/agent/core/prompts/chat_static.md"


@pytest.fixture(autouse=True)
def _the_real_fallback_is_never_written():
    before = BUNDLED.read_bytes()
    yield
    assert BUNDLED.read_bytes() == before, "a test wrote the real bundled prompt"


class FakePrompt:
    def __init__(self, prompt: str, version: int = 12):
        self.prompt = prompt
        self.version = version


class FakeClient:
    def __init__(self, *, answer=None, raises: Exception | None = None):
        self.answer = answer
        self.raises = raises
        self.calls: list[dict] = []

    def get_prompt(self, name, *, label, cache_ttl_seconds, type):
        self.calls.append({"name": name, "label": label, "cache_ttl_seconds": cache_ttl_seconds, "type": type})
        if self.raises is not None:
            raise self.raises
        return self.answer


class TestFetch:
    def test_it_reads_the_labelled_version_without_a_cache(self):
        client = FakeClient(answer=FakePrompt("LIVE TEXT"))

        assert pull.fetch_text(client, label="production") == "LIVE TEXT"
        assert client.calls[0] == {
            "name": "piloti-system-static",
            "label": "production",
            "cache_ttl_seconds": 0,
            "type": "text",
        }

    def test_a_missing_prompt_is_none_rather_than_an_error(self):
        from langfuse.api import NotFoundError

        client = FakeClient(raises=NotFoundError(body="no such prompt"))

        assert pull.fetch_text(client) is None

    def test_an_unreachable_langfuse_propagates(self):
        client = FakeClient(raises=RuntimeError("connection refused"))

        with pytest.raises(RuntimeError):
            pull.fetch_text(client)


class TestWriteFallback:
    def test_it_writes_the_text_with_exactly_one_trailing_newline(self, tmp_path: Path):
        target = tmp_path / "chat_static.md"

        assert pull.write_fallback("SOME PROMPT\n\n\n", target) is True
        assert target.read_text() == "SOME PROMPT\n"

    def test_an_unchanged_file_is_not_rewritten(self, tmp_path: Path):
        target = tmp_path / "chat_static.md"
        target.write_text("SOME PROMPT\n")

        assert pull.write_fallback("SOME PROMPT", target) is False

    def test_the_bundled_file_round_trips_through_a_pull(self, tmp_path: Path):
        bundled = REPO_ROOT / "packages/agent/src/agent/core/prompts/chat_static.md"
        target = tmp_path / "copy.md"
        target.write_text(bundled.read_text(encoding="utf-8"), encoding="utf-8")

        assert pull.write_fallback(bundled.read_text(encoding="utf-8"), target) is False


class TestMain:
    def test_without_credentials_it_exits_two_and_touches_nothing(self, monkeypatch, capsys):
        monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
        monkeypatch.delenv("LANGFUSE_SECRET_KEY", raising=False)

        assert pull.main([]) == 2
        assert "not set" in capsys.readouterr().err

    def test_a_label_that_does_not_exist_exits_one_without_writing(self, monkeypatch, tmp_path, capsys):
        from langfuse.api import NotFoundError

        target = tmp_path / "chat_static.md"
        target.write_text("BUNDLED\n")
        monkeypatch.setattr(pull, "FALLBACK_FILE", target)
        monkeypatch.setattr(pull, "build_client", lambda: FakeClient(raises=NotFoundError(body="nope")))

        assert pull.main(["--label", "experiment-a"]) == 1
        assert target.read_text() == "BUNDLED\n"
        assert "no 'experiment-a' version" in capsys.readouterr().err

    def test_a_successful_pull_rewrites_the_fallback(self, monkeypatch, tmp_path, capsys):
        target = tmp_path / "chat_static.md"
        target.write_text("OLD\n")
        monkeypatch.setattr(pull, "FALLBACK_FILE", target)
        monkeypatch.setattr(pull, "REPO_ROOT", tmp_path)
        monkeypatch.setattr(pull, "build_client", lambda: FakeClient(answer=FakePrompt("NEW LIVE TEXT")))

        assert pull.main([]) == 0
        assert target.read_text() == "NEW LIVE TEXT\n"
        assert "updated" in capsys.readouterr().out


class TestThePullOnlyReads:
    def test_the_script_can_only_read_from_langfuse(self):
        source = (REPO_ROOT / "scripts/prompts_pull.py").read_text(encoding="utf-8")

        assert "create_prompt" not in source
        assert "update_prompt" not in source

    def test_there_is_one_push_path(self):
        assert _scripts_calling("create_prompt(", "update_prompt(") == {"scripts/prompts_push.py"}

    def test_there_is_one_read_of_a_version(self):
        assert _scripts_calling("get_prompt(") == {"scripts/prompts_pull.py"}


def _scripts_calling(*needles: str) -> set[str]:
    return {
        str(path.relative_to(REPO_ROOT))
        for path in (REPO_ROOT / "scripts").rglob("*.py")
        if any(needle in path.read_text(encoding="utf-8") for needle in needles)
    }
