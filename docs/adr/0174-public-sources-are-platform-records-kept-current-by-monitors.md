---
status: proposed
date: 2026-11-10
decision-makers: engineering
consulted: the country base knowledge design (claude/intl-design, design.md §3.7, §4.1 to §4.5, §9b(b)) and its build split (S16)
informed: whoever onboards a country (operators and their agents), reviewers and counsel of platform knowledge, the turn-context slice that puts a site's advice policy into the prompt
---

# Public sources are platform records, kept current by monitors that open change requests

## Context and Problem Statement

After ADR-0170 an operator's agent could bring a country's territories, works
and rulesets in through the platform door, but not its sources. A public source
was a file under `configs/sources/` (ADR-0162): onboarding a country still
meant a git change, a review of that change and a deploy. Nothing noticed when a
source changed, so a country went stale silently. A ruleset could not carry
what a country says about legal advice or the words it uses, and nothing made
counsel look at an advice policy or a privacy reviewer at a source that receives
a site point.

The question this record answers: what the platform needs, country-neutral,
so that any country is onboarded and kept current through the door, with no
code and no deploy, and with the person's yes on every write that reaches
offices. Onboarding a real country (Germany first) is run elsewhere.

## Decision Drivers

- **A new country is data** (ADR-0162), now including its sources.
- **No egress to an unregistered host.** The allowlist must hold while code is
  wrong and an agent is creative.
- **Monitors open, people publish.** A monitor makes no model call and never
  moves what an office reads.
- **Fail closed on unknown**: an unchecked source, an expired testing window,
  an unreachable checker.
- **What a flag gates is unchanged while it is off**: the monitor sweep is
  behind `source-monitors`; the source records, operations and KC-7 are behind
  the existing `platform-base-knowledge`, and accept only inputs that were
  refused before; a request with neither an advice policy nor a site-keyed
  source is approved as before.
- **No free text from records reaches a prompt** (design §3.7).

## Considered Options

1. **Sources as platform records, the host allowlist read from them, monitors
   as a sweep that opens change requests** (chosen).
2. **Keep sources as repository files, the door opens a pull request.**
   Rejected: a pull request per source is the code path the foundation
   removes, and an agent opening pull requests against the product repository
   is a wider grant than a draft change request. Premise: the repository is the
   only reviewed store for sources; it stops holding once records carry review,
   four eyes and release (ADR-0165).
3. **A separate allowlist table the fetcher reads.** Rejected: a second copy
   of what the source records already say, which drifts; and the fetcher has
   no database connection (its NetworkPolicy allows DNS and public addresses
   only). Premise: the fetcher stays database-less.
4. **OWSLib for `ogc`.** Rejected: it makes its own requests through
   `requests`, around the guarded client every fetch must use. Premise:
   OWSLib offers no transport hook; the two reads `ogc` needs are each one GET.

## Decision Outcome

Chosen option 1, in migration 0212.

**A source is a platform record.** Record type `source`, platform only; its
body (`knowledge_source_revisions`) keeps the record whole (`config`, the shape
`public_sources.source.Source` validates) and lifts out what the database
decides on: hosts, data flow, monitor kind and interval, licence. It is
proposed with `records-propose`, cited like every record (KC-6), reviewed claim
by claim and released like every record. Its fixtures carry their recorded
responses inline. A repository record keeps working by its id as before, and a
configured source may not take a repository record's id.

**KC-7 runs in the package that owns the validator.** The kit asks the api
tier (`POST /v1/public-sources/check`): the record parses as its access type
and engine read it, every URL it names is on its hosts, every fixture passes
with no live call. Run before the request's lock; an api tier that cannot
answer is a problem, never a pass.

**The host allowlist is read from the records.** A published source's hosts
are `active`. A source proposed in an open request is `testing`: usable by that
request's own `source-test` and `citation-capture`, for 24 hours from the
proposal, and by nothing else. Any other key is unknown and refused. The BFF
hands the api tier the configuration of a registered source only; the api tier
and the fetcher still refuse every hop off the configuration's hosts and every
address that is not public, and the fetcher never lets a caller widen a
repository record's hosts.

**Every new table is platform-private**: the source body and the monitor state are read by no tenant, and the credential has no `organization_id` at all (`secret_owner_id` binds the secret), so not even the platform organization's members read a key as a tenant.

**A licensed source is no record.** Its fixtures and its monitor's captures
would keep the source's text, which licensed text never is (ADR-0164): the wire,
the package and a CHECK refuse `licence: licensed` for a configured source.

**Three door operations** (`catalog/platform-sources.ts`):
`platform-knowledge-source-test` (fixtures, and one live probe on request;
nothing stored), `platform-knowledge-source-status` (hosts and their state, the
monitor's last check, freshness lag, whether a key is set, the open monitor
request) and `platform-knowledge-source-credential-set` (write-only, the
person's yes, audited). A key is stored through the BYOK secret store (Vault or
a local AES-GCM envelope), one active per source; only a fetch reads it, and the
guard sets it after the header strip, under the header the record names
(never one that routes, frames or proxies the request), on the source's hosts
only. **A key goes only where a reviewer saw it go**: with a released source,
or with a draft revision whose credential header and every host the released
revision already had. A re-proposal that adds a host is tested without the key.

**`ogc`** is an access type: OGC API - Features (`items`, the collection's own
description) and WFS 2.0 (`GetFeature`, `GetCapabilities`), with a `geojson`
engine (RFC 7946) that anchors each feature. A `bbox` is a site point: a
`public_only` source refuses it before the request is built.

**Monitors** (`source-monitor` sweep, every 15 minutes, behind
`source-monitors` and `platform-base-knowledge` on the platform organization):
each published source whose monitor names a probe and is due is probed
(`POST /v1/public-sources/probe`: `sha256`, `etag` or `version`, and the hash
of a terms page on the source's hosts). A change opens a draft change request,
`origin: monitor`, holding a capture of the new page and the finding (previous
and current state, terms changed, `needs[]`); at most one is open per source
(a unique index). It never publishes. The run is a Langfuse trace
`source-monitor` with `freshness-lag-days` per watched source. Agents find the
work with `change-request-list {origin: monitor}`; a reviewer who finds nothing
to do rejects the draft (the person's yes), which frees the source for the
next request. One source's failure is that source's, logged and counted; the
run goes on.

**Advice policy and terminology are ruleset types.** `advice_policy.v1` holds
per topic one of `assert`, `hedge`, `decline`; the text an answer carries for a
code is a fixed template (`rulesets/advice.ts`), composed by depth as a union
in which the strictest code wins, so an office can only tighten, and a topic no
policy states hedges. `terminology.v1` holds term and gloss pairs keyed by BCP
47, one line of at most 200 characters with no markup bracket; the nearest
node's gloss wins. `advice-policy-held` is an LLM judge on turns tagged
`advice_policy:carried`, under a rule of its own.

**The roles a publish needs.** `knowledge_required_approval_roles` names
`counsel` for a request holding an advice policy and the new
`privacy_reviewer` for one holding a site-keyed source; the request stays
submitted until each has said yes, and a trigger on the release move refuses a
publish without them, whatever path reaches it.

### Consequences

- Good: a country's sources, advice policy and terminology are onboarded and
  kept current through the door, with no code and no deploy.
- Good: a source that changed is a request in a reviewer's queue, with the new
  page captured, rather than a silently stale answer.
- Good: the allowlist cannot drift from the records, and a draft cannot open a
  host for anyone but its own request.
- Bad: the legal subprocessor page is generated from `configs/subprocessors/`,
  so a source configured in the database is not listed there yet. Site-keyed
  sources are held behind a privacy reviewer until the page reads records
  (needs a decision on how the page lists them).
- Bad: an agent that sets a key has the key in its context. The door offers the
  operation because the design asks for it, on the person's yes. The platform
  view has no form for a key yet: a client that cannot ask the person is sent
  to Platform → Countries, where the person cannot set it either, so until that
  form exists the key is set through a client that can ask.
- Neutral: nothing tags a turn `advice_policy:carried` yet; the turn-context
  slice that puts a site's hedges into the prompt does, and the judge runs from then.
- Neutral: score names follow the repository's kebab case
  (`advice-policy-held`, `freshness-lag-days`) where the design wrote snake case.

### Confirmation

`apps/workspace/bff/agent-api/synthetic-country-door.integration.spec.ts`
under `task db:test:rls`: a scripted client takes the synthetic country `XA`
through the door (a fixture territory, one configured source, one advice
policy) to a green validation, counsel's approval and a stable release, and the
monitor opens one change request when the source changes and no second while
it is open. Its revert checks were run by hand: with the awaited-roles check
removed from the decision, and with the request filter removed from the testing
window, the spec fails. The 0212 block of `scripts/rls-test-db.sh` holds the
triggers, the one-open-request index and the down. The parts:
`packages/public-sources/tests/test_configured_source.py`, `test_ogc.py`,
`apps/agent-host/tests/test_public_source_capture_route.py`,
`bff/base-knowledge/rulesets/advice.spec.ts`, the element ledger
(`knowledge-consumers.spec.ts`) and `test_langfuse_scores.py`.

## Amendment, 2026-11-10: a source's documents may be PDFs

Much of a country's law and guidance is published only as PDF (the OIB
guidelines, Land gazettes, municipal ordinances, authority guides). A capture
of one kept no text, so KC-6 failed every record citing it, and no format read
it.

- **One PDF pipeline.** A PDF's text is ingestion's text pass, moved out of
  `knowledge_layer/ingest/adapter.py` into `ingest/pdf_text.py` and offered on
  the package surface as `pdf_page_texts(bytes)`. A capture and a `pdf_document`
  source read the text the corpus indexes, so a quote KC-6 accepts is a quote
  the index holds. A second extractor was written first and removed: two
  readers give two texts for one document.
- **The guard is public-sources'.** `public_sources/pdf.py` runs that pass in a
  child process (`public_sources/pdf_reader.py`) with a 45 s deadline, a 2 GiB
  address-space ceiling, no core file, an environment without the server's
  secrets, and at most two at once per process. It refuses a PDF of more than
  300 pages (about 0.09 s a page: the deadline reaches it) and keeps at most
  2,000,000 characters, whole pages, saying up to which. The BFF waits 150 s,
  longer than a probe's two fetches and one parse, so a slow parse reaches the
  door by its own code. Refusals by code: `pdf_encrypted`, `pdf_malformed`,
  `pdf_too_many_pages`, `pdf_parse_timeout`, `pdf_reader_failed` (the reader
  stopped, with its exit status). Every refusal of a capture is named now:
  `body_too_large` past the egress ceiling and `egress_refused` for a URL or a
  redirect hop off the source's hosts or onto no public address. The door
  answers each as a 422 problem whose code is the name in capitals, with a hint.
- **Pages are joined by a form feed**, as `pdftotext` joins them: the quote
  check reads it as whitespace, and the capture view counts `pages` from it.
  No column was added. The quote check also joins a word a PDF hyphenated
  across a line ("Bundes-" / "Immissionsschutzgesetzes"), on both sides.
- **A scan keeps no text** and says so in the capture's `note`. Ingestion
  transcribes such pages with the vision model; a capture does not yet. The
  follow-up is that same transcription behind the same guard, not OCR of our own.
- **`pdf_document`** is a format (migration 0215 widens the CHECK): a passage
  per page, anchor `page_<n>`, monitored by sha256 like every format. A fixture
  response may carry a binary body as base64 (`encoding: base64`), within the
  same length; a reviewer's view shows such a body as its type, size and
  sha256, so the view stays under the door's result cap. Licensed documents
  still cannot be a source.

## More Information

- Design §3.7, §4.1 to §4.5, §9b(b) on `claude/intl-design`.
- Amends ADR-0162 (monitors, `ogc`, door operations) and builds on ADR-0161,
  ADR-0165, ADR-0166 and ADR-0170.
- OGC API - Features Part 1 (OGC 17-069r4); WFS 2.0 (OGC 09-025r2); GeoJSON
  (RFC 7946); BCP 47 (RFC 5646).
