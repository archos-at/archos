---
status: proposed
date: 2026-11-10
decision-makers: engineering
consulted: the country base knowledge design (v7, §4.8, §5.2, §5.3, §5.4; edge cases E30, E31) and its build split (S12)
informed: everyone who places a project (setup, the intake, S15's turn context), and operators of every cell
---

# A site address resolves against official registers hosted in the cell, and stays unverified without a register hit; amends ADR-0122, ADR-0151 and ADR-0159

## Context and Problem Statement

A project's site decides its law (ADR-0158). Until now a person placed it by
typing an address, which the project dialog sent, keystroke by keystroke, to
komoot's public Photon (ADR-0151). That is a processor in no register, so
ADR-0159 switched it off by default: since then a typed address is kept as an
unconfirmed assumption, and the Land is suggested from the postcode alone. The
`address-search` operation is withheld from agents, because it only proxies a
public map.

Project setup needs more than a Land: the Gemeinde, whose building authority
decides, and a statement of where the answer came from. The question: where
does a typed address get confirmed, without any keystroke leaving the cell, and
what does the product say when it cannot be?

## Decision Drivers

- No keystroke leaves the cell to a third party (ADR-0161; design §6.1: "Address
  search: in the cell, `service`, no egress").
- Fail closed: no register hit means `unverified`, never a guess (design A1).
- A register hit gives what only we have: country, Land, Gemeinde, the territory
  chain and the competent authority, decided by the rulesets evaluator
  (ADR-0166) over the platform's territory and authority records (ADR-0165).
- A second country (Germany, E31) is a register and an importer, not new code
  paths.
- Buy, don't build: the register is the publisher's own; no geocoder of ours.

## Considered Options

1. **Import the official register into the cell's Postgres and look a typed line
   up by exact keys** (street, house number, postcode, place). Chosen.
2. **Self-host a geocoder (Photon, Nominatim, Pelias) over OpenStreetMap.**
3. **Query the publisher's own service per address** (BEV's INSPIRE WFS, the
   adressregister.at search).
4. **Keep komoot, now listed in the register.**

## Decision Outcome

Chosen option 1, because it is the only one where the answer is the official
register itself and no typed text leaves the cell.

- **Registers.** `bff/site-resolution/registers.ts` lists the registers a cell
  can host. Austria's is the BEV Adressregister (`at-bev`), its relational
  tables as of a reference date (CC BY 4.0, published twice a year). A
  register says how its municipality code becomes a territory id
  (`AT:gkz:60101`, ADR-0165's ids) and a Land (`AT-6`, the GKZ's first digit
  is ISO 3166-2:AT's number), the shape of its country's postcodes, and its
  download URL.
- **Tables.** Migration 0208: `address_register_releases` (one import on one
  reference date; `loading`, `active`, `retired`; one active per register) and
  `address_register_entries` (one address, keyed by the register's own id, with
  the keys the resolver compares). Platform tables (`secure_platform_table`):
  every tenant reads, only the platform role writes. Not knowledge records:
  2.5 million rows of a publisher's list are not claims a reviewer reads one by
  one; the release is the unit (below).
- **Import.** `scripts/import-address-register.ts` (`bun run register:import`)
  reads the archive, dry-run by default, and with `--apply` writes a `loading`
  release in batches, then swaps it in one transaction. A release that would
  shrink the active one by more than 5 %, or that is not newer than it, is
  refused and removed, and the active release stays (`--max-shrink` and
  `--allow-older` accept it, after a person looked). Growth is not checked.
  The download is the only egress: `data.bev.gv.at` is a row of
  `configs/subprocessors/public-sources.yaml`, and nothing anyone types is in
  it.
- **Keys.** `bff/site-resolution/normalize.ts` folds case, diacritics, `ß`, the
  `Str.` and `St.` abbreviations and every separator, nothing more. The
  importer writes the keys with it and the resolver reads a typed line with it,
  so SQL compares keys and never folds text.
- **Resolution.** `resolveSite` parses the line (`parse.ts`), looks the street
  and house number up in the active releases, and narrows: a postcode of the
  register country's shape must match; a postcode of another shape is evidence
  of another country and the register is not searched, unless the register
  lists it as cross-border (the Kleinwalsertal's 87567–87569 and Jungholz's
  87491, E30); a place must be the Gemeinde, the Ortschaft or the delivery
  place, or one of them before a district after a `-`, `,` or `/` ("Wien-Innere
  Stadt"), never a prefix of the key ("Wiener Neudorf" is not Wien), and a place the postcode's
  addresses do not lie in is `conflict`, never the postcode's address; a house
  number with a door
  (`12/3/4`) is tried as typed, then as `12`; a lot number (`GNR 310/4`) is the
  house number. Exactly one address, on a line that names a place, is
  `verified`. Otherwise `unverified` with a reason: `incomplete` (no street and
  number, or no place: a four-digit postcode alone is Switzerland's and
  Liechtenstein's shape too), `conflict`, `no_register` (none for the stated country, or none imported),
  `no_register_hit`, `ambiguous` (several in one Gemeinde) or `multi_leaf`
  (several Gemeinden, design §5.2), and up to eight register candidates. A
  stated country is kept as stated (A1): a line ending in "Deutschland" or
  prefixed `D-` is `no_register` until E31 brings Germany's.
- **Chain.** The site's chain is read from the platform's territory records
  (`readTerritoryParents`, ADR-0165), never built from the code: a Bezirk
  between Gemeinde and Land is kept. A Gemeinde no record holds has no chain;
  the address is still verified (the register's own Gemeinde and Land), and
  its authority is `undetermined: no_territory`, and no `site_territory` fact
  is written. The Gemeinde territories arrive with pack 1 (build split S8).
- **Authority.** `competence.ts` reads the competence rulesets in force for the
  chain (the office's own and the platform's) and decides with `decide(...)`
  over the facts `municipality`, `district` (a recorded Bezirk), `state` and
  `country`, each a territory id. The authority is named from its record. No
  ruleset is `undetermined: no_rule`; Austria's competence rulesets arrive with
  pack 1 (S8), so until then a verified Austrian site says its Gemeinde and
  Land and that its authority is not determined.
- **Writing the site.** `project-site-set` (`POST /api/projects/[id]/site`)
  writes through the profile's one door (`patchProjectProfile`, project:edit).
  A register address becomes confirmed facts (`site_address`, `country`,
  `federal_state`, `municipality`, `site_territory`) with `register` evidence
  (the address id and the reference date). No other write may add `register`
  evidence: the generic patch and replace refuse an entry the stored profile
  does not hold. A typed line the register does not
  confirm stays an unconfirmed assumption, as ADR-0158 has it, with the
  postcode's Land suggestion. The previous site's entries are removed first.
- **Behind a flag.** `site-resolution` (a rollout: public data, no cost per
  office). Off, both routes answer 403 and nothing else changes: the typed
  address is kept unconfirmed, and the geocoder is whatever the deployment set.

### Amendments

- **ADR-0122.** `site-resolve` and `project-site-set` are offered on the door:
  they answer with chains and registers only this deployment holds, which no
  calling agent's own map tools give. `address-search` stays withheld.
- **ADR-0151 and ADR-0159.** The geocoder is no longer the way to confirm an
  address. It stays as ADR-0159 left it, off unless a stack opts in, for the
  dialog's suggestions until the dialog moves to `site-resolve`.

### Rejected options and the premise each rests on

- **Option 2** rests on OpenStreetMap not being the official register: its
  completeness against the BEV's is unmeasured here, and an address in it
  carries no Gemeindekennziffer, so the Gemeinde must then be found by geometry
  against boundary polygons, a workload ADR-0151 already retired for a
  convenience. If a country's register ships no bulk file (some German Länder),
  revisit for that register only.
- **Option 3** rests on every lookup being a query to the publisher: the typed
  text leaves the cell, the publisher becomes a processor of it, and setup
  depends on its uptime, whatever the service costs.
- **Option 4** rests on komoot having no contract with us and OSM data behind
  it (the premise of option 2), so it would still not give a Gemeinde code.

### Consequences

- Good: a typed address is found or not in the register itself, with the
  reference date and the BEV's attribution, and nothing typed leaves the cell.
- Good: a German register (E31) is a second entry in `registers.ts`, an
  importer for its file, and a row in the data-flow register.
- Bad: the cell's Postgres holds the register: about 2.5 million rows for
  Austria, imported twice a year by an operator. The import is not scheduled
  yet.
- Bad: exact keys find what the register spells. A typo is `no_register_hit`;
  the spike below counts how often the ways people type an address still find
  it.
- Neutral: the register's coordinates are kept as published (MGI/Austria GK,
  EPSG 31254–31256), not reprojected; nothing reads them yet.

### The spike

200 addresses taken evenly from the BEV register of 2025-10-01 (2,516,345
addresses, 2,092 Gemeinden), each typed seven ways and resolved as the route
resolves them (`task workspace:register:spike`):

| Typed as | Verified | Verified and the typed address | Ambiguous or `multi_leaf` | Not found or `incomplete` | p50 / p95 |
|---|---|---|---|---|---|
| `Herrengasse 16, 8010 Graz` | 200 | 200 | 0 | 0 | 3.0 / 7.8 ms |
| `herrengasse 16 8010 graz`, `Str.` abbreviated | 200 | 200 | 0 | 0 | 2.6 / 4.9 ms |
| `8010 Graz, Herrengasse 16` | 200 | 200 | 0 | 0 | 3.4 / 7.1 ms |
| with a door, `Herrengasse 16/2/5, …` | 196 | 196 | 0 | 4 | 3.0 / 7.5 ms |
| without the postcode, `Herrengasse 16, Graz` | 199 | 199 | 1 | 0 | 3.0 / 6.8 ms |
| street and number alone | 0 | 0 | 61 | 139 | 3.0 / 6.3 ms |
| a house number the register does not hold | 0 | 0 | 0 | 200 | 1.4 / 3.4 ms |

The import took about a minute on the test machine. The four misses with a door
are lot numbers (`GNR 310/4`) with a door appended, which nobody types.  The
one line without a postcode that is not verified matched more than one
register address and stays unverified with them as candidates; it was
verified before the place match learned districts ("Wien-Innere Stadt"), which
widens what a place matches. A
verified answer was the typed address every time, and an absent number was
never verified.

The spike changed the design twice, before any of it shipped. The first run
found 189 of 200: seven lines named a street and number that more than 50
Gemeinden share ("Hauptplatz 7"), and the lookup's cap of 50 rows cut the one
the postcode named before the postcode was applied, so the postcode (or, without
one, the place) is now part of the SQL; and four were lot numbers (`Dallein GNR
310/4`) the parser read as a street. It also showed that a street and number
alone verified 139 of 200, because those addresses are unique in Austria: a
line that states no postcode and no place could be in a country this cell has
no register for, so it now stays `incomplete` and offers its candidates
(invariant A1).

An independent review of the branch then found three more ways a line could be
verified wrongly, each now a test: a postcode that matched while the place named
another Gemeinde (`8010 Wien` took Graz; now `conflict`), any five-digit postcode
being dropped as if it were the Kleinwalsertal's (now only the listed ones), and
a postcode with no place (now `incomplete`). It also found that a malformed
`--max-shrink` read as NaN switched the shrink guard off, and that `register`
evidence could be written through the generic profile patch.

### Confirmation

- `bff/site-resolution/site-resolution.integration.spec.ts` under
  `task db:test:rls`: `no_register` before the import; a register hit with
  country, Land, Gemeinde and chain; the authority `no_rule` without a ruleset
  and named once an office ruleset and a platform authority (published through
  a change request) decide it; `multi_leaf` with candidates; E30; Germany
  `no_register`; the site written as facts and replaced by an assumption; a
  second release retiring the first, a truncated one refused with the active
  one kept; a tenant refused a write.
- `bff/site-resolution/resolution.spec.ts` and `parse.spec.ts`: the keys, the
  parser, the narrowing on real BEV rows, the profile operations, competence.
- `bff/db/rls-coverage.spec.ts` holds the two tables as platform tables;
  `scripts/check_data_flow_register.py` holds the BEV host to its row.
- Nothing yet refuses a geocoder host at boot (design §6.5, B1); ADR-0159's
  default-off config is still the only guard on komoot.

## More Information

Code: `apps/workspace/bff/site-resolution/`, routes `app/api/sites/resolve` and
`app/api/projects/[id]/site`, operations in `bff/agent-api/catalog/knowledge.ts`
and `projects.ts`. Runbook: `docs/deployment/address-register.md`. Revisit when
Germany's register is built (E31), when the project dialog moves from the
geocoder to `site-resolve`, or when a register ships no bulk file.
