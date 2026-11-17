"""The tool description the model reads, written from the source record.

Which source, in which language its questions come, how its texts cite a
provision, which territories its filter knows and which collections the
``application`` argument may name: every one of those is the record's. The
argument names are the tool's own and do not change with the source.
"""

from __future__ import annotations

from urllib.parse import urlparse

from agent.knowledge.law_lookup.source import LawSource

_KIND_WORDS = (
    ("case_law", "case law"),
    ("gazette", "the authentic gazettes"),
    ("draft", "drafts"),
    ("decree", "decrees"),
)


def _ids(law: LawSource, kind: str) -> str:
    return "/".join(f'"{c.id}"' for c in law.lookup.collections if c.kind == kind)


def _collections_line(law: LawSource) -> str:
    """The non-statute collections by kind, as the ``application`` argument takes them."""
    parts = [f"{ids} for {words}" for kind, words in _KIND_WORDS if (ids := _ids(law, kind))]
    return ", ".join(parts)


def _document_host(law: LawSource) -> str:
    access = law.access
    operation = access.operation(law.lookup.document)
    return urlparse(operation.base_url or access.config.base_url).hostname or law.source.hosts[0]


def describe(law: LawSource) -> str:
    """The whole description: what the tool answers, its arguments, and what it returns."""
    wording = law.wording
    name, word = wording.source, wording.subdivision
    sign, plural = law.section_sign, law.section_plural
    units = "/".join(unit.forms[0] for unit in law.lookup.locus.units)
    choices = law.lookup.territory.choices[:2] if law.lookup.territory else ()
    examples = ", ".join(f'"{choice}"' for choice in choices)
    conjunction = law.lookup.locus.conjunctions[0] if law.lookup.locus.conjunctions else ","
    work = wording.example_work
    return f"""Answers a legal question from {name} ({law.source.title}) with the actual provisions, \
quotable and citable: the statutes of the state and of each {word}, building codes among them, and court \
decisions. The office's uploads and the technical guidelines in the knowledge base are in knowledge_search, \
not here.

One call covers the whole path: it reads the address out of the question ({units}, the named law, the \
{word}), takes the verified catalog pointer or searches {name} live, downloads at most two documents and \
cuts the provisions that answer the question out of them. No document number is passed.

Args:
    question (str): The legal question, in {wording.language or law.lookup.language}, as the user means it, \
not a search string.
    conclusion (str): Optional. One line on what you are looking for; no effect on the call.
    jurisdiction (str): The {word} ({examples}, …). When omitted it is taken from the instrument, the \
question, then the project's site, and the answer states which.
    instrument (str): An address: "{work}", "{sign} 63 {work}", a {name} document number or a \
{_document_host(law)} URL. Naming a {sign} makes the lookup deterministic: the provision is cut out by its \
number. Up to six in one call ("{plural} 75 {conjunction} 81 {work}"); past six it names those it did not read.
    application (str): Only for the non-statute collections: {_collections_line(law)}. Empty for statute law.
    as_of (str): Optional YYYY-MM-DD: the version in force on that day (e.g. the filing day of a \
submission). A past day is read only from {name} version documents of that day, a miss rather than today's \
text; today or a later day reads today's text, and says so.

Returns:
    str: Numbered passages, each with Source, Dokumentart, Punkt, a Citation key to copy verbatim, and the \
provision's text. A miss says what was searched, which {word} was assumed and where that came from, what \
matched but was not read, and one concrete retry."""
