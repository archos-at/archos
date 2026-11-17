from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]


def _load(name: str, relative: str):
    spec = importlib.util.spec_from_file_location(name, REPO_ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


push = _load("scripts.prompts_push", "scripts/prompts_push.py")


SHA = "b" * 40
PUBLISHED = f"git {SHA[:12]} chat_static.md"


class FakePrompt:
    def __init__(self, prompt: str, *, version: int = 7, commit_message: str | None = PUBLISHED):
        self.prompt = prompt
        self.version = version
        self.tags = [push.GIT_TAG]
        self.commit_message = commit_message


class FakeClient:
    def __init__(self, live: FakePrompt | None):
        self.live = live
        self.created: list[dict] = []

    def get_prompt(self, name, *, label, cache_ttl_seconds, type):
        if self.live is None:
            from langfuse.api import NotFoundError

            raise NotFoundError(body={"message": "not found"})
        return self.live

    def create_prompt(self, **kwargs):
        self.created.append(kwargs)
        return FakePrompt(kwargs["prompt"], version=(self.live.version + 1) if self.live else 1)


@pytest.fixture
def committed(monkeypatch, tmp_path):
    path = tmp_path / "chat_static.md"
    path.write_text("Regel eins.\nRegel zwei.\n", encoding="utf-8")
    monkeypatch.setattr(push, "FALLBACK_FILE", path)
    monkeypatch.setattr(push, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(push, "git_origin", lambda: ("a" * 40, False))
    history = {(SHA[:12], "chat_static.md"): "Regel eins.\n"}
    monkeypatch.setattr(push, "text_at", lambda sha, relative: history.get((sha, relative)))
    monkeypatch.setattr(push, "file_history", lambda: [])
    return path


def _run(monkeypatch, client, *argv):
    monkeypatch.setattr(push, "build_client", lambda: client)
    return push.main(list(argv))


def test_a_label_that_already_serves_the_file_is_left_alone(monkeypatch, committed):
    client = FakeClient(FakePrompt("Regel eins.\nRegel zwei."))

    assert _run(monkeypatch, client, "--label", "production", "--apply") == push.EXIT_OK
    assert client.created == []


def test_the_check_says_what_would_change_and_writes_nothing(monkeypatch, committed, capsys):
    client = FakeClient(FakePrompt("Regel eins."))

    assert _run(monkeypatch, client) == push.EXIT_WOULD_CHANGE
    assert client.created == []
    assert "+Regel zwei." in capsys.readouterr().out


def test_apply_publishes_a_git_tagged_version_naming_its_commit(monkeypatch, committed):
    client = FakeClient(FakePrompt("Regel eins."))

    assert _run(monkeypatch, client, "--label", "staging", "--apply") == push.EXIT_OK
    [created] = client.created
    assert created["commit_message"] == "git aaaaaaaaaaaa chat_static.md"
    assert created["prompt"] == "Regel eins.\nRegel zwei."
    assert created["labels"] == ["staging"]
    assert created["tags"] == [push.GIT_TAG]


def test_an_edit_made_in_langfuse_is_never_overwritten(monkeypatch, committed, capsys):
    client = FakeClient(FakePrompt("Regel eins, in Langfuse verbessert.", commit_message="Tippfehler"))

    assert _run(monkeypatch, client, "--label", "production", "--apply") == push.EXIT_REFUSED
    assert client.created == []
    captured = capsys.readouterr()
    assert "task prompts:pull" in captured.err
    assert "-Regel eins, in Langfuse verbessert." in captured.out


def test_an_edit_that_kept_the_published_commit_message_is_still_refused(monkeypatch, committed):
    client = FakeClient(FakePrompt("Regel eins, in Langfuse verbessert."))

    assert _run(monkeypatch, client, "--label", "production", "--apply") == push.EXIT_REFUSED
    assert client.created == []


def test_apply_needs_the_label_named(monkeypatch, committed, capsys):
    client = FakeClient(FakePrompt("Regel eins."))

    assert _run(monkeypatch, client, "--apply") == push.EXIT_REFUSED
    assert client.created == []
    assert "--label" in capsys.readouterr().err


def test_a_label_with_no_version_yet_is_created(monkeypatch, committed):
    client = FakeClient(None)

    assert _run(monkeypatch, client) == push.EXIT_WOULD_CHANGE
    assert _run(monkeypatch, client, "--label", "production", "--apply") == push.EXIT_OK
    assert len(client.created) == 1


def test_an_uncommitted_file_is_not_published(monkeypatch, committed):
    monkeypatch.setattr(push, "git_origin", lambda: ("a" * 40, True))
    client = FakeClient(FakePrompt("Regel eins."))

    assert _run(monkeypatch, client, "--label", "production", "--apply") == push.EXIT_REFUSED
    assert client.created == []


def test_without_credentials_nothing_is_checked(monkeypatch, committed):
    assert _run(monkeypatch, None) == push.EXIT_UNCONFIGURED


def test_a_pulled_and_committed_edit_counts_as_reviewed(monkeypatch, committed):
    monkeypatch.setattr(push, "file_history", lambda: ["Regel eins, in Langfuse verbessert.\n"])
    client = FakeClient(FakePrompt("Regel eins, in Langfuse verbessert.", commit_message="Tippfehler"))

    assert _run(monkeypatch, client, "--label", "production", "--apply") == push.EXIT_OK
    assert len(client.created) == 1


def test_the_diff_keeps_a_changed_last_line_on_its_own_line(committed):
    decided = push.plan(FakePrompt("a\nb\nc"), "a\nb\nd\n", label="production")

    assert "-c\n+d" in decided.diff


def test_the_git_plumbing_reads_what_the_repository_holds(monkeypatch, tmp_path):
    import subprocess

    def git(*args: str) -> str:
        return subprocess.run(["git", *args], cwd=tmp_path, check=True, capture_output=True, text=True).stdout

    git("init", "-q")
    git("config", "user.name", "Test")
    git("config", "user.email", "test@example.invalid")
    git("config", "commit.gpgsign", "false")
    prompt = tmp_path / "prompts" / "chat_static.md"
    prompt.parent.mkdir()
    monkeypatch.setattr(push, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(push, "FALLBACK_FILE", prompt)

    prompt.write_text("Regel eins.\n", encoding="utf-8")
    git("add", ".")
    git("commit", "-q", "-m", "first")
    first = git("rev-parse", "HEAD").strip()
    prompt.write_text("Regel eins.\nRegel zwei.\n", encoding="utf-8")
    git("commit", "-q", "-am", "second")

    assert push.file_history() == ["Regel eins.\nRegel zwei.\n", "Regel eins.\n"]
    assert push.text_at(first[:12], "prompts/chat_static.md") == "Regel eins.\n"
    assert push.text_at(first, "prompts/nothing.md") is None
    assert push.git_origin() == (git("rev-parse", "HEAD").strip(), False)

    prompt.write_text("Regel eins, unversioniert.\n", encoding="utf-8")
    assert push.git_origin()[1] is True
