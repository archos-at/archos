---
status: proposed
date: 2026-11-10
decision-makers: engineering, with the product owner's goal for the build ("the old paths gone")
consulted: the country base knowledge build split (Wave 5, the cut-over), ADR-0158 to ADR-0174
informed: everyone who reads an answer or a project page about the law of a site, operators who publish a country, and whoever switches flags in WorkOS
---

# The cut-over removes the Austria-only paths and their switches; amends ADR-0158 to ADR-0174

## Context and Problem Statement

Waves 1 to 4 of the country base knowledge build added every new path beside
the old Austria-only one, each behind a WorkOS switch whose off state was the
old path, byte for byte. That made each piece safe to merge, and left the
product with two answers to one question: which law applies here. An office
with `building-law-chain` off read OIB-RL 2:2023 as binding in every Land; with
it on, 2019 in Styria. The Steckbrief named Austria's OIB guidelines for a site
in Bavaria (`bff/oib/applicable-standards.ts`, no country gate), while the turn
read the records. And who reads which country was decided twice: by the
entitlement rows (`knowledge_country_entitled`) and by whether a switch was
targeted at the office.

The question: once Austria is published as records in every environment, what
stays switched, and what goes?

## Decision Drivers

- One answer to "which law applies here", read from the records, the same on
  the page and in the turn.
- Who reads which country is the entitlement rows, never a switch.
- Fail closed: a context that cannot be read is `knowledge_unavailable`, never
  "no context" and never the old guess.
- A switch stays only where it gates data or a contract that does not exist
  yet, or a per-office decision that is not old-versus-new.

## Considered Options

1. Keep the switches and turn them on everywhere.
2. Remove the switches and the old paths together, in one release after the data is there.
3. Remove the old paths and keep the switches as kill switches.

## Decision Outcome

Chosen option 2. A switch whose off state is an old path is a second answer
kept alive; a switch on everywhere is that answer one targeting mistake away.

- Option 1 is rejected on the premise that WorkOS targets flags per
  organization: a new office or a missed target reads the old path. Were flags
  ever on by default for every organization with no per-office target, the
  objection would weaken, though the old code would still have to be kept.
- Option 3 is rejected on the premise that the off state of each switch is an
  old path in code (the OIB list, the host regex, the stub): a kill switch must
  switch to something, and here it switches back to the guess this build
  replaced. A switch whose off state were a refusal would be a fair kill switch;
  none of the five is.

### Removed, with the paths they chose between

| Switch | Off was | Now |
|---|---|---|
| `knowledge-context` (ADR-0173) | no `knowledgeContext` on the turn | every turn carries it; unreadable is the gate's `knowledge_unavailable`, so the agent fails closed. The four routes (`coverage-get`, `base-knowledge-report`, `project-base-get`, `-confirm`) answer every office; the base corpus is filtered by the entitled countries on every request |
| `building-law-chain` (ADR-0168) | no `buildingLaw`; every source kept `citations/binding.py`'s status | the chain is resolved for every project with a site |
| `time-editions` (ADR-0171) | the as-of route 403, `law-lookup` without `as_of` | every office; `GET /api/internal/stages` keeps `timeEditions: true` only so an agent built before the cut-over offers `as_of`, and the key goes once none is deployed |
| `platform-base-knowledge` (ADR-0165) | the platform routes 403; offices read the stub (nothing); the norm registry took edits | the platform routes need their platform permission only; an office reads the released records of its entitled countries; the norm registry answers 409 always (its route, operation and editor go with the contract step that drops `norm_registry`) |
| `office-base-knowledge` (ADR-0163) | the office's base knowledge routes 403 and no block on the turn | every office. It waited for the licensed seam; the seam exists, and `licensed-seam` still decides whether licensed text reaches a model |

The paths that went with them:

- `bff/oib/` (the OIB verdict list, the TypeScript twin of the agent's
  `common/applicability.py`), its overview panel, chips, the
  `GET /api/projects/[id]/standards` route and the `project-standards-get`
  operation. The Steckbrief's „Was für dieses Projekt gilt“ shows
  `projectLawFor` (`bff/base-knowledge/context/project-law.ts`): the gate and
  the uses of the turn's own cached resolution, in the turn's roles and with
  its qualifier (open coverage names binding law uncurated and the rest
  information; a work that connects by more than the site informs), named from
  the graph the context was resolved on. So the page and the answer name the
  same law in the same role, with no second read. Where the gate refuses (no
  home country, no site, not entitled, unreadable, no coverage) the card says
  why. `project-base-get` carries the same `law`. The update of the old norm
  registry is withheld from the platform door (it only answers 409), and its
  console view is read-only with a pointer to change requests.
- `bff/base-knowledge/platform/applicability.ts`, which decided a platform
  directive's reach from an authority record's own territory list (the interim
  path, design §8.1). The competence rulesets of the site's chain decide it now
  (`directiveVerdict` in `bff/base-knowledge/platform.ts`, over
  `competentAuthorities`); where they decide nothing the authority is unknown.
  `siteFacts` reads a chain whose leaf is a state as that state, so a project
  placed only to its Land is decided.
- Five hand-written lists of Austria's Länder (the create form's picker, the
  contradiction check, the platform reviewer's names, the register's names, the
  reading's token map) read `SITE_SUBDIVISIONS`, from the shipped AT seed of the
  country's `fact_definitions` record (`rulesets/seeds/at-setup-fact-definitions.json`,
  ADR-0169). The picker still names each Land in the reader's language
  (`form.site.state.<token>`).

### Kept, and why

| Switch | Why it stays |
|---|---|
| `licensed-seam` (ADR-0164) | A per-office licence decision, not an old path: off lists a licensed passage without its text, which is the right answer for an office that has not attested its licence (design 4.7) |
| `source-routing` (ADR-0162) | Its off state is an old path (the agent fetches public sources from its own pod), but that path lives in the agent tier (`packages/`) and the fetcher Deployment must run in every environment before it can go. It goes in the release after the fetcher runs in production |
| `site-resolution` (ADR-0172) | Gates the BEV import, data a cell does not hold yet |
| `source-monitors` (ADR-0174) | Gates a sweep that fetches and writes; switched on per environment once its sources are published |
| the residency switches (ADR-0167) | Gate the EU contract, which does not exist yet |

### Release order

1. A production release of develop as it stood before this change: switches
   off, no behaviour change, and the platform door in production.
2. Austria onto staging, then production, through the platform door
   (`records-propose`, review, preview, stable), coverage `core`.
3. This change and the agent's (R1) merge once staging has the data and the
   answer suite passes with the new path; production takes them in the release
   after step 2 reached production. Merged earlier, an environment would have
   no Austrian law at all: there is no seed path (design 7).
4. After the merge the WorkOS flags `knowledge-context`, `building-law-chain`,
   `time-editions`, `platform-base-knowledge` and `office-base-knowledge` are
   deleted in both environments (`docs/deployment/workos-provisioning.md`,
   "Retired flags").

### Consequences

- Good: one answer to which law applies, read from records the platform
  reviewed; the page and the turn agree.
- Good: an office reads a country because it is entitled to it, nothing else.
- Good: a German project no longer shows Austria's OIB guidelines.
- Bad: an environment without the Austria records answers no Austrian law.
  The release order above is the guard; nothing in code falls back.
- Bad: offices that had none of the switches see the Steckbrief card change
  from OIB verdicts to the law the records name, and the base knowledge card
  in their settings.
- Bad, until its own change lands: the OIB list narrowed by the building
  (OIB-RL 2.1 for a Betriebsbau, 2.2 for a garage, 2.3 for a high-rise by its
  escape level), the reason on each chip, its source link and the door's
  `decidingFact` went with `bff/oib`. They return as data, not code: the
  applicability conditions as rules over the building facts run by the one
  evaluator (ADR-0166, `classification-evaluate`), so the chain narrows by the
  building as well as by the site, each chip with its reason and the source
  link of its edition's manifestation. That change follows this one; Wave 5
  is done only once it has landed.

### Confirmation

- `bff/authz/feature-flags.spec.ts` fails if a retired slug returns to the registry.
- `tests/cut-over.spec.ts` fails if a removed path returns, if a source reads a
  name of the old paths, or if a list of Austria's Länder is written into code.
- `app/api/internal/turn-context/route.spec.ts`: the turn context always
  carries `knowledgeContext`, and its schema refuses one without.
- `bff/base-knowledge/context/project-law.spec.ts`: the page names the chain's
  editions with the turn's roles (OIB-RL 2:2019 binding in Styria, 2023
  guidance), nothing where the gate refuses, `knowledge_unavailable` when the
  chain cannot be read.
- `bff/base-knowledge/platform.spec.ts` and the MA 37 case in
  `platform/platform.integration.spec.ts`: a directive applies where the
  competence rulesets name its authority.

## More Information

The agent's half (R1) removes `citations/binding.py`, the static
`<building_law>` block, `common/applicability.py` and every fallback taken when
a turn has no knowledge context. The contract between the halves: the
knowledge context is always present on a turn.
