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
  record's author (two triggers).
- A review verdict, approve, publish, rollback and entitlement run only on the
  person's yes; a client that cannot ask them is sent to Platform → Countries.
- Every write may be retried with the same `idempotencyKey`.

## Adding a source the agent can capture from

`fetched` captures go only to the hosts of a configured source under
`configs/sources/<country>/<name>/source.yml` (ADR-0162). A new source is a
reviewed file and its fixtures; name its id in the agent's guide in the same
change (`door/index.spec.ts` holds the guide to the door's operations; review
holds its list of sources).

## The measure

`apps/workspace/bff/agent-api/onboarding-door.integration.spec.ts` drives the
AT-9 case (`apps/workspace/tests/fixtures/onboarding/at-9.json`) through the
door with no model, under `task db:test:rls`.
