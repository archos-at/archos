# Handover: competence decides authority directives (international build, item 6)

Branch `m1/competence-directives`, stacked on `a1/edition-in-force` (#1591).
No PR yet: work stopped at the session deadline (2026-11-10). Merge develop
(with #1591 in it) before going on.

## Done on this branch (commit 9e653462c)

- `resolveChain(graph, leaf, date, { editionFor, competence })`: an options
  object replaces the positional `editionFor`. An `authority_directive`
  addressed to an authority record is authority practice only where that
  authority is competent by `directiveVerdict` (`platform.ts`), the decider
  the office layer's platform path already used. Undetermined competence, or a
  directive naming no authority record, falls back to the addressees'
  territories, as before.
- `GraphWork.addresseeAuthorityIds`, read by `chain/load.ts` and
  `chain/from-proposals.ts`.
- The knowledge context (`context/service.ts`, phase `competence`) and the
  turn's building law (`chain/turn.ts`) read `competentAuthorities` for the
  site and pass it in.
- Spec: `resolve.spec.ts` "lets competence decide an authority directive…";
  replacing the verdict with `authority_unknown` fails it. ADR-0175 amended,
  release note `directive-competence`.
- `task verify:fast` EXIT 0. `task db:test:rls` failed once in
  `platform.integration.spec.ts` with "AT was released by another change
  request": the parallel-publish pollution #1593 fixed on develop, not in this
  branch's base. Re-run after merging develop.

## Next

1. Merge develop; re-run both gates.
2. The office half, decided 2026-11-10 by the coordinator: **option A**.
   Competence is the one rule, with no prefix fallback. The reading proposes
   office addressees from the platform authority records the office reads,
   replacing `KNOWN_AUTHORITIES` (MA 19/21/37/64) in `office/reading.ts`; a
   confirmed addressee carries `authorityId`, and `office/authority.ts`
   `directiveApplicability` (a prefix match) gives way to `directiveVerdict`.
   An unlinked addressee answers `authority_unknown` ("Zuständigkeit nicht
   geprüft"). Required: a spec per case (unlinked → `authority_unknown`;
   linked and competent → applies; linked, other body competent → excluded)
   and a release-note line that a guessed verdict now reads "Zuständigkeit
   nicht geprüft". Callers: `office/answer-label.ts`, `office/turn-block.ts`,
   `chain/turn.ts`, `office/service.ts`. Start after #1584 lands.
3. Approved in two steps, with no `migration:contract` label now.
   `knowledge_authority_revisions.competence_territory_ids` has no SQL reader
   (competence comes from rulesets). Expand step: the door stops taking it,
   `platform/records.ts` stops writing it, the column gets a default and loses
   NOT NULL and its cardinality CHECK; reviewer UI, i18n labels,
   `app/dev/platform-countries`, `tests/fixtures/onboarding/at-9.json` and
   `country-knowledge.spec.tsx` follow. A later contract migration drops it.
