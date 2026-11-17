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

WEB_RESULT_NOTE = (
    "Web results are unverified information: none is a requirement for this project or names which edition "
    "binds; the building-law block and the knowledge base say that."
)

SOURCE_NOTE_KEY = "source_note"

DOCUMENT_SUFFIXES = (".pdf", ".docx", ".doc", ".odt", ".rtf")

_MIN_SINGLE_TOKEN_CHARS = 8

_TOKEN_RE = re.compile(r"\d+(?:\.\d+)*[a-z]?|[^\W\d_]+")

Where = Literal["knowledge_base", "legal_database"]


@dataclass(frozen=True)
class Withheld:

    url: str
    reason: str


@dataclass(frozen=True)
class HeldWork:

    designation: str
    where: Where
    names: tuple[tuple[str, ...], ...] = ()
    files: frozenset[str] = frozenset()
    country: str | None = None


@dataclass(frozen=True)
class Assessment:

    withheld: str | None = None
    note: str | None = None
    work: str | None = None


KEEP = Assessment()


def tokens(text: str) -> tuple[str, ...]:
    return tuple(_TOKEN_RE.findall(text.casefold()))


def host_of(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").rstrip(".").lower()
    except ValueError:
        return ""


def on_host(host: str, hosts: Iterable[str]) -> bool:
    return any(host == known or host.endswith(f".{known}") for known in hosts)


def is_product_site(url: str) -> bool:
    from agent.common.brand import PRODUCT_DOMAINS

    return on_host(host_of(url), PRODUCT_DOMAINS)




@dataclass(frozen=True)
class SourceHosts:

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
    return _repository_sources() + _turn_sources()


def _repository_sources() -> tuple[SourceHosts, ...]:
    try:
        from public_sources.source import sources_dir

        return _sources_under(str(sources_dir().resolve()))
    except Exception:  # noqa: BLE001 - a search must not fail because a record did not load
        logger.warning("web_sources: the source records could not be read; no host is known as a copy", exc_info=True)
        return ()


def _turn_sources() -> tuple[SourceHosts, ...]:
    from agent.common.knowledge_context import turn_knowledge_context

    return tuple(
        SourceHosts(
            title=str(source.config.get("title") or source.key),
            country=source.country,
            hosts=tuple(source.config.get("hosts") or ()),
            copy_hosts=tuple(source.config.get("copy_hosts") or ()),
        )
        for source in turn_knowledge_context().sources
    )


def _registry_hosts() -> set[str]:
    from agent.common.norm_registry import load_registry

    registry = load_registry()
    entries = registry.entries if registry is not None else ()
    return {host_of(url) for entry in entries for url in (entry.citation_url, entry.full_law_url, entry.source_url)}


_ELI = "eli"


def own_source_hosts() -> frozenset[str]:
    from agent.common.knowledge_context import turn_knowledge_context

    hosts = {host for source in configured_sources() for host in source.hosts} | _registry_hosts()
    for use in turn_knowledge_context().uses:
        hosts.update(
            host_of(ref.value)
            for ref in use.source_refs
            if ref.scheme == _ELI and ref.value.lower().startswith("https://")
        )
    return frozenset(host for host in hosts if host)


def is_own_source(url: str) -> bool:
    return on_host(host_of(url), own_source_hosts())


def _names(*values: str | None) -> tuple[tuple[str, ...], ...]:
    runs = (tokens(value) for value in values if value)
    return tuple(dict.fromkeys(run for run in runs if len(run) > 1 or (run and len(run[0]) >= _MIN_SINGLE_TOKEN_CHARS)))


def _context_works() -> Iterator[HeldWork]:
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
    designation = title.split(",", 1)[0].strip()
    return HeldWork(
        designation=designation,
        where="knowledge_base",
        names=_names(designation),
        files=frozenset({file_name.rsplit("/", 1)[-1].lower()}),
    )


def _shelf_works() -> Iterator[HeldWork]:
    try:
        from agent.common.norm_registry import guess_display_title
        from agent.knowledge.inventory import get_norm_families
    except ImportError:  # a standalone distribution without the agent's knowledge package
        return
    file_names = [file_name for family in get_norm_families() or () for file_name in family.files]
    titled = ((file_name, guess_display_title(file_name)) for file_name in file_names)
    yield from (_shelf_work(file_name, title) for file_name, title in titled if title)


def _registry_works(sources: tuple[SourceHosts, ...]) -> Iterator[HeldWork]:
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
    works: list[HeldWork] = []
    for collect in (_context_works, _shelf_works, lambda: _registry_works(configured_sources())):
        try:
            works.extend(collect())
        except Exception:  # noqa: BLE001 - one unreadable record set never fails a search
            logger.warning("web_sources: a set of held works could not be read", exc_info=True)
    return tuple(works)




def contains_run(haystack: tuple[str, ...], run: tuple[str, ...]) -> bool:
    width = len(run)
    return any(haystack[start : start + width] == run for start in range(len(haystack) - width + 1))


def named_work(url: str, title: str | None, works: Iterable[HeldWork]) -> HeldWork | None:
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
    return assess(url, title).work


def screen(results: Iterable[dict]) -> tuple[list[dict], list[Withheld]]:
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
    lines = [WEB_RESULT_NOTE]
    lines.extend(f"Not shown: {reason}." for reason in dict.fromkeys(item.reason for item in withheld))
    return "\n".join(lines) + "\n\n---\n\n"


def score_withheld(count: int) -> None:
    from agent.observability.langfuse_scores import RuntimeScore
    from agent.observability.langfuse_scores import emit_scores

    emit_scores([RuntimeScore("web-sources-withheld", float(max(0, count)))], writer="web-search")
