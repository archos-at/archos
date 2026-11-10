---
status: proposed
date: 2026-11-10
decision-makers: engineering, the platform owner
consulted: break-glass approval as access-control practice (privileged, reasoned, audited, visible, followed up); ADR-0165, ADR-0170, ADR-0174
informed: whoever reviews or onboards platform knowledge (operators and their agents), the platform owner
---

# A platform change request may be approved alone, with its second review deferred

Amends [ADR-0165](0165-platform-knowledge-changes-through-reviewed-change-requests.md)
(four eyes on approvals) and
[ADR-0170](0170-the-platform-door-is-agent-grade-for-onboarding-a-country.md)
(four eyes on claim verdicts, source checks).

## Context and Problem Statement

Platform knowledge reaches every entitled office only through a change
request, and four eyes holds it: whoever wrote a revision in a request can
neither review its claims nor approve it. A trigger keeps that true on every
path (migrations 0205 and 0208). The platform owner is often the only reviewer
there is. Until now a country could not be released without a second person,
however long that person stayed away. The platform owner decided there must be
a way through.

The question this record answers: how an author approves their own request
without four eyes becoming optional, so that the second review is postponed and
never forgotten.

## Decision Drivers

- **Deferred, not removed.** Every request approved alone owes a second review
  that someone else gives later, and the owed review is visible until it is
  given.
- **Never implicit.** A plain approve by an author is refused exactly as
  before; the bypass is a separate, named input with a reason.
- **The person's own yes.** An agent may propose the bypass and ask; it never
  takes it on its own.
- **The database holds it** while code is wrong: no path writes an override
  without the mark, and no author closes the review they owe.
- **Platform-internal.** Offices read what is released; how it was approved is
  the platform's business.

## Considered Options

1. **A break-glass override on the approval, with a deferred second review**
   (chosen).
2. **Let the platform owner's role skip four eyes.** Rejected: implicit, so an
   approval by an owner looks like any other and nothing asks for the review it
   skipped. Premise: the owner's approvals are rare enough to trust unmarked; a
   sole owner makes every approval theirs.
3. **A second account for the same person.** Rejected: four eyes in name only,
   and the trail says two people decided when one did.
4. **Wait for a second person.** Rejected by the owner: a country cannot be
   released at all while they are alone.

## Decision Outcome

**Amended 2026-11-10 (architecture review of platform governance, migration
0217):** an approval alone no longer defers the source check. A page an
operator pasted is checked against its source by somebody other than its
author before any approval, alone or not (ADR-0170 as it was), so a sole owner
releases alone only what cites fetched captures. Every request needs a domain
expert's approval besides counsel and privacy where they apply, a trigger holds
a request's status to its lifecycle, and the `second_reviewer` role is gone.
Drafting and reviewing take `platform:knowledge:write` and
`platform:knowledge:review` instead of `platform:settings:manage`. Where this
record says below that the source check waits for the second review, that no
longer holds.


Chosen option 1.

**The permission.** `platform:knowledge:approve_alone`, in the platform tier
of the authorization catalog (`bff/authz/catalog.ts`). Only
`org-platform-owner` holds it, as it holds every platform permission; no
narrower role should. The deploy Job `grid-app-authz-catalog` applies it. A
break-glass session (`PLATFORM_OWNER_EMAILS`) holds it too, since break-glass
grants every platform permission and is audited on its own.

**The opt-in.** `platform-knowledge-change-request-decide` takes
`{decision: "approve", role, override: {reason}}`. The reason runs 20 to 500
characters: a sentence somebody can follow up, short enough for the audit
trail's metadata. The override needs, in this order: the role's own
`approve_as_<role>` permission, `approve_alone` (403 without it), and the
person's own yes (`requirePersonDecision`; an agent's call without it is a 403,
an elicited yes passes). It is refused on a reject and from anyone who wrote
nothing in the request (nothing to override).

**What it waives, and what it does not.**
- Four eyes on this approval: the trigger `knowledge_approval_four_eyes` lets
  an author's approval in only with `override_reason`, and refuses an
  override from a non-author.
- Claims nobody reviewed: the author cannot review them (0208), so they wait
  for the second review. A claim somebody marked `edited` or `rejected` still
  blocks.
- The source check (0209) on an operator-supplied capture: the second review
  must give it. `knowledge_sources_unchecked` is now the one test, and the
  trigger on the request holds a confirmation to it.
- **Not** the other required roles. A request holding an advice policy still
  needs `counsel`, one holding a site-keyed source a `privacy_reviewer`
  (ADR-0174). Each is its own approval: an override in that role also needs
  that role's permission, so one person satisfies it only when they hold the
  role, and the publish trigger keeps refusing without them. `org-platform-owner`
  holds every `approve_as_<role>`, so the owner can approve every role alone.
  That is why the second review owes **every role approved alone** (below),
  not only the domain review: counsel or privacy approved alone is reviewed
  again by somebody holding that role.

**The mark.** Migration 0214 adds `approval` (`four_eyes`, `single`) and
`second_review` (`due`, `confirmed`, `disputed`, with who and when) to
`knowledge_change_requests`. An AFTER INSERT trigger on an override approval
sets `single` and `due` in the same statement. CHECKs tie `single` to an owed
review and a closed review to its reviewer. The API carries `approval` and
`secondReview` on every change request, `approval` on every release in
`change-request-get`, and `overrideReason` on the approval. The platform view
shows the badge "Ohne Zweitprüfung freigegeben" and the review's state, in the
queue and on the request. The office side reads none of it.

**The audit.** One `platform.knowledge.change_request_approved_alone` event per
override, in the platform organization's trail: the actor and time, the
request, the reason, the role, how the yes was given, the revisions approved
alone (ids cut at 500 characters, with a count) and the roles still awaited.
It replaces the plain `_approved` event for that approval.
`platform.knowledge.second_review_confirmed` and `_disputed` record the
follow-up.

**How a deferred review closes.** The second review is owed in every role
approved alone: one row per role in `knowledge_second_reviews` (append-only,
once per role). It is given once the request is approved (or published, or
rolled back). The request is in the overview's `queue` while its review is due,
and `change-request-list?secondReview=due` finds it. It stays reviewable after
approval. Another person records verdicts
(`platform-knowledge-change-request-review`), then decides in a role approved
alone that they hold (`approve_as_<role>`, checked like an approval):
- `approve` with every claim accepted (and every operator-supplied capture
  source-checked) **confirms** that role. The request's review is confirmed
  once every owed role is, and the queue item closes.
- `reject` **disputes** it. One dispute in any role disputes the request, and
  a further publish is refused, by the service under the request's lock and by
  the release trigger. What follows is a person's decision, never automatic:
  an approved request is rejected, which first withdraws its preview (a
  preview rollback, allowed only for a disputed request); a published one is
  rolled back (`platform-knowledge-rollback`).

A request approved alone and then rejected while still submitted (counsel or
privacy still owed) reached no office: its review becomes `void`, and nothing
is owed.

The triggers hold all of it. A second review row is accepted only while the
review is due, only in a role approved alone, and never from somebody who
wrote a revision in the request. `second_review` on the request moves only
from `due`: to `confirmed` once no role is owed, to `disputed` with a dispute
on record, or to `void` with the request rejected. Never back.

**A reject names its role too.** A reject is checked against the
`approve_as_<role>` permission of the role it names, as an approve is. Before,
a reject needed only `platform:settings:manage`, and its audit recorded
whatever role the client sent.

### Consequences

- Good: a sole platform owner can release a country, and the record says
  plainly that one person decided and why.
- Good: the owed review cannot be lost. It sits in the queue, and the database
  refuses every way of closing it except another person's decision.
- Bad: knowledge approved alone reaches offices before a second person has
  checked it. The deferral trades that risk for availability. The rollback is
  one decision away, but it is not automatic.
- Bad: the four-eyes guarantee on platform knowledge is now conditional. A
  reader of a release must look at `approval` to know which kind it had.
- Neutral: a request still `submitted` while it waits for counsel shows its
  second review as due but cannot take it yet. It becomes reviewable once it is
  approved, and owes nothing if it is rejected instead.
- Neutral: the platform view approves and reviews as domain expert, or as the
  first due role the reviewer holds; another role is given through the door.

### Confirmation

`apps/workspace/bff/base-knowledge/platform/approve-alone.integration.spec.ts`
under `task db:test:rls`, on real Postgres through the service: the author's
plain approve is refused; the override is refused without the permission and
without the person's yes (the elicited yes passes); a short reason is refused
at the wire and by the CHECK; an override passes, is audited, marks the request
and its releases, and puts the request in the queue; another person's review
and approve closes it; a reject disputes it and blocks the next publish, which
the release trigger refuses too; a request disputed in preview can be rejected,
withdrawing its preview; every role approved alone owes its own review from a
holder of that role; a request rejected before approval owes none; a dispute or
reject without the named role's permission is refused; an author cannot close
the review, and a closed review cannot reopen.
`bff/base-knowledge/platform/service.spec.ts` holds the permission, the yes
and the audit event at the service. `knowledge-consumers.spec.ts` names a test
for every new column.

## More Information

- Operators and their agents:
  `apps/workspace/bff/agent-api/door/platform/onboarding-guide.md`, step 10.
- Provisioning: `docs/deployment/workos-provisioning.md`.
