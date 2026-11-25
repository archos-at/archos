---
status: accepted
date: 2026-11-25
decision-makers: product owner (Matthias)
consulted: the chat on 2026-11-25 that could not save a summary of the person's own mentions into Meine Ablage
informed: everyone who builds filing, sharing or a door out of a conversation
---

# A person may release a draft drawn from confidential sources after checking it

## Context and Problem Statement

A conversation records what it drew on: restricted folders
(`conversation_restricted_folders`, ADR-0087) and other projects
(`conversation_source_projects`, ADR-0094). Filing a draft out of it was refused
unless every reader of the target could read every source
(`requireMayFileFrom`). For other projects it was refused outright, whatever
the target, the person's own Meine Ablage included.

So the label of a draft was the label of its most restricted input. That is safe
without any judgement, and too blunt: from a confidential contract „Abgabe am
12. März" can be harmless while the fee is not. No rule tells the two apart, and
the agent cannot be trusted to. A person searched their own name across the
office's projects, got a two-page overview as a PDF, and could download it but
not save it, not even into their own shelf.

## Decision Drivers

- A restricted source does not make every sentence drawn from it restricted.
  Only someone who knows the sources can see what of them reached the draft.
- The person who files must still be cleared for every source. A release never
  passes content to someone who could not have read it.
- The office decides whether its members may make that judgement at all.
- An agent never releases. Only a person in the app does.

## Considered Options

1. Keep the high-water mark (today).
2. Let the agent judge whether a draft is still confidential.
3. A person releases after a warning that names the sources, audited; the
   office can switch it off.

## Decision Outcome

Option 3.

- **Where the sources would refuse a filing, a person may release it.**
  `requireMayFileFrom` keeps its rule (`requireFilingWithinSources`). When that
  refuses a filing (`ConversationConfinedError`, action `filing`) and the
  request carries a release, `releaseConfidential`
  (`apps/workspace/bff/conversations/confidential-release.ts`) decides:
  1. the office does not forbid release (`settings.confidentialReleaseForbidden`,
     unset reads as not forbidden), else the refusal stands; it is read
     uncached, so a prohibition holds for every filing after the save returns;
  2. the person may still read every recorded source (`unreadableSourcesOf`),
     else the refusal stands, confirmed or not;
  3. unconfirmed, it answers `409 CONFIDENTIAL_RELEASE_REQUIRED` with
     `details: { reason: 'confidential-release', sources }`, naming each restricted
     folder (with its project when it is another one) and each other project;
  4. confirmed, it records `conversation.confidential_released` with the
     destination and the source ids (`recordAuditEventOrThrow`: no audit, no
     release) and lets the filing go on.
- **Only a person releases.** The release is built in the human route
  (`POST /api/conversations/{id}/draft/file`, body `release: true`) by
  `filingReleaseOf`, which gives none to a call inside `runAsActingSession`. The
  agent catalog's body schema (`fileDraftBodySchema`) does not carry `release`;
  the app's route parses `appFileDraftBodySchema`. The agent's own filing (the
  `create_file` path) never carries one.
- **The card warns and asks.** `ConfidentialReleaseNotice` shows „Beruht auf
  vertraulichen Unterlagen", lists the sources and files only after „Ich habe den
  Entwurf geprüft …" is ticked. The confirmation is spent on one request: the next
  filing of the same draft asks again.
- **Content from someone's own shelf is not released.** ADR-0193 rule 4 stands:
  the `personalShelf` refusal is not a `filing` refusal.
- **The switch** is „Freigabe vertraulicher Inhalte verbieten" under
  Organisation › Prüfung (`PUT /api/organization/confidential-release` with
  `{ forbidden }`, `org:settings:manage`, audited as
  `org.confidential_release.updated`). It is a prohibition and starts off, so no
  admin finds a setting switched on that nobody chose, while release is the
  default. On, filing behaves as before this ADR.

### Consequences

- Good: the person decides what only a person can decide, and the decision is on
  record with who, from what and into where.
- Good: a draft from other projects can be filed into the person's own Meine
  Ablage and into this project, which was impossible.
- Bad: the review is only as good as the person. The agent can paraphrase a
  figure without citing it; the warning and the audit make a careless release
  less likely and traceable, not impossible. An office that will not carry that
  forbids release.
- Neutral: tasks, Recherche, memory and the project profile keep their refusals;
  this decision covers filing only.

### Confirmation

`confidential-release.spec.ts` (off, not cleared, unconfirmed, confirmed and
audited, an agent gets no release), `restricted-egress.spec.ts` (only a `filing`
refusal is released, never the own-shelf one, and a filing the sources allow
asks nothing), `FileDraftCard.spec.tsx` (the card names the sources, files only
after the tick, and asks again next time) and the route spec of
`/api/organization/confidential-release`.

## More Information

Amends ADR-0087 and ADR-0094 for filing: their refusal is now the default a
person may lift, not the last word.
