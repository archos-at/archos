---
status: proposed
date: 2026-11-10
decision-makers: engineering
consulted: the country base knowledge design (v7, §4.6 and §5.5; edge cases E01, E02, E04, E25, E28, E40, E42, E47) and its build split (S15)
informed: everyone who reads an answer about the law of a site, and operators who publish a country's coverage
---

# A turn learns its country, coverage and editions from one knowledge context resolved in the BFF; builds on ADR-0158, ADR-0165, ADR-0168 and ADR-0171

## Context and Problem Statement

The platform holds countries as records (ADR-0165), says which edition binds
where through relations (ADR-0168), and which edition applied on a day
(ADR-0171). A turn read one part of it: the chain text of a project's Land,
behind `building-law-chain`. Nothing told the turn how far the records go.
An office entitled to Germany with nothing reviewed there would have read an
uncurated statute exactly like a curated Austrian one; an office not entitled
to Germany got no signal at all for its Munich project; a statute nobody had
checked for months still read as binding; and the HOAI read as binding by the
site, although it attaches to the office's seat.

The question: where does a turn learn which country, which coverage and which
editions apply, and what does it do when it cannot learn it?

## Decision Drivers

- Fail closed: an unknown office placement, site, country, coverage or a read
  that fails gives a refusal the answer can say, never a guess (design A1).
- One resolver, no country in code: adding a country adds records (ADR-0168).
- Flag off is today, byte for byte. (Amended by [ADR-0175](0175-the-cut-over-removes-the-austria-only-paths-and-their-switches.md): the switch and its off path are removed; the records are the only path.)
- Tenant isolation holds in the cache too: two offices never share a context.
- Licensed text never lands in our stores: the context is ids and tokens.
- The `knowledge` phase stays inside p95 ≤ 40 ms warm, ≤ 150 ms cold (design §5.5).

## Considered Options

1. Let the agent decide coverage from what retrieval returns.
2. A coverage table beside the records, edited by operators.
3. Coverage as a claim on a territory's revision, released like every other
   platform claim, and one knowledge context per turn resolved in the BFF from
   Postgres and carried in the turn context.

Option 1 is rejected on the premise that retrieval cannot tell an uncurated
statute from a curated one: chunks carry no coverage, and an empty result reads
the same as "not entitled". Option 2 is rejected on the premise that coverage
changes only with what was reviewed: a table operators edit would move apart
from the records it describes, and would have no review, release or rollback
of its own.

## Decision Outcome

Chosen option 3.

- **Coverage is a claim** (migration 0213): `knowledge_territory_revisions.coverage_level`
  (`none`, `open`, `core`, `full`) and `municipal_law`. Proposed, reviewed and
  released through a change request, so only a publish changes it and a
  rollback takes it back (design §4.6). A node without one inherits from the
  nearest node of its own country; a union never lends its coverage to a
  member; none at all reads `none`. A claim nobody stated is no claim a
  reviewer has to decide, so older proposals review as they did.
- **A work's connecting factor** (`knowledge_work_revisions.connects_by`:
  `site`, `office_seat`, `client`). A work that attaches to anything but the
  site is `information` with the label `depends_on_connecting_factor` (E40).
- **The gate** (`bff/base-knowledge/context/resolve.ts`), weakest first:
  `organization_unplaced` (no home country, E47), `site_unknown` (`no_site`
  or `no_territory`, E04), `not_entitled` (E01), `knowledge_unavailable`,
  then the coverage of the weakest leaf. Only `open` or better carries uses.
- **Coverage shapes the role.** At `open` a binding role is `uncurated`
  (label `uncurated_source`, E02) and every other role is information.
- **Freshness degrades the label** (`PLATFORM_FRESHNESS_DAYS`, ADR-0165): past
  its kind's target `check_overdue`; past twice the target, or never checked,
  `unchecked_since`, and an uncurated binding edition becomes information (E28).
  A check that found a newer edition is `newer_known`, a withdrawn one `superseded`.
- **Retrieval follows the gate.** The context names the countries whose
  shared-corpus chunks the turn may read: the site's country and the unions
  its chain reaches; every entitled country while the site is unknown; none
  when not entitled, unplaced or unavailable.
- **Packs and their sequence.** Each pack the turn read with its newest stable
  release sequence, so a running research turn can pin them (E42) and an
  answer can record them.
- **Carried in the turn context** (`/api/internal/turn-context`,
  `knowledgeContext`) behind the rollout flag `knowledge-context` (removed by
  ADR-0175: every turn carries it, `knowledge_unavailable` when unreadable). With it off
  the key is absent, nothing is read and no phase is timed. With it on the
  phase is timed as `knowledge` in `Server-Timing`.
- **The flag reads off when WorkOS cannot be asked** (`isOrgFeatureEnabled`
  treats a failed lookup as off). A turn then runs the path before this ADR,
  which still gates the Austrian corpus and the legal database on the site
  (ADR-0158); it does not fall open to "everything applies". The four
  operations stay in the agent catalog whatever the flag says, because
  exposure is one static file for every office (`exposure.json`); with the flag
  off each route answers the stable-coded 403 of `requireFeature`, so an agent
  learns the capability is off for this office rather than calling a dead
  route. Hiding an operation per office would need per-office exposure, which
  nothing else needs yet.
- **The prompt reads the gate.** With the context bound, the turn context's
  jurisdiction note is the gate's (`knowledge_context.gate_note`): unplaced
  office, unknown site, not included, unavailable, no base, open coverage, and
  "the base moved since the last answer". A gate that withholds law renders no
  OIB verdicts and refuses the legal-database tools
  (`knowledge_context.law_tools_allowed`), even while the entitled corpus stays
  readable for an unknown site (E04); core and full read as the flag off does.
- **Cached per office and project.** The cheap inputs (placement,
  entitlements, site facts, pack sequences, the day, the procedure) make a
  digest, with a stamp of the office's newest record revision and the
  platform's newest edition check, since neither moves a pack sequence; the
  resolved context is cached under
  `knowledge-context-v<N>:<org>:<project>:<digest>` (the version moves with the cached shape), so a publish or a moved site
  is read on the next turn, and two offices with equal digests get two keys
  (`context/service.spec.ts`).
- **Failure.** A read that throws gives `knowledge_unavailable`: retrieval,
  law lookup and classification are withheld, documents still answer, and the
  BFF logs `knowledge_context_available=false`, the line the alert reads.
  Only a chat turn's failed read counts toward `knowledge_context.unavailable`
  and logs that line; an operation's (`project-base-get`, `-confirm`) and a
  page's (the Steckbrief) answer `knowledge_unavailable` and log
  `knowledge_context_page_read=false` instead (amended by ADR-0175), so a page
  polling an outage does not fire the alert.
- **Server-side record.** `message_edition_uses` holds which edition an answer
  used, in which role and at which pack sequences, keyed by its organization,
  append-only and gone only with its message (E25); `project_base_confirmations`
  holds a confirmed Steckbrief the same way.
  The BFF writes the uses when it persists the backend's answer
  (`context/edition-uses.ts`): role, edition and sequences from the context
  the turn was answered on, kept per conversation when the turn loaded it
  (`context/turn-snapshot.ts`), never one resolved at persist time, so a
  release landing mid-turn is not recorded as what the answer read; the
  backend's cited file names only choose among them.
- **Writes go on the person's yes.** `project-base-confirm` and
  `base-knowledge-report` are `personDecides`: the report reaches a platform
  reviewer outside the office, so an agent cannot file one on its own.
- **The base moved (E42).** The turn context names the packs released since
  the conversation's newest recorded answer (`updatedSinceLastAnswer`), read
  per conversation after the cache, so the answer can say "Grundlage seit der
  letzten Antwort aktualisiert".
- **The shared corpus carries its country** (audit of #1559, item 1). A
  base-corpus chunk carries `country_id` and `knowledge_edition_id`, from the
  published copy the platform's indexing job re-ingests (`oib_corpus_marks`);
  `knowledge_search` reads only the countries the gate allows
  (`base_corpus_country_filter`), a chunk written before the field as Austrian.
  A rollback that leaves a text unreleased marks its chunks `ZZ`, which no
  office reads. (Amended by country-as-data row 7: it marks them
  `released: false` and keeps their country; `ZZ` stays readable by nobody on
  the points a rollback marked before the flag.) With the edition on the chunk, a search can read one edition's
  text (`filters={"knowledge_edition_id": …}`), the id from
  `base-knowledge-edition-as-of`; the tool's description says so with the
  country-neutral prompt, so the flag-off request stays as it was.
- **Coverage claims on the website are generated** from the packs' coverage
  (`scripts/check_coverage_copy.py`, the `coverage-copy` hook): the building-law
  page names a country's law only once its pack states `open` or better.
- **Edge cases as data.** `evals/base-knowledge/edge_cases.yaml` holds the
  design's E-fixtures as paper records; `context/edge-cases.spec.ts` runs each
  through the resolver a turn uses.

### Consequences

- Good: an answer can say "not set up for Germany", "official source, not
  reviewed" and "overdue for a check" from data, and a country moves from
  `open` to `core` by a reviewed publish, not a deploy.
- Good: the agent reads one context instead of re-deriving the site in Python.
- Bad: reference dates (Stichtage) are `undetermined` in the context until the reference-date
  rules are read here; the as-of route (ADR-0171) answers them meanwhile.
- Bad: one leaf per site for now; multi-leaf sites (`undetermined: multi_leaf`) come with point sites.

### Confirmation

`context/edge-cases.spec.ts` (E01, E02, E04, E28, E40, E47 and two controls,
each failing when its rule is removed), `context/service.spec.ts` (flag off
reads nothing; equal digests, two keys; a failed read is
`knowledge_unavailable`), the turn-context route spec (no key with the flag
off), `vocab.spec.ts` (the CHECKs list the vocabularies), the element ledger,
and `scripts/rls-test-db.sh` (0213's CHECKs, RLS on both tables, down and up).

## More Information

- Design: `docs/design/international/design.md` §4.6, §5.4, §5.5 (branch `claude/intl-design`).
- Code: `apps/workspace/bff/base-knowledge/context/`.
