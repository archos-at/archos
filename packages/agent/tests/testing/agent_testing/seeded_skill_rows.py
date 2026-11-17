from __future__ import annotations

import json
import re
from pathlib import Path

from agent.skills.models import Skill

REPO_ROOT = next(path for path in Path(__file__).resolve().parents if (path / "Taskfile.yml").is_file())
DRIZZLE_DIR = REPO_ROOT / "apps" / "workspace" / "migrations"

SEED_COLUMNS = (
    "name",
    "description",
    "body",
    "metadata",
    "published",
    "delivery",
    "created_by",
    "created_by_email",
)

_INSERT_RE = re.compile(
    r'INSERT INTO "platform_skills"\s*\((?P<columns>[^)]*)\)\s*VALUES\s*\(',
    re.IGNORECASE,
)

_DELETE_RE = re.compile(
    r'DELETE FROM "platform_skills"\s+WHERE\s+"name"\s*=\s*\'(?P<name>[^\']+)\'',
    re.IGNORECASE,
)


def strip_line_comments(sql: str) -> str:
    out: list[str] = []
    in_string = False
    i = 0
    while i < len(sql):
        char = sql[i]
        if in_string:
            if char == "'":
                if sql[i + 1 : i + 2] == "'":
                    out.append("''")
                    i += 2
                    continue
                in_string = False
            out.append(char)
            i += 1
            continue
        if char == "'":
            in_string = True
            out.append(char)
            i += 1
            continue
        if sql.startswith("--", i):
            i = sql.find("\n", i)
            if i == -1:
                break
            continue
        out.append(char)
        i += 1
    return "".join(out)


def _split_values(sql: str, start: int) -> list[str]:
    items: list[str] = []
    current: list[str] = []
    depth = 0
    in_string = False
    i = start
    while i < len(sql):
        char = sql[i]
        if in_string:
            if char == "'":
                if sql[i + 1 : i + 2] == "'":
                    current.append("''")
                    i += 2
                    continue
                in_string = False
            current.append(char)
            i += 1
            continue
        if char == "'":
            in_string = True
            current.append(char)
        elif char == "(":
            depth += 1
            current.append(char)
        elif char == ")":
            if depth == 0:
                items.append("".join(current))
                return [item.strip() for item in items]
            depth -= 1
            current.append(char)
        elif char == "," and depth == 0:
            items.append("".join(current))
            current = []
        else:
            current.append(char)
        i += 1
    raise AssertionError("unterminated VALUES tuple in a platform_skills seed")


def _unquote(literal: str) -> str:
    value = literal.removesuffix("::jsonb").strip()
    if value.upper() == "NULL":
        return ""
    if value.startswith("'") and value.endswith("'"):
        return value[1:-1].replace("''", "'")
    return value


def seeded_skills() -> list[tuple[str, dict[str, str]]]:
    seeds: list[tuple[str, dict[str, str]]] = []
    for path in sorted(DRIZZLE_DIR.glob("*.sql")):
        if path.name.endswith(".down.sql"):
            continue
        sql = strip_line_comments(path.read_text(encoding="utf-8"))
        match = _INSERT_RE.search(sql)
        if match is None:
            continue
        columns = [name.strip().strip('"') for name in match.group("columns").split(",")]
        assert tuple(columns) == SEED_COLUMNS, f"{path.name} inserts unexpected columns: {columns}"
        values = _split_values(sql, match.end())
        assert len(values) == len(columns), f"{path.name} has {len(values)} values for {len(columns)} columns"
        seeds.append((path.stem, {name: _unquote(value) for name, value in zip(columns, values, strict=True)}))
    return seeds


SEEDS = seeded_skills()


def retired_names() -> frozenset[str]:
    last_op: dict[str, str] = {}
    for path in sorted(DRIZZLE_DIR.glob("*.sql")):
        if path.name.endswith(".down.sql"):
            continue
        sql = strip_line_comments(path.read_text(encoding="utf-8"))
        if _INSERT_RE.search(sql):
            match = _INSERT_RE.search(sql)
            values = _split_values(sql, match.end())
            columns = [name.strip().strip('"') for name in match.group("columns").split(",")]
            last_op[_unquote(dict(zip(columns, values, strict=True))["name"])] = "insert"
        for delete in _DELETE_RE.finditer(sql):
            last_op[delete.group("name")] = "delete"
    return frozenset(name for name, op in last_op.items() if op == "delete")


RETIRED_NAMES = retired_names()


def effective_seeds() -> list[tuple[str, dict[str, str]]]:
    return [
        (tag, row)
        for tag, row in {row["name"]: (tag, row) for tag, row in SEEDS}.values()
        if row["name"] not in RETIRED_NAMES
    ]


EFFECTIVE_SEEDS = effective_seeds()


def effective_row(name: str) -> dict[str, str]:
    rows = [row for _, row in SEEDS if row["name"] == name]
    assert rows, f"no seed inserts {name!r}"
    return rows[-1]


def seeded_skill(name: str) -> Skill:
    row = effective_row(name)
    return Skill(
        name=row["name"],
        description=row["description"],
        body=row["body"],
        metadata=json.loads(row["metadata"]),
        origin="platform",
        standard=row["delivery"] == "standard",
    )
