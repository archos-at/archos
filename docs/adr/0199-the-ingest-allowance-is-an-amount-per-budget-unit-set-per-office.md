---
status: proposed
date: 2026-11-26
decision-makers: platform team
consulted: Jonathan's request after feld72 uploaded a 1,881-file project folder at once
informed: everyone who changes budgets, ingestion or the platform console
---

# The ingest allowance is an amount per budget unit, set per office by the platform

## Context and Problem Statement

Reading documents in is paid from an allowance of its own: per office and UTC
month, `INGEST_ALLOWANCE_FACTOR` (3) times its monthly limit
(`bff/budgets/ingest-limit.ts`, [usage-budgets.md](../architecture/usage-budgets.md#the-ingest-allowance)).
Once it is spent, a new upload is still stored but no longer read. Nobody could
change it except by raising the monthly limit, which also raises what the office
may spend on day-to-day work.

feld72, a pilot office, uploaded a 1,881-file project folder in one go. Jonathan
asked that the quota for uploading files ("Kontingent für das Hochladen von
Dateien") be definable per office. The storage quota and the largest file are
already per-office settings in the platform console (`storageQuotaBytes`,
`maxUploadFileBytes`). The ingest allowance was the only upload quota an
operator could not set. Of the three, it is the one a folder of 1,881 files hits.

Two questions follow: is the setting an amount or a factor, and what does it
mean when the office's budget unit changes? An office on the platform's key is
budgeted in credits. An office on its own provider key is budgeted in tokens
(`getOrgBudgetUnit`). The unit changes when an office adds or removes its key.

## Decision Drivers

- An operator answering a request like feld72's thinks in an amount ("this month
  they may read 50,000 credits' worth in"), and the office sees an amount on its
  meter.
- The ingest allowance must be raisable without raising the work budget, and
  cappable where the month has no limit. An own-key office has no monthly limit
  by default, so three times it is "unlimited".
- A credit amount must never be read as tokens. A token is about a
  thousandth of a credit's worth, so 50,000 read as tokens would stop the
  office's reading on its first page.
- An office without a setting keeps today's behaviour, and the operator has one
  clear way back to it.

## Considered Options

1. Keep the fixed factor of three (do nothing).
2. A factor per office, multiplied with the monthly limit.
3. An absolute amount per office, one value regardless of unit, cleared when
   the unit changes.
4. An absolute amount per office and per budget unit, the factor of three as the
   default where none is set for the current unit.

## Decision Outcome

Chosen option 4, because it is the only one that is an amount, raises ingestion
without the work budget, caps an unlimited month, and survives a unit change
without reinterpreting anything.

- Stored as the platform-owned organization setting `ingestMonthlyAllowance`,
  `{ credit?: number, token?: number }`. It is in `PLATFORM_OWNED_SETTINGS`, so
  the office's own settings save refuses it.
- The effective allowance is the entry for the office's current unit, or
  `INGEST_ALLOWANCE_FACTOR` times the monthly limit when there is none
  (`effectiveIngestLimit`).
- Written only through `PUT /api/platform/organizations/:id/ingest-allowance`
  (`platform:organizations:manage`). The body is `{ unit, monthlyAllowance }`,
  and `null` removes that unit's entry, which brings back the default. A `unit`
  that is not the office's current one is refused with 409, like the budget
  write. Each write is audited as `org.ingest_allowance.updated` and
  invalidates the 30-second cache.
- When the unit changes, the other unit's entry applies, or the default. The
  entry for the unit left behind is kept and comes back on a switch back. This
  is how budget policies already behave (one row per currency).

### Consequences

- Good, because an operator can grant feld72 a one-off reading allowance in the
  platform console's "Kontingent" dialog, next to the monthly limits it is
  separate from, and the platform agent can do the same
  (`platform-org-ingest-allowance-update`).
- Good, because 0 is a valid amount: it stops new readings, which an operator
  can use to hold an office still while something is investigated.
- Bad, because a set amount no longer follows the monthly limit. An operator who
  later doubles an office's monthly limit leaves its ingest allowance where it
  was. The dialog shows the default the amount replaces, and "Standard
  verwenden" goes back to it.
- Bad, because an office that moves to its own key loses its credit amount until
  an operator sets a token amount. This is deliberate, since the credit amount
  means nothing in tokens, but nobody is told.

### Confirmation

- `bff/budgets/ingest-allowance.spec.ts`: a credit amount is not applied after
  the move to tokens, a set amount replaces the default, 0 is spent, and a
  malformed setting falls back to the default.
- `bff/budgets/platform-service.spec.ts`: a stale unit is refused before any
  write, a write keeps the other unit's entry, and every write is audited.
- `bff/organizations/settings-ownership.spec.ts` refuses every
  `PLATFORM_OWNED_SETTINGS` key from the tenant write path, this one included.

## Pros and Cons of the Options

### 1. Keep the fixed factor

- Bad, because the only way to read in a large folder is to raise the work
  budget as well. And on an own key with no monthly limit, ingestion has no
  ceiling at all.

### 2. A factor per office

- Good, because it is unit-free, and it keeps following the monthly limit.
- Bad, because a factor of anything times an unlimited month is unlimited, so
  it cannot cap an own-key office. The operator also has to work out "×17"
  from the amount they actually mean.

### 3. One amount, cleared on a unit change

- Bad, because the unit change happens when the office adds or removes its key,
  in the office's own settings, where nothing knows about a platform setting to
  clear. Clearing it there would couple the key flow to budgets. Not clearing it
  would read credits as tokens.

## More Information

Revisit this if offices come to buy reading capacity as a product (a plan with
an ingest allowance in it). The amount would then belong in the plan, and this
setting would become the per-office override on top of it.
