---
status: proposed
date: 2026-11-10
decision-makers: engineering
consulted: the country base knowledge design (v7, §4.3 and §4.5) and its build split (S10)
informed: whoever onboards a country (operators and their agents), reviewers of platform knowledge, S16 (Germany readiness)
---

# The platform door is agent-grade for onboarding a country: captured citations, dry runs, idempotent writes, problem details and the person's yes

## Context and Problem Statement

The product has no onboarding agent. A country is brought in by an operator's
own agent (Claude, or any MCP client) on the platform door (ADR-0126, ADR-0160),
as a data release through reviewed change requests (ADR-0165). After S7 the door
could propose records, but an agent driving it alone could not do so reliably:
it had no guide, no schema to write against, no way to retry a write without a
second effect, refusals in prose, citations that were bare links a model could
make up, and person-decides operations that a client without elicitation could
only fail. And `platform-skill-create` and `-update` published instructions to
every office on an agent's call alone.

## Decision Drivers

- The outcome is measured, not asserted: a scripted client with no model takes
  the AT-9 case to a green validation using door operations only.
- Industry standards before our own words: RFC 9457 problem details, RFC 6901
  JSON Pointers, the IETF `Idempotency-Key` header, JSON Schema 2020-12, MCP
  resources and form elicitation.
- Fail closed on unknown: an unreadable proposal, an unknown capture, an
  idempotency store that cannot be read, an unknown record type.
- An agent cannot verify a page it made up; the product holds the page.
- Writes that reach every office need the person's yes, held at the route.

## Considered Options

- **Agent-grade door on the existing operations** (chosen): the contract lives in
  the door (idempotency, problems) and in the platform-knowledge service (kit,
  captures), so every client, the platform view included, gets it.
- **An onboarding skill or prompt in the product.** Rejected by the design: the
  product holds no onboarding agent; the operator's agent is the client.
- **Citations as URLs the reviewer opens.** Rejected: a reviewer checking 187
  claims against live pages cannot tell a moved page from a fabricated one, and
  a model can fabricate both URL and quote.

## Decision Outcome

**The guide is a resource.** `<scheme>://platform/onboarding-guide`
(`bff/agent-api/door/platform/onboarding-guide.md`, embedded like the office
door's guide) is listed on the platform door to an operator who can see the
knowledge operations, and the server's instructions name it. Nothing of it is on
an office door.

**Shapes before writes.** `platform-knowledge-schema-get` answers each record
type's JSON Schema from the same zod the route parses, the citation's shape, the
batch limit (200) and the kit's checks with a hint each.

**Every door write takes `idempotencyKey`** (sent as `Idempotency-Key`). The door
keeps the first answer 24 hours per organization, person, operation and key
(`door-idempotency.ts`); the same key with other input is a 422; a 5xx is not
kept. Unlike the office routes' helper (ADR-0163), it fails **closed**: when the
cache cannot be read, a keyed call is not run (503). Proposals are also
idempotent by themselves: the same record proposed again into the same request
is `unchanged`, no new revision, so `records-propose` and `territory-import` are
`idempotent: true`. The key is a bare `{ type: string }` in each write's schema,
described once in the server instructions.

**Every refusal is an RFC 9457 problem** (`door-problem.ts`): whatever the route
answered, the tool result carries `structuredContent.problem` with `type`,
`title`, `status`, `detail`, `code` and the route's `details`. The platform
knowledge routes that validate answer `application/problem+json` themselves
(ADR-0163's `asProblem`).

**Per-record results and dry runs.** `records-propose` answers each record's
status (`valid`, `invalid`, `written`, `unchanged`) and problems; a problem is
`{ type, code, recordId, pointer, detail, hint, index }` with an RFC 6901
pointer into the record. A batch with a problem is refused whole.
`platform-knowledge-validate` runs the same kit on everything the request holds
(the stored proposals, kept in the revision's provenance), and submit refuses a
request that does not validate.

**Captured citations, and KC-6 for every proposer.** A platform record cites at
least one capture of its change request with a quote. `platform-knowledge-citation-capture`
either fetches the page now (`fetched`, a configured public source's hosts only,
through the api tier's `POST /v1/public-sources/capture`, because only the
backend roles may call the sandboxed fetcher, ADR-0162) or stores an operator's
text (`operator_supplied`). It keeps the bytes' sha256, size and text
(`knowledge_citation_captures`, migration 0206, platform-private, insert-only,
into a draft only). KC-6 refuses a record with no captured citation, a bare
link, an unknown capture, a capture with no text, and a quote the capture does
not hold (compared after NFKC, typographic quotes and dashes, whitespace and
case; nothing fuzzier). A trigger refuses an approval while a revision cites an
operator-supplied capture that no verdict marked `source_checked`.

**The person decides, and is told where when they cannot be asked.** Approve,
publish, rollback, entitlement and a home-country move keep `personDecides` and
`requirePersonDecision` at the route (ADR-0165), and gain `requiresPersonConfirmation`
with `decideAt: /app/platform/countries`, so a client without form elicitation
gets `person_required` with the link instead of a bare 403.
`platform-skill-update` and `-delete` became person-decides (decided at
`/app/platform/skills`), and a `platform-skill-create` with `published: true` is
refused at the route without the person's yes; a draft needs none. They moved to
`catalog/platform-skills.ts`.

**Attribution.** `created_by` is the person whose token made the call; the
revision's provenance and the capture record `viaClient`, the OAuth client.

### Confirmation

`apps/workspace/bff/agent-api/onboarding-door.integration.spec.ts` under
`task db:test:rls`: the scripted client over the real door handler, catalog,
dispatcher, routes and Postgres takes `tests/fixtures/onboarding/at-9.json` from
the guide to a green validation, then review, approval, publish and entitlement
on the person's yes. Its revert checks were run by hand: with the publish
route's `requirePersonDecision` removed, with KC-6 removed from the kit, and with
the door's idempotency bypassed, the spec fails. The 0206 block of
`scripts/rls-test-db.sh` holds the triggers and the down; `validate.spec.ts`,
`door-idempotency.spec.ts`, `door-problem.spec.ts`, `packages/public-sources/tests/test_capture.py`
and `apps/agent-host/tests/test_public_source_capture_route.py` hold the parts.

### Consequences

- An operator's agent can onboard a country without a developer and without
  reading the code; what it writes is checked against pages the product holds.
- A reviewer reads a claim beside a capture, not a link; what nobody fetched,
  they must mark checked before the request can be approved.
- Every door write on both doors may be retried safely with a key; a cache
  outage refuses keyed writes rather than risking a second effect.
- Each write's input schema grows by one bare property (the tools-mode budget
  in `mcp-server.spec.ts` was raised from 1,060 to 1,080 characters a tool, with
  the measurement).
- Not built here: `source-test`, `source-status`, `source-credential-set`,
  packs, golden runs, the `testing` host state for draft sources (S16 and A4);
  KC-2, KC-4, KC-5, KC-7 to KC-9. Captures keep the text and the bytes' digest,
  not the bytes themselves.

## More Information

Design §4.3 (`claude/intl-design`, `docs/design/international/design.md`);
the agent surface's platform door section
(`docs/architecture/agent-surface.md#onboarding-a-country-through-the-door`);
the operator's runbook `docs/operations/country-onboarding.md`.
