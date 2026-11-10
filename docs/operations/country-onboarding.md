# Onboarding a country's knowledge

How a country's platform knowledge comes in: as data, through reviewed change
requests (ADR-0165), driven by an operator's own agent on the platform door
(ADR-0170). No code and no deploy unless a source needs a new protocol or
format (ADR-0162).

**The agent's guide is a resource on the door**, not this page:
`apps/workspace/bff/agent-api/door/platform/onboarding-guide.md`, served as
`<scheme>://platform/onboarding-guide` to an operator whose permissions show the
knowledge operations. Change the agent's procedure there; this page is for the
people around it.

## Who does what

| Step | Who | Where |
|---|---|---|
| Open a change request, capture sources, import territories, propose records, validate, submit | the operator's agent | the platform door (`/api/platform/mcp`) |
| Paste the text of a page the fetcher cannot reach (`operator_supplied`) | the operator, through the agent | the door |
| Review each claim; mark `sourceChecked` for each record citing an operator-supplied capture | a domain expert, never the author | Platform → Countries, or the door |
| Approve, publish to preview, publish to stable, roll back | the person, on their own yes | asked in their client, or Platform → Countries |
| Entitle an office to the country | the person, on their own yes | the same |

## What holds whatever the agent does

- Every record cites a capture of its own request, and every quote is checked
  against the captured text (KC-6). A fabricated page or quote fails validation.
- A request is submitted only once `platform-knowledge-validate` is green.
- The author of a revision cannot approve the request (four eyes, a trigger).
- An operator-supplied capture blocks approval until a verdict on the record
  that cites it says its source was checked, by someone other than the
  record's author (triggers in 0208 and 0209).
- A source check, approve, publish, rollback and entitlement run only on the
  person's yes; a client that cannot ask them is sent to Platform → Countries.
- Every write may be retried with the same `idempotencyKey`.

## Adding a source the agent can capture from

Two kinds of configured source:

- **A platform record** (ADR-0174), proposed through the door as a `source`
  record with its fixtures inline. KC-7 checks it on the api tier (it parses,
  its URLs are on its hosts, every fixture passes with no live call). While it
  is a draft, its hosts are `testing`: usable by its own request's
  `source-test` and `citation-capture` for 24 hours, by nothing else. Once
  published they are `active`. A `site_keyed` source (it receives a site
  point) needs a `privacy_reviewer` approval; a keyed one names its header and
  gets its key through `platform-knowledge-source-credential-set` (write-only,
  the person's yes). The key goes with a draft only to hosts and under a header
  the released source already had. A `licensed` source cannot be a record.
- **A repository file** under `configs/sources/<country>/<name>/source.yml`
  (ADR-0162), reviewed as code. `at-ris` and `ch-fedlex` are these; a record
  may not take one's id. Name a new one in the agent's guide in the same change
  (`door/index.spec.ts` holds the guide to the door's operations; review holds
  its list of sources).

## Saying which buildings a work is for

A work the chain reaches binds every project at the site until an
`applicability` ruleset says otherwise (ADR-0176). Propose one per work whose
scope turns on the building: a `decision_table.v1` over facts the country's
`fact_definitions` define, answering `applies`, `check` or `not_applicable`,
with `workIds` naming the work and a `provision` on each row (the chip shows
it). Give it examples; the kit runs them. Austria's are
`configs/knowledge-packs/at-applicability.json`, a request of its own after
`at.json`, whose works they name. A fact the intake does not ask can only
answer `check`.

## Keeping a country current

The `source-monitor` sweep (every 15 minutes) checks each published source
record whose monitor names a probe and whose interval has passed, with no model
call. A change opens one draft request, `origin: monitor`, holding the new page
as a capture; a second change while it is open is recorded in the source's
state only; a reviewer with nothing to do rejects the draft, which frees the
source for the next one. It never publishes. It runs only with `source-monitors` on for the
platform organization. Each run is the
Langfuse trace `source-monitor`, with `freshness-lag-days` per source.

## Counsel and privacy review

A request holding an advice policy needs a `counsel` approval, and one holding
a site-keyed source a `privacy_reviewer` approval, besides the domain expert's.
The request stays `submitted` until each has said yes; a trigger refuses a
publish without them (migration 0212).

## The measure

`apps/workspace/bff/agent-api/onboarding-door.integration.spec.ts` drives the
AT-9 case (`apps/workspace/tests/fixtures/onboarding/at-9.json`) through the
door with no model, under `task db:test:rls`.
`synthetic-country-door.integration.spec.ts` beside it onboards the synthetic
country `XA` (a fixture territory, one source record, one advice policy) to a
stable release and lets the monitor open a request when the source changes.
