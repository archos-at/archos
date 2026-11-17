from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import tempfile
import threading
import time
from collections import Counter
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

MAX_VALUE_CHARS = 120

MAX_BYTES = 8 * 1024 * 1024

_NAME_SHAPED = re.compile(r"^[\w .\-]{1,60}$", re.UNICODE)

UNEXPORTABLE = "<nicht exportierbar>"

MAX_ESCALATIONS = 50


def default_path() -> Path:
    state = os.environ.get("XDG_STATE_HOME")
    if state:
        return Path(state) / "aiq" / "capability-gaps.jsonl"
    home = Path.home()
    if str(home) not in ("", "/") and os.access(home.parent if not home.exists() else home, os.W_OK):
        return home / ".local" / "state" / "aiq" / "capability-gaps.jsonl"
    return Path(tempfile.gettempdir()) / f"aiq-{os.getuid()}" / "capability-gaps.jsonl"


def ledger_path() -> Path:
    override = os.environ.get("CAPABILITY_GAP_LOG")
    return Path(override) if override else default_path()


def _one_line(value: Any) -> str:
    text = str(value or "").strip()
    text = "".join(character for character in text if character.isprintable())
    return text[:MAX_VALUE_CHARS]


class _Escalations:

    def __init__(self) -> None:
        self._seen: set[tuple[str, str, str]] = set()
        self._lock = threading.Lock()

    def first_time(self, key: tuple[str, str, str]) -> bool:
        with self._lock:
            if key in self._seen or len(self._seen) >= MAX_ESCALATIONS:
                return False
            self._seen.add(key)
            return True

    def reset(self) -> None:
        with self._lock:
            self._seen.clear()


_escalations = _Escalations()


def reset_escalations_for_tests() -> None:
    _escalations.reset()


def record_gap(*, surface: str, field: str, asked_for: Any, known: Any = ()) -> None:
    value = _one_line(asked_for)
    if not value:
        return
    row = {
        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "surface": surface,
        "field": field,
        "askedFor": value,
        "known": sorted(str(name) for name in known),
    }
    loop = _running_loop()
    if loop is None:
        _persist(row)
        return
    loop.run_in_executor(None, _persist, row)


def _running_loop() -> asyncio.AbstractEventLoop | None:
    try:
        return asyncio.get_running_loop()
    except RuntimeError:
        return None


def _persist(row: dict[str, Any]) -> None:
    try:
        _append_line(ledger_path(), json.dumps(row, ensure_ascii=False) + "\n")
    except OSError as exc:
        logger.warning("the capability-gap ledger could not be written: %s", exc)
    _escalate(row)


def _append_line(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    handle = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW, 0o600)
    try:
        if os.fstat(handle).st_size >= MAX_BYTES:
            return
        os.write(handle, text.encode("utf-8"))
    finally:
        os.close(handle)


def _escalate(row: dict[str, Any]) -> None:
    value = str(row["askedFor"])
    if not _escalations.first_time((str(row["surface"]), str(row["field"]), value)):
        return
    exportable = value if _NAME_SHAPED.match(value) else UNEXPORTABLE
    try:
        logger.error(
            "ifc spatial surface: no %s named %r — a caller wanted a capability this surface does not have",
            row["field"],
            exportable,
            extra={
                "ifc_capability_gap": True,
                "ifc_gap_surface": row["surface"],
                "ifc_gap_field": row["field"],
                "ifc_gap_asked_for": exportable,
                "ifc_gap_known": ", ".join(row["known"]),
            },
        )
    except Exception:  # noqa: BLE001 — a logging handler that raises is not ours to re-raise into an answer
        logger.debug("the capability gap could not be escalated", exc_info=True)


def read_gaps(path: Path | None = None) -> list[dict[str, Any]]:
    target = path or ledger_path()
    if not target.exists():
        return []
    rows: list[dict[str, Any]] = []
    for line in target.read_text(encoding="utf-8", errors="replace").splitlines():
        row = _parse_row(line)
        if row is not None:
            rows.append(row)
    return rows


def _parse_row(line: str) -> dict[str, Any] | None:
    if not line.strip():
        return None
    try:
        row = json.loads(line)
    except ValueError:
        return None
    return row if isinstance(row, dict) else None


def summarise(path: Path | None = None) -> list[dict[str, Any]]:
    counts: Counter[tuple[str, str, str]] = Counter()
    last_seen: dict[tuple[str, str, str], str] = {}
    for row in read_gaps(path):
        key = (str(row.get("surface", "")), str(row.get("field", "")), str(row.get("askedFor", "")))
        counts[key] += 1
        last_seen[key] = str(row.get("at", ""))
    return [
        {"surface": surface, "field": field, "askedFor": asked, "count": count, "lastSeen": last_seen[key]}
        for key, count in counts.most_common()
        for surface, field, asked in [key]
    ]


def render_report(path: Path | None = None) -> str:
    rows = summarise(path)
    if not rows:
        return "Keine Lücken erfasst — jede Anfrage traf ein vorhandenes Werkzeug."

    lines = [
        "# Was Modelle von dieser Oberfläche wollten und nicht bekamen",
        "",
        f"{len(rows)} verschiedene Anfragen, nach Häufigkeit.",
        "",
        "| Anzahl | Oberfläche | Feld | Gewünscht | Zuletzt |",
        "|---:|---|---|---|---|",
    ]
    for row in rows:
        asked = str(row["askedFor"]).replace("|", "\\|")
        lines.append(f"| {row['count']} | {row['surface']} | {row['field']} | `{asked}` | {row['lastSeen']} |")
    lines += [
        "",
        "Jede Zeile ist ein Name, den ein Modell aufgerufen hat und den es hier nicht gibt.",
        "Das ist keine Fehlermeldung über ein Gebäude, sondern eine Aussage darüber, was",
        "dieser Oberfläche fehlt. Die Werte stammen aus einem Sprachmodell — als",
        "Wunschliste lesen, nicht als Spezifikation.",
    ]
    return "\n".join(lines)


def reset_for_tests(path: Path | None = None) -> None:
    target = path or ledger_path()
    if target.exists():
        target.unlink()
