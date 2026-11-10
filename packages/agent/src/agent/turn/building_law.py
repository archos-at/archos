"""The ``<building_law>`` block of the turn context (ADR-0168, defect 6).

Until now the Austrian chain stood in the static system prompt, so every turn
read it: a German project, an unplaced one, a question about a meeting. The
block now belongs to the turn, and only where a site is Austrian or the
platform's records resolved one:

- **The static prompt still holds ``<building_law>``** (the version Langfuse
  serves today): nothing is added, and the turn context is byte for byte what
  it was. The country-neutral static push (S3) is what switches this on.
- **The records resolved the site** (the `building-law-chain` flag,
  ``citations/roles.py``): the block opens with the chain text the BFF
  rendered from kinds and relations, then the doctrine that holds for any
  chain.
- **No records, an Austrian site:** the bundled block, unchanged
  (``turn/building_law.md``), so an Austrian project reads after the push
  exactly what it read before it.
- **Any other site, or none stated:** no block; the jurisdiction note says
  what is not covered (``country_profile.site_note``).

Pure, and read from disk once per process.
"""

from __future__ import annotations

import functools
from pathlib import Path

from agent.common import load_prompt
from agent.common.country_profile import resolve_site

#: The block lives beside this module: it is turn context, not the static prompt.
PROMPTS_DIR = Path(__file__).parent

#: The bundled block: the Austrian chain and its doctrine, as the static prompt held them.
BUILDING_LAW_FILE = "building_law.md"
#: What marks the block, in the static prompt and in the turn context.
BUILDING_LAW_TAG = "<building_law>"
#: Where the doctrine starts: every line after the opening paragraph is a bullet.
_DOCTRINE = "\n- "


@functools.cache
def bundled_building_law() -> str:
    """The bundled block, without its trailing newline."""
    return load_prompt(PROMPTS_DIR, BUILDING_LAW_FILE).rstrip("\n")


def with_chain(block: str, chain: str) -> str:
    """The block with its opening paragraph replaced by ``chain``. Pure."""
    head, _, doctrine = block.partition(_DOCTRINE)
    opening = head.split("\n", 1)[0]
    return f"{opening}\n{chain.strip()}{_DOCTRINE}{doctrine}"


def building_law_block(static_text: str, project_context: str | None, chain: str | None) -> str | None:
    """The block this turn reads, or None (module docstring)."""
    if BUILDING_LAW_TAG in static_text:
        return None
    if chain:
        return with_chain(bundled_building_law(), chain)
    if project_context and project_context.strip() and resolve_site(project_context).covered:
        return bundled_building_law()
    return None
