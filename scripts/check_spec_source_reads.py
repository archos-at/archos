#!/usr/bin/env python3


from __future__ import annotations

import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from pathlib import PurePosixPath

ALLOWLIST = Path("ci/ast_guard_specs.txt")
DOC = "docs/contributing/code-conventions.md#specs-test-behaviour"

SCRIPT = re.compile(r"\.(?:[cm]?[jt]sx?)$")
TEST_FILE = re.compile(r"\.(?:spec|test)\.[cm]?[jt]sx?$")
TEST_SUPPORT = re.compile(r"(^|/)(tests?|test-utils|__tests__|testing)/|\.fixtures?\.[cm]?[jt]sx?$")
EXCLUDED = re.compile(r"(^|/)(node_modules|_?fixtures|__fixtures__)/|\.d\.ts$")

READ_API = (
    "readFileSync",
    "readFile",
    "readdirSync",
    "readdir",
    "globSync",
    "glob",
    "opendirSync",
    "opendir",
    "createReadStream",
)
SPAWN_API = ("spawnSync", "spawn", "execFileSync", "execFile", "execSync", "exec", "fork", "execa")
TITLE_API = re.compile(r"(?:\b(?:it|test|describe|bench|suite)(?:\.\w+)*|\.each\s*\([^)]*\))\s*\(\s*$")
SPECIFIER_BEFORE = re.compile(
    r"(?:\bfrom|\bimport|\brequire\s*\(|\bimport\s*\(|\bvi\.(?:mock|doMock|unmock|importActual|importMock)\s*\()\s*$"
)
SOURCE_NAME = re.compile(r"\.(?:[cm]?[jt]sx?|py|css|scss|sql|sh|astro)(?![\w/-])|(?:^|[/'\"`])Dockerfile\b")
GENERATED = re.compile(r"\.generated\.[\w]+$")
PARSERS = (
    "typescript-api",
    "typescript",
    "@babel/parser",
    "acorn",
    "oxc-parser",
    "@typescript-eslint/typescript-estree",
    "@/test-utils/source-ast",
    "./source-ast",
    "@/test-utils/sql-statements",
    "postcss",
    "./sql-statements",
    "../../apps/workspace/tests/test-utils/sql-statements",
    "dockerfile-ast",
    "@astrojs/compiler-rs",
)


@dataclass(frozen=True)
class Literal:
    text: str
    start: int


def _regex_allowed(before: str) -> bool:
    before = before.rstrip()
    if not before:
        return True
    if before[-1] in "(,=:[!&|?{};+-*%<>~^":
        return True
    return bool(re.search(r"\b(?:return|typeof|case|do|else|in|of|void|yield|await)$", before))


def scan(source: str) -> tuple[str, list[Literal]]:
    out: list[str] = []
    literals: list[Literal] = []
    i, n = 0, len(source)
    while i < n:
        ch = source[i]
        two = source[i : i + 2]
        if two == "//":
            end = source.find("\n", i)
            end = n if end == -1 else end
            out.append(" " * (end - i))
            i = end
        elif two == "/*":
            end = source.find("*/", i + 2)
            end = n if end == -1 else end + 2
            out.append(re.sub(r"[^\n]", " ", source[i:end]))
            i = end
        elif ch in "'\"`" or (ch == "/" and _regex_allowed("".join(out[-80:])[-80:])):
            end = _literal_end(source, i)
            literals.append(Literal(source[i + 1 : end - 1], i))
            out.append(ch + re.sub(r"[^\n]", " ", source[i + 1 : end - 1]) + source[end - 1 : end])
            i = end
        else:
            out.append(ch)
            i += 1
    return "".join(out), literals


def _literal_end(source: str, start: int) -> int:
    quote = source[start]
    i, n = start + 1, len(source)
    depth = 0
    in_class = False
    while i < n:
        ch = source[i]
        if ch == "\\":
            i += 2
            continue
        if quote == "`" and source[i : i + 2] == "${":
            depth += 1
            i += 2
            continue
        if quote == "`" and depth and ch == "}":
            depth -= 1
        elif quote == "/" and ch == "[":
            in_class = True
        elif quote == "/" and ch == "]":
            in_class = False
        elif ch == quote and not depth and not in_class:
            end = i + 1
            if quote == "/":
                while end < n and source[end].isalpha():
                    end += 1
            return end
        elif ch == "\n" and quote in "'\"/":
            return i
        i += 1
    return n


def _call_spans(code: str, names: tuple[str, ...] | set[str], *, bare: bool = False) -> list[tuple[int, int]]:
    if not names:
        return []
    spans = []
    lead = r"(?<![\w$.])" if bare else r"\b"
    for match in re.finditer(lead + "(" + "|".join(map(re.escape, names)) + r")\s*\(", code):
        open_at = match.end() - 1
        depth = 0
        for at in range(open_at, len(code)):
            if code[at] == "(":
                depth += 1
            elif code[at] == ")":
                depth -= 1
                if not depth:
                    spans.append((open_at, at))
                    break
    return spans


def _readers_defined(code: str, apis: set[str]) -> set[str]:
    readers = set(apis)
    definition = re.compile(r"\b(?:const|let|function)\s+([A-Za-z_$][\w$]*)\s*(?:=\s*(?:async\s*)?)?")
    while True:
        added = set()
        for match in definition.finditer(code):
            name = match.group(1)
            if name in readers:
                continue
            body = code[match.end() : match.end() + 400].split("\n\n", 1)[0]
            if re.search(r"\b(" + "|".join(map(re.escape, readers)) + r")\s*\(", body):
                added.add(name)
        if not added:
            return readers
        readers |= added


def _const_owner(code: str, at: int) -> str | None:
    start = max(code.rfind(";", 0, at), code.rfind("\n\n", 0, at))
    match = None
    for match in re.finditer(r"\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=", code[start + 1 : at]):
        pass
    return match.group(1) if match else None


def source_names(code: str, literals: list[Literal]) -> list[str]:
    spawned = _call_spans(code, SPAWN_API, bare=True)
    in_spawn = lambda at: any(a < at < b for a, b in spawned)  # noqa: E731
    found = []
    for literal in literals:
        if len(literal.text.split()) >= 3:
            continue
        names = [m for m in SOURCE_NAME.finditer(literal.text) if not GENERATED.search(literal.text[: m.end()])]
        if not names:
            continue
        before = code[: literal.start]
        if SPECIFIER_BEFORE.search(before) or TITLE_API.search(before) or in_spawn(literal.start):
            continue
        owner = _const_owner(code, literal.start)
        if owner:
            uses = [
                u.start() for u in re.finditer(rf"(?<![\w$.]){re.escape(owner)}\b", code) if u.start() > literal.start
            ]
            if uses and all(in_spawn(u) for u in uses):
                continue
        found.append(literal.text.strip()[:80])
    return found


def raw_source_imports(source: str) -> list[str]:
    return [
        m.group(1)
        for m in re.finditer(r"['\"]([^'\"]+\?raw)['\"]", source)
        if SOURCE_NAME.search(m.group(1).split("?")[0])
    ]


@dataclass(frozen=True)
class Finding:
    path: str
    names: tuple[str, ...]


def _module_path(importer: str, specifier: str, known: set[str]) -> str | None:
    if specifier.startswith("@/"):
        app = importer.split("/")[:2]
        base = PurePosixPath(*app, specifier[2:])
    elif specifier.startswith("."):
        base = PurePosixPath(importer).parent / specifier
    else:
        return None
    parts: list[str] = []
    for part in base.parts:
        if part == "..":
            parts.pop()
        elif part != ".":
            parts.append(part)
    stem = "/".join(parts)
    for candidate in (stem, *(stem + ext for ext in (".ts", ".tsx", ".js", ".mjs", ".cjs")), stem + "/index.ts"):
        if candidate in known:
            return candidate
    return None


def imported_readers(path: str, source: str, readers_of: dict[str, set[str]], known: set[str]) -> set[str]:
    names: set[str] = set()
    for match in re.finditer(r"import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['\"]([^'\"]+)['\"]", source):
        module = _module_path(path, match.group(2), known)
        if module not in readers_of:
            continue
        for part in match.group(1).split(","):
            original, _, alias = part.strip().partition(" as ")
            if original.strip() in readers_of[module]:
                names.add((alias or original).strip())
    return names


def find(root: Path, paths: list[str]) -> list[Finding]:
    known = set(paths)
    sources = {path: (root / path).read_text(encoding="utf-8", errors="replace") for path in paths}
    scanned = {path: scan(source) for path, source in sources.items()}
    support = [path for path in paths if not TEST_FILE.search(path)]
    readers_of: dict[str, set[str]] = {}
    for _ in range(3):
        readers_of = {
            path: _readers_defined(
                scanned[path][0], set(READ_API) | imported_readers(path, sources[path], readers_of, known)
            )
            - set(READ_API)
            for path in support
        }
    findings = []
    for path, (code, literals) in scanned.items():
        apis = set(READ_API) | imported_readers(path, sources[path], readers_of, known)
        readers = _readers_defined(code, apis)
        names = raw_source_imports(sources[path])
        if _call_spans(code, readers):
            names += source_names(code, literals)
        if names:
            findings.append(Finding(path, tuple(dict.fromkeys(names))))
    return findings


def in_scope(path: str) -> bool:
    return (
        bool(SCRIPT.search(path))
        and not EXCLUDED.search(path)
        and bool(TEST_FILE.search(path) or TEST_SUPPORT.search(path))
    )


def tracked(root: Path) -> list[str]:
    out = subprocess.run(["git", "ls-files"], cwd=root, capture_output=True, text=True, check=True).stdout
    return [path for path in out.splitlines() if in_scope(path) and (root / path).is_file()]


def load_allowlist(path: Path) -> list[str]:
    if not path.exists():
        return []
    rows = (line.split("#", 1)[0].strip() for line in path.read_text(encoding="utf-8").splitlines())
    return [row for row in rows if row]


def parses(source: str) -> bool:
    return any(re.search(rf"""['"]{re.escape(parser)}['"]""", source) for parser in PARSERS)


def check(root: Path) -> list[str]:
    allowed = load_allowlist(root / ALLOWLIST)
    findings = {finding.path: finding for finding in find(root, tracked(root))}
    problems = []
    for path, finding in sorted(findings.items()):
        if path in allowed:
            continue
        problems.append(
            f"{path}: reads source text ({', '.join(finding.names[:3])}). Test behaviour: import the code, call it "
            "and assert on what it returns or does. A guard over the whole tree parses the code with the "
            f"TypeScript compiler API (typescript-api) instead of matching text, and is listed in {ALLOWLIST}."
        )
    for path in allowed:
        file = root / path
        if not file.is_file():
            problems.append(f"{ALLOWLIST}: {path} does not exist. Remove the line.")
        elif path not in findings:
            problems.append(f"{ALLOWLIST}: {path} no longer reads source files. Remove the line.")
        elif not parses(file.read_text(encoding="utf-8", errors="replace")):
            problems.append(
                f"{path}: listed in {ALLOWLIST} but imports no parser. Parse the code with the TypeScript "
                "compiler API (import ts from 'typescript-api') and assert on the syntax tree, never on text."
            )
    return problems


def main() -> int:
    problems = check(Path.cwd())
    if problems:
        print(f"Spec source-read check FAILED ({len(problems)}):", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        print(f"Why: {DOC}", file=sys.stderr)
        return 1
    print(f"Spec source-read check passed: {len(load_allowlist(Path.cwd() / ALLOWLIST))} AST guard spec(s) listed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
