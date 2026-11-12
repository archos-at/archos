---
status: proposed
date: 2026-11-10
decision-makers: engineering
consulted: the country base knowledge design (v7, §3.4, §3.5, §5.5 and §8.3) and its build split (S8); the OIB's table of in-force dates (Stand Oktober 2026)
informed: the slices that read a site's law (S9 setup facts, S11 time and editions, S15 turn context, S16 Germany)
---

# Which edition binds where is a route through relation records, and Austria is the first pack

## Context and Problem Statement

Which edition of the OIB-Richtlinien binds a project was prose in the static
system prompt and a guess in `citations/binding.py` (a host regex, a filename
prefix, a Dokumentart): every OIB-Richtlinie counted as "declared binding" in
every Land. Defect 7 of `docs/design/international/design.md` §2.2: the 2023
edition is guidance in Steiermark, Vorarlberg and Burgenland, which bind the
2019 edition, Oberösterreich binds RL 6 in its 2019 edition, Salzburg has
adopted no RL 6 since 2015, and Tirol and Wien bind RL 6 in its 2025 edition,
Tirol without Pkt 2.2 and 2.3.1. Defect 6: the static `<building_law>` block,
Austria's chain, applied to every turn, a German project's or one with no site.

The platform's records (ADR-0163, ADR-0165) held works, editions and copies
but nothing that said how one instrument makes another binding. Until that is
data, Austria is code and a second country is code again.

## Decision Drivers

- A role is computed from a route, never stored or set by an owner (design §3.5).
- Adding a country adds records, never a branch: no country in the resolver.
- Answers for Austrian projects stay what they were where nothing should change,
  and that is proven, not assumed (byte-identical prompt blocks, the same
  status on every source with the flag off). (Amended by [ADR-0175](0175-the-cut-over-removes-the-austria-only-paths-and-their-switches.md): the switch and its off path are removed; the records are the only path.)
- Fail closed: an edition a relation names that is not in the graph, a law out
  of force at the date, an unknown role, a graph that hit its bound: no use.
- No free text from records reaches a prompt (design §3.7).
- A record of another pack is read only where a released relation reaches it.

## Considered Options

1. Keep the adoption per Land in prose: the static prompt and the registry's `binding_note`.
2. A `binding_edition` column per work and Land.
3. Relation records (`makes_binding`, `supersedes`, `deviates_from`, `interprets`),
   one resolver that follows them, and the chain text derived from what it found.

Option 1 is rejected on the premise that the model reads which edition binds
from prose reliably enough and nothing else needs it; the citation chip and
the setup checklist need it as data, and the static prompt cannot say it per
Land without growing past its budget. Option 2 is rejected on the premise that
binding is one hop: in Germany a norm binds through the BayTB, which a Land law
declares (design §3.5), and in Tirol an adoption excludes clauses, which a
column per Land cannot say.

## Decision Outcome

Chosen option 3.

**Relations are records** (migration 0211): one `from` and one `to` (a work or
an edition), a type, a mode for `makes_binding` (`declared`, `static_reference`,
`dynamic_reference`), paired AKN anchors, the provision, and a half-open
interval. Append-only like every body; a platform relation names platform
records only (the cross-owner trigger, now over both ends). Every kind of
design §3.5 joins the work-kind CHECK; an office still holds its five. A
territory gets dated parents: `AT` lies in `EU` from 1995-01-01.

**One pure resolver** (`apps/workspace/bff/base-knowledge/chain/resolve.ts`):
law binds in its territory while in force; everything else binds only through
a `makes_binding` route from something binding, followed to depth eight, each
instrument once, into any pack; a directive, a commentary and an authority
directive never bind; `deviates_from` displaces clauses; without a route a
norm's newest edition guides and its older ones are information. One graph for
both owners: a route through an office relation is `office_maintained`, and a
platform relation on the same target and anchors displaces it.

**Reads.** The `EU` pack follows any entitled member (a released territory
record naming `EU` as a dated parent whose interval has not ended today: a
membership with a `validTo` in the past entitles nothing). A record of another pack is readable
where a released platform relation reaches it from one the office may read
(`knowledge_reached_by_relation`, SECURITY DEFINER, walking backwards from the
record); a rollback of the relation withdraws it. Amended 2026-11-12 (migration
0236): walking back from every row was not cheap. An office entitled to little
of the corpus ran the walk once per hidden platform row, again inside each
revision table's policy, and paid seconds per read; the entitlement check ran
per row too, half a million times in one chain spec. The policy and
`recordReadable` now read two sets: `knowledge_entitled_countries()`, and
`knowledge_reached_ids()`, the same reach walked forward from the entitled
records a step can leave from. Each is built once per subplan that needs it
(two to four in a query) rather than once per row;
`visibility.integration.spec.ts` holds both to the per-row functions.

**Austria is pack 1, the EU pack 0.** `configs/knowledge-packs/{eu,at}.json`
are proposals in the records format, generated once from the OIB's own table
of in-force dates and checked Land by Land against it in `chain/packs.spec.ts`.
They enter as change requests through `records-propose`, reviewed, approved
and published like any platform change; the repository has no seed path. A
file holds the records, not their sources: ADR-0170's KC-6 asks each record
for a capture of its own change request and a quote from it, so the person
proposing a pack captures the OIB's table and each Land's page first.
`packs.spec.ts` holds every other check and pins that KC-6 is all that is left.

**The turn.** Behind the `building-law-chain` flag (removed by ADR-0175: every turn now) the turn context carries the
chain text and each edition's role, since ADR-0175 inside the knowledge context
(`knowledgeContext.text` and its `uses`, in the roles the context corrects:
one payload, never a second `buildingLaw` beside it). The agent renders the
`<building_law>` block in the turn context only once the static prompt no
longer holds it (`agent/turn/building_law.py`): the records' chain before the
standing doctrine, or for an Austrian site without records the bundled block,
byte for byte the static prompt's; any other site reads none and keeps its
jurisdiction note. A cited base-corpus passage maps to its edition by its
corpus file (the id map is the manifestation's `corpus_file`), and its role
decides the citation chip's status (`citations/roles.py`). Without the flag
every source keeps the status `binding.py` gave it.

**Order of release.** Deploy this; enable the flag per organization once the
packs are published; then publish the country-neutral static prompt
(`chat_static.md` without `<building_law>`, `task prompts:push -- --apply`,
a person runs it). Rollback is the Langfuse label: the block returns to the
static prompt and the turn adds nothing.

### Consequences

- Good: a second country is records. Defect 7 is fixed in data, with the OIB's
  dates; defect 6 is fixed once the neutral static prompt is published.
- Good: the role on a source and the chain text the model reads come from the
  same resolution.
- Neutral: the Qdrant payload gains no `work_id` or `territory_ids` here. The
  element ledger refuses a field with no reader, and nothing filters by them
  until the turn context's retrieval filter (S15); the edition is already the
  office mark's `knowledge_edition_id`, and the base corpus maps through the
  records. S15 adds the fields with their reader, and a base-corpus ingest job
  must then carry them, because `oib_sync` builds its job from the file alone.
- Bad: the relation rows per Land are many (134 for Austria). They are data a
  reviewer checks against one table, not code.
- Bad: today's date is the office's time zone, not the legislating node's,
  until territories carry one (S11).

### Confirmation

`chain/resolve.spec.ts` (every kind, displacement, precedence, cross-pack,
dated membership, depth and cycles), `chain/packs.spec.ts` (each Land against
the OIB's table), `chain/chain.integration.spec.ts` against Postgres through
the runtime role (publish through the change-request flow, entitlement, reach
and its rollback, append-only and cross-owner), `tests/turn/test_building_law_block.py`
and the byte-identity tests beside the static prompt, `tests/citations/test_roles.py`.

## More Information

Design `docs/design/international/design.md` (branch `claude/intl-design`)
§3.5 and §8.3; build split S8. The OIB's in-force table:
<https://www.oib.or.at/kernaufgaben/oib-richtlinien/#inkrafttreten>.
