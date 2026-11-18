from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from oib_retrieval.corpus import ARM_CLAUSE
from oib_retrieval.corpus import ARM_PAGE
from oib_retrieval.corpus import CHUNK_OVERLAP
from oib_retrieval.corpus import CHUNK_SIZE
from oib_retrieval.corpus import CorpusMissingError
from oib_retrieval.corpus import clause_or_page_documents
from oib_retrieval.corpus import default_corpus_dir
from oib_retrieval.corpus import extract_pages
from oib_retrieval.corpus import page_documents
from oib_retrieval.qrels import ClauseIndex

_DOT_LEADER_RE = re.compile(r"\.{4,}")


def _normalise(text: str) -> str:
    from knowledge_layer.ingest import _dehyphenate

    from agent.common.german_text import fold
    from agent.common.german_text import tokenize

    return " " + " ".join(tokenize(fold(_dehyphenate(text)))) + " "


def _content_lines(pages: list[dict[str, Any]]) -> list[tuple[int, str]]:
    from knowledge_layer.ingest import _is_furniture

    collected: list[tuple[int, str]] = []
    for page in pages:
        for line in (page.get("text") or "").splitlines():
            stripped = line.strip()
            if stripped and not _is_furniture(stripped):
                collected.append((int(page["page_number"]), stripped))
    return collected


def _body_end(lines: list[tuple[int, str]]) -> int:
    from knowledge_layer.ingest import _END_OF_BODY_RE

    for position, (_page, line) in enumerate(lines):
        if _END_OF_BODY_RE.match(line):
            return position
    return len(lines)


def _locate_spans(
    index: ClauseIndex, richtlinie: str, lines: list[tuple[int, str]], body_end: int
) -> tuple[dict[str, tuple[int, int]], list[str]]:
    punkte = index.clauses(richtlinie)
    starts: dict[str, int] = {}
    claimed: set[int] = set()
    for punkt, meta in punkte.items():
        pattern = re.compile(rf"^{re.escape(punkt)}\s+\S")
        first_page = int(meta["pages"][0])
        for position, (page, line) in enumerate(lines[:body_end]):
            if page != first_page or position in claimed:
                continue
            if pattern.match(line) and not _DOT_LEADER_RE.search(line):
                starts[punkt] = position
                claimed.add(position)
                break

    ordered = sorted(starts.items(), key=lambda item: item[1])
    spans: dict[str, tuple[int, int]] = {}
    for position, (punkt, start) in enumerate(ordered):
        end = ordered[position + 1][1] if position + 1 < len(ordered) else body_end
        spans[punkt] = (start, max(end, start + 1))
    return spans, sorted(set(punkte) - set(starts))


@dataclass(frozen=True)
class ArmStructure:
    arm: str
    leaf_clauses: int
    contiguous: int
    isolated: int
    chunks: int
    contained_total: int
    chunks_with_clauses: int

    @property
    def contiguous_pct(self) -> float:
        return 100.0 * self.contiguous / self.leaf_clauses if self.leaf_clauses else 0.0

    @property
    def isolated_pct(self) -> float:
        return 100.0 * self.isolated / self.leaf_clauses if self.leaf_clauses else 0.0

    @property
    def clauses_per_chunk(self) -> float:
        return self.contained_total / self.chunks_with_clauses if self.chunks_with_clauses else 0.0


@dataclass(frozen=True)
class StructureReport:
    per_guideline: dict[str, dict[str, ArmStructure]]
    totals: dict[str, ArmStructure]
    indexed_clauses: int
    located_clauses: int
    structural_parents: int
    unlocated: dict[str, list[str]]


def measure_document(
    index: ClauseIndex,
    richtlinie: str,
    pages: list[dict[str, Any]],
    file_name: str,
    file_size: int,
) -> tuple[dict[str, ArmStructure], int, int, list[str]]:
    lines = _content_lines(pages)
    body_end = _body_end(lines)
    spans, unlocated = _locate_spans(index, richtlinie, lines, body_end)

    leaves = [punkt for punkt in spans if not index.has_children(richtlinie, punkt)]
    leaf_text = {
        punkt: _normalise("\n".join(line for _page, line in lines[spans[punkt][0] : spans[punkt][1]]))
        for punkt in leaves
    }

    results: dict[str, ArmStructure] = {}
    for arm, builder in ((ARM_PAGE, page_documents), (ARM_CLAUSE, clause_or_page_documents)):
        documents = builder(pages, file_name, file_size)
        chunk_texts = _chunk_texts(documents)
        contained_counts = [sum(1 for text in leaf_text.values() if text in chunk) for chunk in chunk_texts]

        contiguous = 0
        isolated = 0
        for clause_text in leaf_text.values():
            counts = [contained_counts[position] for position, chunk in enumerate(chunk_texts) if clause_text in chunk]
            if not counts:
                continue
            contiguous += 1
            if min(counts) == 1:
                isolated += 1

        results[arm] = ArmStructure(
            arm=arm,
            leaf_clauses=len(leaves),
            contiguous=contiguous,
            isolated=isolated,
            chunks=len(chunk_texts),
            contained_total=sum(contained_counts),
            chunks_with_clauses=sum(1 for count in contained_counts if count),
        )
    parents = sum(1 for punkt in index.clauses(richtlinie) if index.has_children(richtlinie, punkt))
    return results, len(spans), parents, unlocated


def _chunk_texts(documents: list[Any]) -> list[str]:
    from llama_index.core.node_parser import SentenceSplitter

    splitter = SentenceSplitter(chunk_size=CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP)
    return [_normalise(node.get_content()) for node in splitter.get_nodes_from_documents(documents)]


def _sum_arms(rows: Iterable[ArmStructure], arm: str) -> ArmStructure:
    rows = list(rows)
    return ArmStructure(
        arm=arm,
        leaf_clauses=sum(row.leaf_clauses for row in rows),
        contiguous=sum(row.contiguous for row in rows),
        isolated=sum(row.isolated for row in rows),
        chunks=sum(row.chunks for row in rows),
        contained_total=sum(row.contained_total for row in rows),
        chunks_with_clauses=sum(row.chunks_with_clauses for row in rows),
    )


def _require_corpus(index: ClauseIndex, corpus_dir: Path) -> None:
    missing = [
        index.file_name(richtlinie)
        for richtlinie in index.guidelines
        if not (corpus_dir / index.file_name(richtlinie)).is_file()
    ]
    if not missing:
        return
    raise CorpusMissingError(
        f"no OIB corpus to measure: {len(missing)} of {len(index.guidelines)} Richtlinien PDFs "
        f"named by the Punkt index are not in {corpus_dir}.\n"
        f"First missing: {missing[0]}\n"
        "The corpus is operator-provided and gitignored — see data/oib/README.md for how to "
        "fill this directory. This harness is an opt-in local tool; it is not run in CI, "
        "because no CI checkout can have a corpus."
    )


def measure_structure(
    index: ClauseIndex,
    corpus_dir: Path | None = None,
    cache_dir: Path | None = None,
) -> StructureReport:
    corpus_dir = default_corpus_dir() if corpus_dir is None else corpus_dir
    _require_corpus(index, corpus_dir)

    per_guideline: dict[str, dict[str, ArmStructure]] = {}
    unlocated: dict[str, list[str]] = {}
    located = 0
    parents = 0
    for richtlinie in index.guidelines:
        file_name = index.file_name(richtlinie)
        pdf_path = corpus_dir / file_name
        pages = extract_pages(pdf_path, cache_dir=cache_dir)
        results, located_here, parents_here, missing = measure_document(
            index, richtlinie, pages, file_name, pdf_path.stat().st_size
        )
        per_guideline[richtlinie] = results
        located += located_here
        parents += parents_here
        if missing:
            unlocated[richtlinie] = missing

    totals = {arm: _sum_arms((row[arm] for row in per_guideline.values()), arm) for arm in (ARM_PAGE, ARM_CLAUSE)}
    return StructureReport(
        per_guideline=per_guideline,
        totals=totals,
        indexed_clauses=index.total_clauses(),
        located_clauses=located,
        structural_parents=parents,
        unlocated=unlocated,
    )
