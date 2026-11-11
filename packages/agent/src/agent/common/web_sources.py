"""What a web search may hand the agent as a source about law (ADR-0175).

Since the cut-over only the platform's records say which edition binds where, the knowledge base is where a
norm's text is read, and a law is read from its own source (a legal database configured under
``configs/sources/``). The web filled all three gaps on staging and dev: a guideline cited from a vendor's
copy, the binding edition taken from the product's own marketing glossary, a paragraph of state law cited
from two mirror sites while the legal database was not read. So a web search screens every hit before the
model sees it, and says what it did.

Nothing here names a country, a site or a file-name convention. What is a work's own source and what is a
copy is read from data:

- **the source records**, read in one place (:func:`configured_sources`, through ``public_sources``'
  loader): ``hosts`` are a source's own, ``copy_hosts`` republish it. The agent has no reader of the
  platform's source records yet (the BFF's ``source-service`` has no Python counterpart): when a source
  moves there, this one function changes, and until it does an unreadable record set means no host is
  known as a copy, never a failed search;
- **the works the turn holds**, each with its designation: the editions of the turn's knowledge context
  (``knowledge_context.EditionUse``: designation, corpus files, legal-database identities), the documents of
  the base shelf (``inventory.get_norm_families``) and the laws the norm registry points at in a legal
  database (``norm_registry``, ``configs/norms/``).

A hit is then one of:

- **withheld** (not handed on, the reason said without its address): a page on the product's own domains
  (``brand.PRODUCT_DOMAINS``); an address that may not be shown as a source (``url_safety``: not https, a
  local or internal host); a copy on a source's ``copy_hosts`` while that source can be read this turn; a
  document (:data:`DOCUMENT_SUFFIXES`) that is a copy of a work the knowledge base holds;
- **labelled** (handed on with a ``source_note`` the tool prints): a copy on ``copy_hosts`` while the source
  cannot be read this turn, so the answer can say what it rests on; a page on any other host that names a
  held work, which is a page about the work and never its text;
- **kept** as it is: everything else, a source's own host included.

Every result also carries one line saying web content is unverified information, never a requirement or
a binding edition: the gate's note says the same (``knowledge_context.WEB_IS_INFORMATION``).
"""

from __future__ import annotations

import functools
import logging
import re
from collections.abc import Iterable
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Literal
from urllib.parse import unquote
from urllib.parse import urlparse

from agent.common.url_safety import host_problem

logger = logging.getLogger(__name__)

#: Said above every web result the agent reads.
WEB_RESULT_NOTE = (
    "Web results are unverified information: none is a requirement for this project or names which edition "
    "binds; the building-law block and the knowledge base say that."
)

#: The key a labelled hit carries its note under; the search tool prints it inside the hit.
SOURCE_NOTE_KEY = "source_note"

#: File types that are a document's own bytes: a hit of one that names a held work is a copy of it, where
#: an HTML page naming the work is a page about it.
DOCUMENT_SUFFIXES = (".pdf", ".docx", ".doc", ".odt", ".rtf")

#: A name too short to identify a work on its own (one short word) matches nothing.
_MIN_SINGLE_TOKEN_CHARS = 8

_TOKEN_RE = re.compile(r"\d+(?:\.\d+)*[a-z]?|[^\W\d_]+")

Where = Literal["knowledge_base", "legal_database"]


@dataclass(frozen=True)
class Withheld:
    """What a web search did not hand on, and why, for the line the agent reads instead."""

    url: str
    reason: str


@dataclass(frozen=True)
class HeldWork:
    """A work whose text the turn can read from its own source, as the records name it."""

    designation: str
    where: Where
    #: The names a page may call it by, as token runs (designation, short title, aliases).
    names: tuple[tuple[str, ...], ...] = ()
    #: The knowledge base's file names for it, lower case.
    files: frozenset[str] = frozenset()
    #: The country whose legal database holds it; None for a knowledge-base work.
    country: str | None = None


@dataclass(frozen=True)
class Assessment:
    """What the screen makes of one hit: ``withheld`` (a reason), else ``note`` (a label), else nothing."""

    withheld: str | None = None
    note: str | None = None
    #: The work the hit copies or names, when it does.
    work: str | None = None


KEEP = Assessment()


def tokens(text: str) -> tuple[str, ...]:
    """``text`` as lower-case word and number tokens; ``2.2`` stays one token, so it never reads as ``2``."""
    return tuple(_TOKEN_RE.findall(text.casefold()))


def host_of(url: str) -> str:
    return (urlparse(url).hostname or "").rstrip(".").lower()


def on_host(host: str, hosts: Iterable[str]) -> bool:
    return any(host == known or host.endswith(f".{known}") for known in hosts)


def is_product_site(url: str) -> bool:
    """Whether ``url`` is on one of the product's own domains, or a subdomain of one."""
    from agent.common.brand import PRODUCT_DOMAINS

    return on_host(host_of(url), PRODUCT_DOMAINS)


# -- the records -----------------------------------------------------------


@dataclass(frozen=True)
class SourceHosts:
    """One configured source: whose law it holds, its own hosts and the hosts that republish it."""

    title: str
    country: str
    hosts: tuple[str, ...]
    copy_hosts: tuple[str, ...]


@functools.cache
def _sources_under(root: str) -> tuple[SourceHosts, ...]:
    from public_sources.source import load_sources

    return tuple(
        SourceHosts(title=source.title, country=source.territory[:2], hosts=source.hosts, copy_hosts=source.copy_hosts)
        for source in load_sources(root).values()
    )


def configured_sources() -> tuple[SourceHosts, ...]:
    """The source records, read once per process and directory; none when they cannot be read (logged)."""
    try:
        from public_sources.source import sources_dir

        return _sources_under(str(sources_dir().resolve()))
    except Exception:  # noqa: BLE001 - a search must not fail because a record did not load
        logger.warning("web_sources: the source records could not be read; no host is known as a copy", exc_info=True)
        return ()


def own_source_hosts() -> frozenset[str]:
    """The hosts a work's own text is read from: every configured source's, and the hosts the turn's records
    name for an edition (an identity that is an address, such as an ELI)."""
    from agent.common.knowledge_context import turn_knowledge_context

    hosts = {host for source in configured_sources() for host in source.hosts}
    for use in turn_knowledge_context().uses:
        hosts.update(host_of(ref.value) for ref in use.source_refs if ref.value.lower().startswith("https://"))
    return frozenset(host for host in hosts if host)


def is_own_source(url: str) -> bool:
    """Whether ``url`` is on a host a work's own text is read from (:func:`own_source_hosts`)."""
    return on_host(host_of(url), own_source_hosts())


def _names(*values: str | None) -> tuple[tuple[str, ...], ...]:
    """The token runs of ``values`` that can identify a work: two tokens, or one long one."""
    runs = (tokens(value) for value in values if value)
    return tuple(dict.fromkeys(run for run in runs if len(run) > 1 or (run and len(run[0]) >= _MIN_SINGLE_TOKEN_CHARS)))


def _context_works() -> Iterator[HeldWork]:
    """The editions the turn's knowledge context holds a text of: in the knowledge base or a legal database."""
    from agent.common.knowledge_context import turn_knowledge_context

    context = turn_knowledge_context()
    for use in context.uses:
        where: Where | None = "knowledge_base" if use.corpus_files else "legal_database" if use.source_refs else None
        if where is None or not use.designation:
            continue
        yield HeldWork(
            designation=use.designation,
            where=where,
            names=_names(use.designation),
            files=frozenset(name.rsplit("/", 1)[-1].lower() for name in use.corpus_files),
            country=context.site_country if where == "legal_database" else None,
        )


def _shelf_work(file_name: str, title: str) -> HeldWork:
    """A base-shelf document as a held work. Its display title is "<designation>, <edition>": a page names the first."""
    designation = title.split(",", 1)[0].strip()
    return HeldWork(
        designation=designation,
        where="knowledge_base",
        names=_names(designation),
        files=frozenset({file_name.rsplit("/", 1)[-1].lower()}),
    )


def _shelf_works() -> Iterator[HeldWork]:
    """The documents the turn's base shelf holds, each named by the display title its file resolves to."""
    try:
        from agent.common.norm_registry import guess_display_title
        from agent.knowledge.inventory import get_norm_families
    except ImportError:  # a standalone distribution without the agent's knowledge package
        return
    file_names = [file_name for family in get_norm_families() or () for file_name in family.files]
    titled = ((file_name, guess_display_title(file_name)) for file_name in file_names)
    yield from (_shelf_work(file_name, title) for file_name, title in titled if title)


def _registry_works(sources: tuple[SourceHosts, ...]) -> Iterator[HeldWork]:
    """The laws the norm registry points at in a configured legal database, by the host of the pointer."""
    from agent.common.norm_registry import load_registry

    registry = load_registry()
    for entry in registry.entries if registry is not None else ():
        host = host_of(entry.citation_url or entry.full_law_url)
        source = next((source for source in sources if host and on_host(host, source.hosts)), None)
        if source is None:
            continue
        yield HeldWork(
            designation=entry.title,
            where="legal_database",
            names=_names(entry.title, entry.short, *entry.aliases),
            country=source.country,
        )


def held_works() -> tuple[HeldWork, ...]:
    """Every work the turn can read from its own source, the knowledge context's first. Reads the turn's state."""
    works: list[HeldWork] = []
    for collect in (_context_works, _shelf_works, lambda: _registry_works(configured_sources())):
        try:
            works.extend(collect())
        except Exception:  # noqa: BLE001 - one unreadable record set never fails a search
            logger.warning("web_sources: a set of held works could not be read", exc_info=True)
    return tuple(works)


# -- one hit ---------------------------------------------------------------


def contains_run(haystack: tuple[str, ...], run: tuple[str, ...]) -> bool:
    width = len(run)
    return any(haystack[start : start + width] == run for start in range(len(haystack) - width + 1))


def named_work(url: str, title: str | None, works: Iterable[HeldWork]) -> HeldWork | None:
    """The held work a hit names: by a knowledge-base file name, or a designation in its title or address. Pure."""
    path = unquote(urlparse(url).path)
    file_name = path.rsplit("/", 1)[-1].lower()
    title_tokens, path_tokens = tokens(title or ""), tokens(path)
    for work in works:
        if file_name and file_name in work.files:
            return work
        if any(contains_run(title_tokens, run) or contains_run(path_tokens, run) for run in work.names):
            return work
    return None


def _law_readable(country: str | None) -> bool:
    """Whether the turn may read ``country``'s legal database (``knowledge_context.law_tools_allowed``)."""
    if not country:
        return False
    from agent.common.knowledge_context import law_tools_allowed

    return law_tools_allowed(country)


def _copy_host_assessment(source: SourceHosts) -> Assessment:
    if _law_readable(source.country):
        return Assessment(
            withheld=(
                f"a copy of law that {source.title} holds, on a site that is not the law's source: "
                "read the text with the legal-database lookup and cite that"
            ),
            work=source.title,
        )
    return Assessment(
        note=(
            f"A copy of law that {source.title} holds, on a site that is not the law's source. Information "
            "only: do not present it as the official text, and say that the official text was not read."
        ),
        work=source.title,
    )


def _named_work_assessment(url: str, work: HeldWork) -> Assessment:
    if work.where == "knowledge_base":
        if urlparse(url).path.lower().endswith(DOCUMENT_SUFFIXES):
            reason = f"a web copy of {work.designation}, whose text the knowledge base holds: search the knowledge base"
            return Assessment(withheld=f"{reason} for it", work=work.designation)
        note = f"Names {work.designation}, whose text the knowledge base holds: this page is not its source."
        return Assessment(note=f"{note} Cite the knowledge base for what it says.", work=work.designation)
    note = f"Names {work.designation}; this page is not the law's source. Information only."
    if _law_readable(work.country):
        note += " Read the text with the legal-database lookup and cite that."
    return Assessment(note=note, work=work.designation)


def assess(url: str, title: str | None, works: Iterable[HeldWork] | None = None) -> Assessment:
    """What the screen makes of one hit (module docstring). Reads the turn's records unless ``works`` is given."""
    if is_product_site(url):
        return Assessment(withheld="the product's own site is no source for law")
    problem = host_problem(url)
    if problem is not None:
        return Assessment(withheld=f"a page that cannot be cited: {problem}")
    if is_own_source(url):
        return KEEP
    host = host_of(url)
    copied = next((source for source in configured_sources() if on_host(host, source.copy_hosts)), None)
    if copied is not None:
        return _copy_host_assessment(copied)
    work = named_work(url, title, held_works() if works is None else works)
    return KEEP if work is None else _named_work_assessment(url, work)


def copied_work(url: str, title: str | None) -> str | None:
    """The work a web source copies or names instead of being its source, or None: what ``law-cited-from-web`` asks."""
    return assess(url, title).work


def screen(results: Iterable[dict]) -> tuple[list[dict], list[Withheld]]:
    """The hits a web search hands on (a labelled one with its ``source_note``), and the ones it withheld."""
    kept: list[dict] = []
    withheld: list[Withheld] = []
    works = held_works()
    for doc in results:
        url = str(doc.get("url") or "")
        found = assess(url, doc.get("title"), works) if url else KEEP
        if found.withheld is not None:
            withheld.append(Withheld(url=url, reason=found.withheld))
        else:
            kept.append({**doc, SOURCE_NOTE_KEY: found.note} if found.note else doc)
    return kept, withheld


def preamble(withheld: list[Withheld]) -> str:
    """The lines above a web result: what web content is, and what this search did not hand on.

    The withheld pages are named by their reason, never by their address: a dropped page must not come back
    as a source, whatever reads the text.
    """
    lines = [WEB_RESULT_NOTE]
    lines.extend(f"Not shown: {reason}." for reason in dict.fromkeys(item.reason for item in withheld))
    return "\n".join(lines) + "\n\n---\n\n"


def score_withheld(count: int) -> None:
    """Write ``web-sources-withheld`` for one search: how many hits it did not hand on, zero included."""
    from agent.observability.langfuse_scores import RuntimeScore
    from agent.observability.langfuse_scores import emit_scores

    emit_scores([RuntimeScore("web-sources-withheld", float(max(0, count)))], writer="web-search")
