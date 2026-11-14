"""``law_lookup``: one tool that answers a legal question with citable passages, from any law source.

The source is a record (``configs/sources/``, ADR-0162) whose ``lookup`` block
says how its texts cite a provision, which collections its search offers, how
a territory filters it and which words the tool writes back
(``public_sources.lookup``). Nothing here names a country: the stages below
read the record.

    source.py      the record as the lookup reads it: access, engine, grammar.
    locus.py       the record's citation grammar, compiled to regexes.
    address.py     the provision, the named law, the territory and where it came
                   from. Pure, deterministic, no I/O and no LLM.
    candidates.py  which documents to consider: the norm catalog first, a planned
                   live search second (cap 3).
    client.py      the requests: the record's search operation and a document URL.
    cache.py       the shared read-through cache and the ingest marker.
    fetch.py       downloading them, in parallel, through the cache (cap 2).
    sections.py    the provision grammar of a consolidated text, and the part cut.
    planner.py     the search planner, its choices the record's collections.
    picker.py      the one LLM call over HEADINGS only, when no provision was named.
    extract.py     which provisions answer the question (cap 6 across 2 documents).
    passages.py    a selected provision as the thing a reader cites.
    render.py      the grounding block those passages become.
    miss.py        what the tool says when it found nothing. Never empty.
    ingest.py      the full text into the session collection.
    telemetry.py   the per-round ledger and the retrieval span.
    description.py the tool description, from the record.
    tool.py        the config and the orchestration.
"""

from agent.knowledge.law_lookup.tool import LawLookupToolConfig
from agent.knowledge.law_lookup.tool import law_lookup

__all__ = ["LawLookupToolConfig", "law_lookup"]
