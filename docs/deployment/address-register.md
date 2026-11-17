# Address register: importing the BEV Adressregister into a cell

A typed site address is confirmed against the official address register held in
the cell's own Postgres (ADR-0172), never at a public geocoder. Austria's is the
BEV Adressregister. Until a cell has imported a release, every typed address
resolves `unverified: no_register`, and setup keeps it as an unconfirmed
assumption: nothing breaks, nothing is confirmed.

## What you import

The BEV's relational tables as of a reference date ("Adresse Relationale
Tabellen – Stichtagsdaten"), published twice a year (around 1 April and
1 October) under CC BY 4.0, about 100 MB zipped:

```
https://data.bev.gv.at/download/Adressregister/Archiv_Adressregister/Adresse_Relationale_Tabellen_Stichtagsdaten_<YYYYMMDD>.zip
```

The catalogue (`data.bev.gv.at`, search "Adresse Relationale Tabellen") lists
every reference date. The archive names its own in `Aktualitaetsstand.txt`.
The BEV's licence asks every use to quote "© Österreichisches Adressregister"
with the reference date; the resolver carries it on every answer
(`register.attribution`).

## Running it

From `apps/workspace`, with the cell's database reachable (a port-forward to
the CloudNativePG service, or a shell in the cluster):

```bash
# 1. Dry run: parse the archive, count, write nothing.
bun run register:import -- --zip ./Adresse_Relationale_Tabellen_Stichtagsdaten_20251001.zip
#    at-bev 2025-10-01: 2516345 addresses, 0 rows skipped, 2092 municipalities.

# 2. Import it as a new release and make it the active one.
APP_DATABASE_URL=postgres://app_rw:…@…/app \
  bun run register:import -- --zip ./Adresse_Relationale_Tabellen_Stichtagsdaten_20251001.zip --apply
```

`--download --reference-date 2025-10-01` fetches the archive instead of
`--zip`; the machine running it then needs `data.bev.gv.at`, which is listed in
the data-flow register (`configs/subprocessors/public-sources.yaml`). Only the
archive comes in; nothing anyone typed goes out.

`--apply` connects as the runtime role and steps up to the platform role per
transaction, the one role that writes platform tables. It writes a `loading`
release in batches (a lookup never reads it), then swaps it in: the new release
becomes `active`, the previous one `retired`, and the retired release's rows
are deleted. A full Austrian import takes a few minutes and adds about 2.5
million rows.

**Memory and the swap.** The importer holds the archive and its unzipped
tables in memory: about 1.3 GB peak for Austria (measured on the dry run of
the 2025-10-01 archive), so run it where that fits, not in a frontend pod. The
swap is one transaction that retires the active release and deletes its
roughly 2.5 million rows; until it commits, every lookup reads the old release
(Postgres reads the snapshot it started with), and the delete's WAL is about
the size of the release, so run it outside office hours on a small cell.

## When it refuses

- `ReleaseRefusedError: … at least N are needed (maxShrink 0.05)`: the new
  release has more than 5 % fewer addresses than the active one. A register
  does not lose that many between two reference dates; a truncated download or
  a changed file format does. The new release is removed and the active one
  stays. Look at the dry run's counts and `rows skipped`; pass
  `--max-shrink 0.2` only once you know why.
- `… is not after the active release's …`: the archive is not newer than the
  one in use. To roll back to it on purpose, pass `--allow-older`.
- `--max-shrink is a number from 0 to below 1`: the value did not parse; the
  guard is never switched off by a typo.
- `The archive has no ADRESSE.csv`: not the relational tables (the INSPIRE
  GeoPackage and CSV are a different product).
- `--reference-date X, but the archive says Y`: the wrong file.

## Checking it

```sql
SELECT register, reference_date, status, entry_count, activated_at
FROM address_register_releases ORDER BY imported_at DESC;
```

Then resolve a known address through the door or the route
(`GET /api/sites/resolve?q=Herrengasse 16, 8010 Graz`): `status: verified`
with `municipality.code` `60101`. The `site-resolution` flag must be on for the
organization (a rollout flag in WorkOS).

## Rolling back

Re-import the previous archive with `--apply --allow-older` (and
`--max-shrink` if it is smaller). An import that died leaves a `loading`
release no lookup reads; the next import removes it once it is a day old. The tables are dropped only by migration 0210's down.
