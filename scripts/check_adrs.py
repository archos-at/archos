#!/usr/bin/env python3


from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ADR_DIR = Path("docs/adr")
TEMPLATE = "0000-template.md"

MADR_FROM = 50

RENUMBERED_LEGACY = frozenset({56, 57, 58, 59})

VALID_STATUS_RE = re.compile(r"^(?:proposed|rejected|accepted|deprecated|superseded(?: by ADR-\d{4})?)$")

FRONTMATTER_RE = re.compile(r"^---\r?\n(.*?)\r?\n---", re.DOTALL)
LEGACY_STATUS_RE = re.compile(r"^[-*]?\s*\*\*Status:?\*\*:?\s*(.+)$", re.MULTILINE)
SECTION_STATUS_RE = re.compile(r"^##\s*Status\s*\n+(.+)$", re.MULTILINE)
INDEX_ROW_RE = re.compile(r"^\|\s*\[(\d{4})\]\(([^)]+)\)\s*\|([^|]*)\|([^|]*)\|", re.MULTILINE)


def adr_files() -> list[Path]:
    return sorted(p for p in ADR_DIR.glob("[0-9][0-9][0-9][0-9]-*.md") if p.name != TEMPLATE)


def number_of(path: Path) -> int:
    return int(path.name[:4])


def raw_status(path: Path) -> str | None:
    fm = FRONTMATTER_RE.match(path.read_text(encoding="utf-8"))
    if not fm:
        return None
    m = re.search(r"^status:\s*(.+)$", fm.group(1), re.MULTILINE)
    return m.group(1).strip().strip('"').strip("'") if m else None


def legacy_status(path: Path) -> str | None:
    text = path.read_text(encoding="utf-8")
    for pattern in (LEGACY_STATUS_RE, SECTION_STATUS_RE):
        m = pattern.search(text)
        if m:
            return m.group(0).strip()
    return None


def normalise(status: str) -> str:
    first = re.split(r"[\s—(-]", status.strip().lower(), maxsplit=1)[0]
    return first.strip(":.*")


def index_rows(readme: Path, errors: list[str]) -> dict[str, str]:
    rows: dict[str, str] = {}
    text = readme.read_text(encoding="utf-8")
    previous = 0
    for m in INDEX_ROW_RE.finditer(text):
        name, status = m.group(2).strip(), m.group(4).strip()
        if name in rows:
            errors.append(f"docs/adr/README.md: {name} has more than one index row.")
        rows[name] = status
        line_before = text[: m.start()].rstrip("\n").rpartition("\n")[2]
        if not line_before.startswith("|"):
            errors.append(f"docs/adr/README.md: the row for {name} stands outside the index table.")
        number = int(m.group(1))
        if number < previous:
            errors.append(
                f"docs/adr/README.md: the row for {name} comes after {previous:04d}; keep the index in order."
            )
        previous = max(previous, number)
    return rows


DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
CONFIRMATION_RE = re.compile(r"^###\s+Confirmation\s*$\n((?:(?!^#{1,6}\s)[\s\S])*)", re.MULTILINE)


def check_madr(path: Path, status: str, errors: list[str]) -> None:
    text = path.read_text(encoding="utf-8")
    fm = FRONTMATTER_RE.match(text)
    if not fm:
        errors.append(
            f"{path.name}: ADRs from {MADR_FROM:04d} use the MADR template "
            f"(YAML frontmatter). Copy docs/adr/0000-template.md."
        )
        return

    body = fm.group(1)
    date = re.search(r"^date:\s*(.+)$", body, re.MULTILINE)
    if not date or not DATE_RE.match(date.group(1).strip().strip("\"'")):
        errors.append(f"{path.name}: frontmatter needs a `date:` as YYYY-MM-DD.")

    deciders = re.search(r"^decision-makers:\s*(.+)$", body, re.MULTILINE)
    if not deciders or not deciders.group(1).strip():
        errors.append(f"{path.name}: frontmatter needs a non-empty `decision-makers:`.")

    confirmation = CONFIRMATION_RE.search(text)
    if not confirmation or not confirmation.group(1).strip():
        errors.append(
            f"{path.name}: no `### Confirmation` section. Name the gate that keeps "
            f"the decision true, or say that nothing enforces it yet."
        )


SUPERSEDED_BY_RE = re.compile(r"superseded by (?:ADR-)?(\d{4})", re.IGNORECASE)


def check_superseded_refs(readme: Path, errors: list[str]) -> None:
    for m in INDEX_ROW_RE.finditer(readme.read_text(encoding="utf-8")):
        name, cells = m.group(2).strip(), m.group(3) + " " + m.group(4)
        path = ADR_DIR / name
        for ref in SUPERSEDED_BY_RE.findall(cells):
            targets = sorted(ADR_DIR.glob(f"{ref}-*.md"))
            if not targets:
                errors.append(f"docs/adr/README.md: {name} is superseded by {ref}, which does not exist.")
                continue
            if path.exists() and f"ADR-{ref}" not in path.read_text(encoding="utf-8"):
                errors.append(
                    f"docs/adr/README.md: {name} is superseded by {ref} in the index, "
                    f"but the record itself never cites ADR-{ref}."
                )
            older = f"ADR-{m.group(1)}"
            if not any(older in target.read_text(encoding="utf-8") for target in targets):
                errors.append(
                    f"docs/adr/README.md: {name} is superseded by {ref} in the index, "
                    f"but {targets[0].name} never cites {older}."
                )


def check(errors: list[str]) -> int:
    files = adr_files()
    readme = ADR_DIR / "README.md"
    indexed = index_rows(readme, errors)
    check_superseded_refs(readme, errors)

    seen: dict[int, Path] = {}
    for path in files:
        num = number_of(path)
        if num in seen:
            errors.append(
                f"{path.name}: number {num:04d} is already used by {seen[num].name}. Take the next one from `--next`."
            )
        seen.setdefault(num, path)

        status = raw_status(path)
        if status is None:
            errors.append(
                f"{path.name}: no frontmatter `status:`. Every ADR opens with "
                f"`---`, `status: proposed` (or another legend value), `---`."
            )
            continue
        if not VALID_STATUS_RE.match(status):
            errors.append(
                f"{path.name}: status {status!r} is not one of proposed, accepted, rejected, "
                f"deprecated, superseded, superseded by ADR-NNNN. Qualifications belong in Consequences."
            )
        legacy = legacy_status(path)
        if legacy:
            errors.append(
                f"{path.name}: a second status in the body ({legacy!r}). The frontmatter "
                f"`status:` is the only one; move a qualification to a `Status note` or Consequences."
            )

        if num >= MADR_FROM and num not in RENUMBERED_LEGACY:
            check_madr(path, status, errors)

        if path.name not in indexed:
            errors.append(f"{path.name}: missing from the index in docs/adr/README.md.")
        elif normalise(indexed[path.name]) != normalise(status):
            errors.append(
                f"{path.name}: status is {normalise(status)!r} in the file but "
                f"{normalise(indexed[path.name])!r} in the index."
            )

    on_disk = {p.name for p in files}
    for name in indexed:
        if name not in on_disk:
            errors.append(f"docs/adr/README.md: indexes {name}, which does not exist.")

    return len(files)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Keep the ADR directory and its index telling the same story.")
    parser.add_argument("--next", action="store_true", help="Print the next free ADR number and exit.")
    args = parser.parse_args(argv)

    if args.next:
        print(f"{max((number_of(p) for p in adr_files()), default=0) + 1:04d}")
        return 0

    errors: list[str] = []
    count = check(errors)

    if errors:
        print(f"ADR check FAILED ({len(errors)} error(s)):", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 1

    print(f"ADR check passed: {count} record(s), index in sync.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
