#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
from collections.abc import Callable
from dataclasses import dataclass
from dataclasses import field
from typing import Any

logger = logging.getLogger(__name__)

DEFAULT_CORPUS_DIR = "data/oib"
DEFAULT_PREFIXES = ("oib-rl_", "oib-richtlinie_")
DEFAULT_OUT = "evals/oib-retrieval/fixtures/clause_index.json"

HEADING_RE = re.compile(r"^(\d+(?:\.\d+){0,3})\s+(\S.*)$")

DOT_LEADER_RE = re.compile(r"\.{6,}\s*\d+\s*$")

MAX_SUCCESSOR_DELTA = 3

MIN_CHAIN_LENGTH = 2

ANCHOR_WEIGHT = 100

TITLE_MATCH_CHARS = 12

PageReader = Callable[[str], list[dict[str, Any]]]


@dataclass(frozen=True)
class Candidate:
    key: tuple[int, ...]
    clause: str
    page: int
    heading: str


@dataclass
class FileExtraction:
    entries: dict[str, dict[str, Any]] = field(default_factory=dict)
    candidates: int = 0
    anchors: int = 0
    rejected: int = 0
    gaps: list[tuple[str, str]] = field(default_factory=list)
    last_page: int = 0


def parse_clause_key(clause: str) -> tuple[int, ...]:
    return tuple(int(part) for part in clause.split("."))


def is_valid_successor(last: tuple[int, ...], candidate: tuple[int, ...]) -> bool:
    if len(candidate) == len(last) + 1 and candidate[:-1] == last and candidate[-1] == 1:
        return True
    for level in range(len(last)):
        if len(candidate) != level + 1 or candidate[:level] != last[:level]:
            continue
        step = candidate[level] - last[level]
        if 0 < step <= MAX_SUCCESSOR_DELTA:
            return True
    return False


def is_immediate_successor(last: tuple[int, ...], candidate: tuple[int, ...]) -> bool:
    if len(candidate) == len(last) + 1 and candidate[:-1] == last and candidate[-1] == 1:
        return True
    for level in range(len(last)):
        if len(candidate) == level + 1 and candidate[:level] == last[:level] and candidate[level] == last[level] + 1:
            return True
    return False


def normalize_title(title: str) -> str:
    text = DOT_LEADER_RE.sub("", title)
    text = re.sub(r"\.{2,}.*$", "", text)
    text = text.replace("­", "").replace("-\n", "")
    text = re.sub(r"[\s\-]+", " ", text)
    return text.strip().casefold()


def titles_agree(left: str, right: str) -> bool:
    a = normalize_title(left)
    b = normalize_title(right)
    if not a or not b:
        return False
    width = min(len(a), len(b), TITLE_MATCH_CHARS)
    if width < TITLE_MATCH_CHARS and a != b:
        return False
    return a[:width] == b[:width]


def find_toc_titles(pages: list[dict[str, Any]]) -> dict[str, str]:
    titles: dict[str, str] = {}
    for page in pages:
        for raw_line in (page.get("text") or "").splitlines():
            line = raw_line.strip()
            match = HEADING_RE.match(line)
            if match is None or not DOT_LEADER_RE.search(line):
                continue
            titles.setdefault(match.group(1), normalize_title(match.group(2)))
    return titles


def find_candidates(pages: list[dict[str, Any]], toc_titles: dict[str, str]) -> list[Candidate]:
    candidates: list[Candidate] = []
    for page in pages:
        page_number = int(page.get("page_number") or 0)
        for raw_line in (page.get("text") or "").splitlines():
            line = raw_line.strip()
            match = HEADING_RE.match(line)
            if match is None or DOT_LEADER_RE.search(line):
                continue
            clause = match.group(1)
            heading = match.group(2).strip()
            expected = toc_titles.get(clause)
            if expected is not None and not titles_agree(expected, heading):
                continue
            candidates.append(
                Candidate(
                    key=parse_clause_key(clause),
                    clause=clause,
                    page=page_number,
                    heading=heading,
                )
            )
    return candidates


def candidate_weight(candidate: Candidate, toc_titles: dict[str, str]) -> int:
    expected = toc_titles.get(candidate.clause)
    if expected is not None and titles_agree(expected, candidate.heading):
        return ANCHOR_WEIGHT
    return 1


def heaviest_valid_chain(candidates: list[Candidate], toc_titles: dict[str, str] | None = None) -> list[Candidate]:
    count = len(candidates)
    if count == 0:
        return []
    weights = [candidate_weight(candidate, toc_titles or {}) for candidate in candidates]

    best = list(weights)
    previous = [-1] * count
    for j in range(count):
        for i in range(j):
            if best[i] + weights[j] > best[j] and is_valid_successor(candidates[i].key, candidates[j].key):
                best[j] = best[i] + weights[j]
                previous[j] = i

    end = max(range(count), key=lambda index: best[index])
    chain: list[Candidate] = []
    while end != -1:
        chain.append(candidates[end])
        end = previous[end]
    return chain[::-1]


def extract_file(pages: list[dict[str, Any]], file_name: str) -> FileExtraction:
    result = FileExtraction()
    if not pages:
        return result

    result.last_page = max(int(page.get("page_number") or 0) for page in pages)
    toc_titles = find_toc_titles(pages)
    candidates = find_candidates(pages, toc_titles)
    result.candidates = len(candidates)
    result.anchors = sum(1 for c in candidates if candidate_weight(c, toc_titles) == ANCHOR_WEIGHT)
    chain = heaviest_valid_chain(candidates, toc_titles)
    result.rejected = len(candidates) - len(chain)

    for index, candidate in enumerate(chain):
        if index + 1 < len(chain):
            end_page = max(candidate.page, chain[index + 1].page - 1)
            if chain[index + 1].page == candidate.page:
                end_page = candidate.page
        else:
            end_page = max(candidate.page, result.last_page)
        result.entries[candidate.clause] = {
            "file_name": file_name,
            "pages": list(range(candidate.page, end_page + 1)),
            "heading": candidate.heading,
        }
        if index and not is_immediate_successor(chain[index - 1].key, candidate.key):
            result.gaps.append((chain[index - 1].clause, candidate.clause))

    return result


def guideline_key(file_name: str) -> str:
    from knowledge_layer.ingest import guideline_key as shared_key

    return shared_key(file_name)


def make_page_reader() -> PageReader | None:
    try:
        from knowledge_layer.ingest import _extract_text_from_pdf
    except Exception as exc:  # noqa: BLE001 - reported, not raised
        logger.error("Could not import the production PDF extractor: %s", exc)
        return None
    return _extract_text_from_pdf


@dataclass
class BuildStats:
    files_read: int = 0
    files_failed: int = 0
    clauses: int = 0


def build_index(
    file_paths: list[str],
    *,
    page_reader: PageReader,
) -> tuple[dict[str, Any], list[str], list[str], list[str], BuildStats]:
    index: dict[str, Any] = {}
    no_numbering: list[str] = []
    gap_reports: list[str] = []
    collisions: list[str] = []
    source_by_key: dict[str, str] = {}
    stats = BuildStats()

    for path in file_paths:
        file_name = os.path.basename(path)
        try:
            pages = page_reader(path)
        except Exception as exc:  # noqa: BLE001 - one bad PDF must not abort the run
            logger.warning("Could not read %s (%s: %s); skipping.", file_name, type(exc).__name__, exc)
            stats.files_failed += 1
            continue

        if not pages:
            logger.warning("No extractable text in %s; skipping.", file_name)
            stats.files_failed += 1
            continue

        stats.files_read += 1
        extraction = extract_file(pages, file_name)
        key = guideline_key(file_name)

        if len(extraction.entries) < MIN_CHAIN_LENGTH:
            no_numbering.append(file_name)
            logger.info("No usable Punkt numbering in %s (%d candidate line(s))", file_name, extraction.candidates)
            continue

        if key in index:
            collisions.append(f"{key}: {source_by_key[key]} and {file_name} share a Richtlinie key")
            logger.warning(
                "Richtlinie key %r already written by %s; %s would overwrite it — keeping the first.",
                key,
                source_by_key[key],
                file_name,
            )
            continue
        index[key] = extraction.entries
        source_by_key[key] = file_name
        stats.clauses += len(extraction.entries)
        for previous, following in extraction.gaps:
            gap_reports.append(f"{key}: {previous} -> {following}")
        logger.info(
            "%-52s %-14s clauses=%4d rejected=%4d gaps=%d",
            file_name,
            key,
            len(extraction.entries),
            extraction.rejected,
            len(extraction.gaps),
        )

    return index, no_numbering, gap_reports, collisions, stats


def collect_pdfs(corpus_dir: str, prefix: str | tuple[str, ...]) -> list[str]:
    if not os.path.isdir(corpus_dir):
        return []
    return sorted(
        os.path.join(corpus_dir, name)
        for name in os.listdir(corpus_dir)
        if name.startswith(prefix) and name.lower().endswith(".pdf")
    )


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build the Punkt -> (file_name, pages) index for the OIB retrieval eval harness."
    )
    parser.add_argument(
        "--corpus-dir", default=DEFAULT_CORPUS_DIR, help=f"PDF directory (default: {DEFAULT_CORPUS_DIR})"
    )
    parser.add_argument(
        "--prefix",
        action="append",
        help=f"File-name prefix to index; repeatable (default: {', '.join(DEFAULT_PREFIXES)})",
    )
    parser.add_argument("--out", default=DEFAULT_OUT, help=f"Output JSON path (default: {DEFAULT_OUT})")
    parser.add_argument("--dry-run", action="store_true", help="Report what would be indexed; write nothing.")
    parser.add_argument("--verbose", action="store_true", help="Debug logging.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(message)s",
    )

    prefixes = tuple(args.prefix or DEFAULT_PREFIXES)
    file_paths = collect_pdfs(args.corpus_dir, prefixes)
    if not file_paths:
        logger.error("No %s*.pdf found under %s", "|".join(prefixes), args.corpus_dir)
        return 2

    page_reader = make_page_reader()
    if page_reader is None:
        logger.error("The production PDF extractor is unavailable; cannot build an index that matches the corpus.")
        return 2

    index, no_numbering, gap_reports, collisions, stats = build_index(file_paths, page_reader=page_reader)

    payload: dict[str, Any] = dict(sorted(index.items()))
    payload["_unresolved"] = {
        "no_usable_numbering": no_numbering,
        "sequence_gaps": gap_reports,
        "guideline_key_collisions": collisions,
        "unreadable_files": stats.files_failed,
    }

    print("")
    print(f"Richtlinien indexed : {len(index)}")
    print(f"Clauses indexed     : {stats.clauses}")
    print(f"Files read          : {stats.files_read} (failed: {stats.files_failed})")
    print("")
    print("UNRESOLVED — no usable Punkt numbering:")
    for name in no_numbering or ["  (none)"]:
        print(f"  {name}")
    print("")
    print("UNRESOLVED — sequence gaps (a heading was missed; do not label inside these):")
    for gap in gap_reports or ["  (none)"]:
        print(f"  {gap}")
    print("")

    if args.dry_run:
        print(f"[dry-run] would write {args.out}")
        return 0

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=False)
        handle.write("\n")
    print(f"Wrote {args.out}")

    return 1 if stats.files_failed else 0


if __name__ == "__main__":
    sys.exit(main())
