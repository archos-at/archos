---
status: accepted
date: 2026-11-10
decision-makers: engineering
consulted: the country base knowledge design review (docs/design/international/design.md, v7)
informed: everyone who writes a prompt block, a verdict or a date for a project or an office
---

# A project's site decides its law, and the office's home country only its own defaults

## Context and Problem Statement

Every country-dependent path assumed Austria. `resolve_country` read
`country=other` as Austria (its pattern `country=([a-z]{2})\b` never matched
"other") and fell back to Austria for `de`, `ch` and a project with no country.
The OIB verdicts had no country gate, the intake wrote `country=at` for a
project marked `outside_austria`, and a typed address was stored as a confirmed
fact. A German office's project was answered with Austrian law, confidently.

An organization had no country at all: rows existed only after a settings
write, and `OFFICE_TIME_ZONE = 'Europe/Vienna'` was the clock of every office.

The question this record answers: what places a project, what the office's own
country decides, and what neither may decide for the other.

## Decision Drivers

- A confident wrong answer about which law applies is the most dangerous kind.
- Sales starts with German offices; an Austrian office has German projects.
- The design keeps axes apart (design 3.1, invariant A1): no axis is inferred
  from another.

## Considered Options

- **Fix the regex and keep Austria as the fallback.** Rejected: the fallback is
  the defect. A project with no stated site would still be told Austrian law
  binds it, and a German office's projects start without a site.
- **Derive the site from the office's home country.** Rejected: an Austrian
  office plans in Bavaria and a German office in Tirol; the seat says nothing
  about the site (connecting factors such as HOAI attach to the seat, and are a
  separate, later relation, design 3.1).
- **Place a project by its own facts only, with no default; give the office a
  home country that decides office defaults only.** Chosen.

## Decision Outcome

Chosen option: place by the project's own facts, because it is the only one that
cannot present a law the project's facts do not support.

- **Site.** A project is placed by its own profile: a `country` line, else a Land
  token (`outside_austria` places it outside Austria), the confirmed facts first,
  then the assumptions, which place it as unverified.
  `agent.common.country_profile.resolve_site` and its TypeScript twin
  `bff/project-profile/site.ts` (`siteCountry`) are the one rule; a value the
  intake does not offer places nothing. Nothing places a project by default:
  no fact is `site_unknown`. No OIB verdict, Austrian doctrine as binding,
  catalogue or derived class reaches a project abroad, and an unplaced project
  gets no verdicts and is asked for its site.
- **Retrieval.** The Austrian corpus and the RIS tools serve a project placed in
  Austria, or a turn without a project, and nothing else
  (`country_profile.austrian_corpus_applies`): the BFF leaves the base corpus out
  of such a project's collection scope (`collection-scope-request.ts`,
  `jobs/run-context.ts`), the knowledge layer drops it from a scope the BFF did
  not state (`scoped_collections_for_site`), round 0 prefetches no OIB family,
  and RIS joins the turn's switched-off sources (the chat agent refuses the call, deep
  research is not offered the tool). A question about Austrian law in general is
  asked outside the project.
- **Land from the postal code.** With address search off (ADR-0159), the
  Postleitzahl and place of a typed Austrian address suggest the Land
  (`bff/project-profile/postal-place.ts`, a GeoNames table shipped with the code),
  stored as an unconfirmed assumption with its derivation; the create form asks
  for the country and, in Austria, the Land. Otherwise every new Austrian
  project would start unplaced and lose its OIB verdicts.
- **Typed address.** An address that no register confirmed is stored as an
  unconfirmed assumption, never as a confirmed fact; `country=at` is written
  only for an Austrian site.
- **Home country.** `organizations.home_country` (ISO 3166-1 alpha-2, migration
  0200) is the office's seat, stated when the organization is created. It
  decides the office's own defaults, starting with its clock
  (`organizations.time_zone`, from the home country when unset). It never
  decides which law applies to a project, and no code reads it as a project's
  country. Every path that writes an organization's row states it where
  anything says it (`ensureOrganizationRow`: the creation route, the WorkOS
  organization's metadata `home_country` on the first signed-in page load or
  settings save); an organization left without one is logged at WARN and its
  admins state it once on the organization page. Refusing such an
  organization (`organization_unplaced`) is the gate build split S15 adds; this
  record only stops new rows without a country and makes the rest visible.
- **Older projects' default Vienna.** Migration 0018 gave every project created
  before the Land question an unconfirmed `federal_state=vienna`
  (`onboarding_default`). It stays: removing it would unplace those projects.
  As an assumption it places them as unverified, and the agent's OIB block says
  so (`applicability.UNVERIFIED_SITE_LINE`) and asks the person to confirm.

### Consequences

- Good, because a German, Swiss or unplaced project is never told that Austrian
  law binds it, and says what is not covered instead.
- Good, because the axes later work needs (entitlements, residency, locale) have
  their first column and a rule that keeps them apart.
- Bad, because a project with no site loses the generic OIB list, the Austrian
  corpus and RIS until someone states its Land; existing Austrian projects
  without a Land read less than before. A new one with a typed Austrian address
  gets its Land suggested from the postal code, so this is rare for new work.
- Bad, because every organization that existed before migration 0200 is set to
  AT; a non-Austrian one must be corrected by hand (the roster check in the
  migration's header).

### Confirmation

- `packages/agent/tests/common/test_country_profile.py` (`TestResolveSite`, the
  notes, the doctrine abroad) and `apps/workspace/bff/project-profile/site.spec.ts`
  hold the two twins to the same cases.
- `test_scope_for_site.py`, `TestAustrianCorpus` and the scope spec
  (`collection-scope-request.shelf.spec.ts`) fail when the base corpus or RIS
  reaches a project abroad or unplaced; `postal-place.spec.ts` and
  `intake-seed.spec.ts` hold the postal-code suggestion, Swiss codes included.
- `test_applicability.py` and the jurisdiction section of
  `test_turn_context_message.py` fail when OIB verdicts reach a project abroad
  or unplaced; `applicable-standards.test.ts` does the same for the overview.
- `intake-seed.spec.ts` fails on `country=at` for `outside_austria` and on a
  confirmed typed address.
- `home-country-row.spec.ts` holds the row paths (metadata, none, once);
  `route.spec.ts` the creation's idempotency; `scripts/rls-test-db.sh` the 0200
  backfill, its CHECKs and its down migration.
- The `organizations_home_country_iso` CHECK holds the column's shape. Nothing
  enforces yet that no code reads `home_country` as a project's country; review
  is the gate, and `docs/contributing/gotchas.md` names it.

## More Information

Revisit when a second country gets a profile of its own (`CountryProfile`), or
when connecting factors other than the site (design 3.1: `office_seat`,
`client`, `contract`) gain their date sources: then the home country starts to
place a work, never a project. `home_country` becomes NOT NULL with the
`organization_unplaced` gate (build split S15), once no row is left without it.
