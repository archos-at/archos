"""What a web search may hand the agent as a source about law (ADR-0175).

Since the cut-over only the platform's records say which edition binds where, and the knowledge base is
where a norm's text is read. QC on staging found the web filling both gaps: an OIB-Richtlinie cited from a
vendor's copy (propellets.at) and from oib.or.at instead of the corpus copy, and the binding edition taken
from the product's own marketing glossary. So a web search drops two kinds of hit before the model sees
them, and says what it dropped:

- a page on the product's own domains (``brand.PRODUCT_DOMAINS``, from ``identity.json``): our marketing
  site is no source for law;
- a web copy of a norm the knowledge base holds: a PDF whose file name or title names an OIB-Richtlinie
  the corpus holds (``inventory.get_norm_families``; every one when the turn's inventory names none). Its
  text is in the knowledge base, citable with page and edition.

Every result also carries one line saying web content is unverified information, never a requirement or
a binding edition: the gate's note says the same (``knowledge_context.WEB_IS_INFORMATION``).
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from urllib.parse import urlparse

#: An OIB-Richtlinie named in a file name or a title: ``oib-rl_2_ausgabe_mai_2023.pdf``, ``OIB-RL2.pdf``,
#: ``OIB-Richtlinie 2.2``. The number is captured; its family is the part before the dot.
_OIB_NORM_RE = re.compile(r"oib[-_\s]*(?:rl|richtlinie)[-_\s]*(\d+(?:\.\d+)?)", re.IGNORECASE)

#: Said above every web result the agent reads.
WEB_RESULT_NOTE = (
    "Web results are unverified information: none is a requirement for this project or names which edition "
    "binds; the building-law block and the knowledge base say that."
)


@dataclass(frozen=True)
class Withheld:
    """What a web search did not hand on, and why, for the line the agent reads instead."""

    url: str
    reason: str


def _host(url: str) -> str:
    return (urlparse(url).hostname or "").lower()


def is_product_site(url: str) -> bool:
    """Whether ``url`` is on one of the product's own domains, or a subdomain of one."""
    from agent.common.brand import PRODUCT_DOMAINS

    host = _host(url)
    return any(host == domain or host.endswith(f".{domain}") for domain in PRODUCT_DOMAINS)


def _held_families() -> frozenset[str] | None:
    """The OIB family keys the turn's base shelf holds; None when the turn's inventory names none."""
    try:
        from agent.knowledge.inventory import get_norm_families
    except ImportError:  # a standalone distribution without the agent's knowledge package
        return None
    families = get_norm_families()
    return frozenset(str(family.key) for family in families) if families else None


def held_norm_copy(url: str, title: str | None) -> str | None:
    """The norm a web PDF is a copy of, when the knowledge base holds it (``OIB-Richtlinie 2``); else None."""
    path = urlparse(url).path.lower()
    if not path.endswith(".pdf"):
        return None
    match = _OIB_NORM_RE.search(path.rsplit("/", 1)[-1]) or _OIB_NORM_RE.search(title or "")
    if match is None:
        return None
    held = _held_families()
    if held is not None and match.group(1).split(".")[0] not in held:
        return None
    return f"OIB-Richtlinie {match.group(1)}"


def withheld_reason(url: str, title: str | None) -> str | None:
    """Why a web hit is not handed on as a source, or None to hand it on."""
    if is_product_site(url):
        return "the product's own site is no source for law"
    norm = held_norm_copy(url, title)
    if norm is not None:
        return f"a web copy of {norm}, whose text the knowledge base holds: search the knowledge base for it"
    return None


def screen(results: Iterable[dict]) -> tuple[list[dict], list[Withheld]]:
    """The hits a web search hands on, and the ones it withheld with their reasons (reads the turn's inventory)."""
    kept: list[dict] = []
    withheld: list[Withheld] = []
    for doc in results:
        url = str(doc.get("url") or "")
        reason = withheld_reason(url, doc.get("title")) if url else None
        if reason is None:
            kept.append(doc)
        else:
            withheld.append(Withheld(url=url, reason=reason))
    return kept, withheld


def preamble(withheld: list[Withheld]) -> str:
    """The lines above a web result: what web content is, and what this search did not hand on.

    The withheld pages are named by their reason, never by their address: a URL in a tool result is
    something the citation extractor registers, and a dropped page must not come back as a source.
    """
    lines = [WEB_RESULT_NOTE]
    lines.extend(f"Not shown: {reason}." for reason in dict.fromkeys(item.reason for item in withheld))
    return "\n".join(lines) + "\n\n---\n\n"
