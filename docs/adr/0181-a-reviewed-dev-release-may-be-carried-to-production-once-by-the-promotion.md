---
status: accepted
date: 2026-11-14
decision-makers: the platform owner, engineering
consulted: ADR-0165, ADR-0170, ADR-0176, rollover-to-prod.md (steps 6 to 8)
informed: operators of the platform door, whoever reviews a promotion PR
---

# A reviewed dev release may be carried to production once by the promotion

Amends [ADR-0176](0176-a-platform-change-request-may-be-approved-alone-with-its-second-review-deferred.md)
and the "prod keeps four eyes" rule (`deploy/pulumi/stack-files.spec.ts`), for one carry.

## Context and Problem Statement

Austria's and the EU's building law was onboarded, reviewed and published on dev, where one operator
works alone (`KNOWLEDGE_SINGLE_OPERATOR`, migration 0233). Production has none of it. The plan in
[`rollover-to-prod.md`](../design/international/rollover-to-prod.md) imported the dev release on prod as a
draft and reviewed it there with four eyes (steps 6 to 8). Until that review finished, every Austrian office
answered on gate `none`: no binding edition, no derived building class, every building-law answer capped at
medium (finding 1). The review would take hours to days, and its reviewer would check the same records the
owner already approved on dev.

The owner decided on 2026-11-14 that production must get building law exactly as it works on dev, carried by
the next promotion with no review session on prod, recorded honestly as carried, and that the promotion PR's
review of the bundle is the only second look.

## Decision Drivers

- **No degraded window.** The law reaches stable on prod in the deploy that ships the code which needs it.
- **Exactly dev's release.** The records, captures and text bytes dev reviewed, byte for byte, never a re-run.
- **Honest record.** Prod's trail says the decision was carried, from where, by which promotion; it never
  pretends a prod person reviewed it.
- **One carry, not a new default.** Every change request a person opens on prod keeps four eyes.

## Considered Options

1. Import on prod and review with four eyes (steps 6 to 8 as written).
2. Approve the imported draft alone on prod (ADR-0176): leaves a second review due, and needs a prod person
   to source-check every operator-supplied capture, the step the owner wants gone.
3. **Carry the dev release by the promotion**: a Job in the deploy imports, reviews, approves and publishes it,
   decided `carried`.

## Decision Outcome

Chosen option 3.

- The exported bundles (`platform-knowledge-release-export`, gzip) and a manifest live in
  `apps/workspace/config/knowledge-releases/` (inside the frontend image's build context; the texts' bytes are
  not committed). The manifest names each bundle's uncompressed sha256, country, source seq and counts, and
  each text's document class and display title on dev.
- The Job `knowledge-carry-<digest>` (`deploy/pulumi/src/app/knowledge-carry-job.ts`, stack key
  `knowledgeCarry`) runs `bff/base-knowledge/platform/carry.ts` as `system:knowledge-carry`: verify every
  bundle, then per country in order (EU before AT) import a draft marked `carried_from`, attach each text
  from its URL through the public-source fetcher (bytes held to the bundle's sha256), validate, submit,
  accept every claim with its source checked, approve alone, publish to preview and stable, wait for the
  corpus to ingest the texts with the country's mark, label them, and finally delete the legacy corpus copies
  whose bytes equal a released text and that no record names.
- The Job's pod alone sets `KNOWLEDGE_SINGLE_OPERATOR=true`, so migration 0233 counts the carry's own
  verdicts and leaves no second review due.
- Migration 0239 adds `carried` to the decision sources of verdicts, approvals and release moves, and
  `knowledge_change_requests.carried_from`; a trigger refuses `carried` on any request not carried, and
  `carried_from` never changes once written.

### Consequences

- Good: prod answers on Austria's law from the promotion on, as dev does.
- Good: a rerun is safe: a verified bundle stable already holds is skipped, a stopped carry resumes its
  request, and on dev (the source deployment) the Job writes nothing.
- Bad, and accepted: **the governance this bypasses.** On prod, no person reviews the records, checks an
  operator-supplied capture against its source, or approves; ADR-0165's four eyes and ADR-0176's due second
  review do not apply to a carried request. The only second look is the promotion PR's review of the bundle
  and its manifest. The approval is `single`, `decision_source = 'carried'`, its reason names the dev release,
  its seq, the bundle's sha256 and the promotion.
- Bad: a carry deletes the legacy copies of released texts, which were the rollback floor
  (rollover-to-prod.md, open question 2). A rollback of AT then leaves prod with no OIB text until it is
  carried again.
- Neutral: the Job is not awaited by the deploy (ingest time would sit inside its 60-minute budget); its log
  and exit code are the report.
- A record deleted on dev after the carry is not deleted on prod by a later bundle: a carry publishes what a
  bundle holds and removes nothing.

### Confirmation

- `bff/base-knowledge/platform/carry.integration.spec.ts` (in `task db:test:rls`): a fresh database gets both
  bundles on stable, decided `carried`; a rerun and a run on the source deployment change nothing; a text with
  other bytes stops in a draft; a bundle digest mismatch refuses before any write; `carried` on a request not
  carried is refused by the database.
- `carry-manifest.spec.ts`: the committed bundles are the ones the manifest names.
- `stack-files.spec.ts`: only the carry Job turns `KNOWLEDGE_SINGLE_OPERATOR` on in the Pulumi source, and prod's
  stack never does.

## More Information

The procedure, and what green looks like: [`rollover-to-prod.md`](../design/international/rollover-to-prod.md).
