# Public sources

Legal and geodata sources as **configured records**, not code (ADR-0158). A
record names a protocol (an *access type*, which fetches bytes) and a format
(an *engine*, which turns the bytes into anchored passages), and carries
everything that belongs to that one source: its URLs, vocabularies, hosts,
terms, what data may flow to it, and how a change is noticed.

Adding a country's statute database or a Land's portal is a new record and its
recorded fixtures. Code is written only for a new protocol or a new format.

## Where things are

| Path | What |
|---|---|
| `configs/sources/<territory>/<name>/source.yml` | One record. `at/ris` (Austria, `rest` + `ris_xml`), `ch/fedlex` (Switzerland, `http_eli` + `akn`) |
| `configs/sources/<territory>/<name>/fixtures/` | The recorded responses its fixtures replay |
| `src/source.py` | The record schema and loader. Unknown fields, URLs off the hosts and records without fixtures are refused |
| `src/access/` | `rest`, `http_eli`, `web_document`, and the template language (`base.py`) |
| `src/engines/` | `ris_xml`, `akn`, `html_statute` |
| `src/egress.py` | The guard: hosts at every hop, public addresses after DNS, the headers that may leave |
| `src/routing.py` | The transport a caller uses: through the fetcher when `PUBLIC_SOURCE_FETCHER_URL` is set, the guard in process when not |
| `src/fetcher.py` | The sandboxed fetcher service (`python -m public_sources.fetcher`), deployed by `deploy/pulumi/src/app/public-source-fetcher.ts` |
| `src/monitor.py` | Deterministic change monitors and the review item they produce |
| `src/fixtures.py`, `src/__main__.py` | `source-test`: run a record's fixtures |

## Adding a source

1. Find the publisher's own interface. Prefer, in this order: an ELI or Akoma
   Ntoso service, a documented REST API, published pages. Read its terms; the
   licence class goes into `terms.licence`.
2. Write `configs/sources/<territory>/<name>/source.yml`. Copy the record whose
   protocol matches (`at/ris` for `rest`, `ch/fedlex` for `http_eli`).
3. Record one exchange per operation you use: fetch each URL the access type
   will request once, by hand, save it under `fixtures/`, and name it in
   `fixtures[].responses`. Say in `expect` what the engine must find (title,
   anchors in order, text it contains, text it must have dropped).
4. Run it:

   ```bash
   .venv/bin/python -m public_sources test <id>
   .venv/bin/pytest packages/public-sources/tests -q
   ```

   A request the record builds that the fixture did not record fails the run,
   so the fixture proves the request as much as the parse.

A source whose protocol or format is not in the tables of ADR-0158 needs an
access type or an engine first: a class in `src/access/` or `src/engines/`
with its configuration model, registered in that package's `__init__.py`, and
tests. That is the only code a new country can need.

## Rules

- **Records are reviewed like code.** A record change re-parses law for every
  tenant that reads that source. `test_source_fixtures.py` runs every record on
  every commit.
- **The template language stays small.** `{arg}`, `{table[arg]}`, literals; a
  parameter that renders empty is not sent. A source that needs logic is a new
  access type, not a cleverer template.
- **Every argument that lands in a URL path or a query string is patterned**
  (`http_eli` refuses an argument without a declared pattern), so a model's
  argument cannot rewrite the request.
- **Nothing tenant-specific leaves.** The guard forwards only the headers in
  `egress.FORWARDED_HEADERS`; a `site_keyed` source needs a privacy review and a
  register row before it is published (design 6.4).
- **Tests replay, never fetch.** No live call in a test.
