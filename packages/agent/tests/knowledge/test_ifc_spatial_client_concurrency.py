from __future__ import annotations

import os
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any

import pytest

FIXTURES = Path(__file__).resolve().parents[4] / "packages" / "ifc-spatial-py" / "tests" / "fixtures"
MODELS = {
    "a": FIXTURES / "Ifc4_SampleHouse.ifc",
    "b": FIXTURES / "floor-slab-and-window.ifc",
    "c": FIXTURES / "house-with-rooms.ifc",
    "d": FIXTURES / "units-feet.ifc",
}


@pytest.fixture()
def engine():
    pytest.importorskip("ifc_spatial.tools", reason="the spatial engine is not installed")
    from agent.knowledge import ifc_spatial_client

    missing = [str(p) for p in MODELS.values() if not p.is_file()]
    if missing:
        pytest.skip(f"fixtures are not in this checkout: {missing}")

    ifc_spatial_client.reset_cache_for_tests()
    yield ifc_spatial_client
    ifc_spatial_client.reset_cache_for_tests()


def _seed(client: Any) -> None:
    client._engine()
    for key, path in MODELS.items():
        client._PATH_BY_SOURCE[f"etag:{key}"] = str(path)


def _source(key: str) -> dict[str, Any]:
    return {"resolved": True, "model": {"modelId": key}, "source": {"etag": key}}


def test_a_cold_process_builds_one_engine_no_matter_how_many_turns_arrive(engine, monkeypatch) -> None:
    import ifc_spatial.tools as tools_module

    real = tools_module.create_tools
    built: list[Any] = []

    def slow(cache: Any = None) -> Any:
        time.sleep(0.15)
        table = real(cache)
        built.append(table)
        return table

    monkeypatch.setattr(tools_module, "create_tools", slow)

    got: list[tuple[Any, Any]] = []
    threads = [threading.Thread(target=lambda: got.append(engine._engine())) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(30)

    assert len(built) == 1
    assert all(tools is engine._TOOLS for _, tools in got)
    assert all(cache is engine._CACHE for cache, _ in got)
    assert len({id(tools) for _, tools in got}) == 1


def test_a_table_rebuild_cannot_land_between_a_parse_and_its_registration(engine, monkeypatch) -> None:
    import ifc_spatial.tools as tools_module

    _seed(engine)
    engine.open_model(_source("a"))
    engine.open_model(_source("b"))
    assert len(engine._OPEN_HANDLES) == engine.MAX_RESIDENT_MODELS

    real_call = tools_module.call
    parsed = threading.Event()
    release = threading.Event()

    def instrumented(tools: Any, name: str, args: dict[str, Any]) -> Any:
        result = real_call(tools, name, args)
        if name == "open_model" and threading.current_thread().name == "langsam":
            parsed.set()
            release.wait(20)
        return result

    monkeypatch.setattr(tools_module, "call", instrumented)

    failures: list[BaseException] = []

    def slow_turn() -> None:
        try:
            engine.open_model(_source("c"))
        except BaseException as exc:  # noqa: BLE001 — reported, not swallowed
            failures.append(exc)

    def other_turns() -> None:
        try:
            parsed.wait(20)
            for key in ("d", "a", "b"):
                engine.open_model(_source(key))
        except BaseException as exc:  # noqa: BLE001
            failures.append(exc)

    threads = [
        threading.Thread(target=slow_turn, name="langsam"),
        threading.Thread(target=other_turns, name="andere"),
    ]
    for thread in threads:
        thread.start()
    time.sleep(1.5)
    release.set()
    for thread in threads:
        thread.join(60)

    assert not failures, failures
    monkeypatch.undo()

    unresolvable = []
    for handle in list(engine._OPEN_HANDLES):
        try:
            engine.call_spatial_tool(handle, "briefing", {})
        except Exception as exc:  # noqa: BLE001
            unresolvable.append((handle[:12], str(exc)))
    assert not unresolvable, f"handles listed as open that resolve in no table: {unresolvable}"


def test_the_second_question_about_one_building_does_not_queue_behind_another_parse(engine, monkeypatch) -> None:
    import ifc_spatial.tools as tools_module

    _seed(engine)
    known = engine.open_model(_source("a"))

    release = threading.Event()
    parsing = threading.Event()
    real_call = tools_module.call

    def instrumented(tools: Any, name: str, args: dict[str, Any]) -> Any:
        result = real_call(tools, name, args)
        if name == "open_model" and threading.current_thread().name == "langsam":
            parsing.set()
            release.wait(20)
        return result

    monkeypatch.setattr(tools_module, "call", instrumented)
    blocker = threading.Thread(target=lambda: engine.open_model(_source("b")), name="langsam")
    blocker.start()
    try:
        assert parsing.wait(20)
        started = time.perf_counter()
        assert engine.open_model(_source("a")) == known
        assert time.perf_counter() - started < 1.0
    finally:
        release.set()
        blocker.join(60)


_OPEN_A_LOOP_THEN_A_BUILDING = """
import sys
from agent.knowledge import ifc_spatial_client as engine
from agent.knowledge.bim_query import BimQueryUnavailableError

def source(key):
    return {"resolved": True, "model": {"modelId": key}, "source": {"etag": key}}

engine._engine()
engine._PATH_BY_SOURCE.update({"etag:looped": sys.argv[1], "etag:building": sys.argv[2]})
try:
    engine.open_model(source("looped"))
except BimQueryUnavailableError as refused:
    print(refused)
print(engine._OPEN_LOCK.locked())
print(bool(engine.open_model(source("building"))))
"""


@pytest.mark.usefixtures("engine")
def test_a_length_unit_that_never_ends_leaves_the_open_lock_free(tmp_path) -> None:
    looped = tmp_path / "looped.ifc"
    foot = "IFCRATIOMEASURE(0.3048),#8)"
    assert foot in MODELS["d"].read_text()
    looped.write_text(MODELS["d"].read_text().replace(foot, "IFCRATIOMEASURE(0.3048),#10)"))

    done = subprocess.run(
        [sys.executable, "-c", _OPEN_A_LOOP_THEN_A_BUILDING, str(looped), str(MODELS["d"])],
        capture_output=True,
        check=False,
        text=True,
        timeout=60,
        env={**os.environ, "PYTHONPATH": os.pathsep.join(sys.path)},
    )

    assert done.returncode == 0, done.stderr[-500:]
    reason, locked, opened = done.stdout.strip().splitlines()
    assert "Längeneinheit" in reason
    assert locked == "False"
    assert opened == "True"


class TestTheDownloaderCannotSpeakAnythingButHttp:
    @staticmethod
    def _client():
        pytest.importorskip("ifc_spatial.tools", reason="the spatial engine is not installed")
        from agent.knowledge import ifc_spatial_client

        return ifc_spatial_client

    @pytest.mark.parametrize("scheme", ["file", "ftp", "data"])
    def test_the_opener_refuses_every_scheme_but_http(self, scheme, tmp_path) -> None:
        import urllib.error

        secret = tmp_path / "secret.txt"
        secret.write_text("SECRET-INTERNAL-CONTENT", encoding="utf-8")
        url = f"file://{secret}" if scheme == "file" else f"{scheme}://example.invalid/x"

        with pytest.raises(urllib.error.URLError) as raised:
            self._client()._HTTP_ONLY_OPENER.open(url, timeout=5)
        assert "unknown url type" in str(raised.value)

    def test_the_default_opener_would_have_read_it(self, tmp_path) -> None:
        import urllib.request

        secret = tmp_path / "secret.txt"
        secret.write_text("SECRET-INTERNAL-CONTENT", encoding="utf-8")
        assert urllib.request.urlopen(f"file://{secret}").read() == b"SECRET-INTERNAL-CONTENT"  # noqa: S310

    def test_the_string_guard_still_answers_first(self, tmp_path) -> None:
        from agent.knowledge.bim_query import BimQueryUnavailableError

        secret = tmp_path / "secret.txt"
        secret.write_text("x", encoding="utf-8")
        with pytest.raises(BimQueryUnavailableError):
            self._client()._download(f"file://{secret}")
