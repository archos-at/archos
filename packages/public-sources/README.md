# Public sources

Legal and geodata sources as **configured records**, not code (ADR-0162). A
record names a protocol (an *access type*, which fetches bytes) and a format
(an *engine*, which turns the bytes into anchored passages), and carries
everything that belongs to that one source: its URLs, vocabularies, hosts,
terms, what data may flow to it, and how a change is noticed.

Adding a country's statute database or a Land's portal is a new record and its
recorded fixtures. Code is written only for a new protocol or a new format.

A record lives in one of two places. A **repository file** under
`configs/sources/` (ADR-0162), or a **platform record** an operator's agent
proposes through the platform door (ADR-0174): the same shape, its recorded
responses inline or named by the citation capture the platform took of them
(`CapturedResponse`, for a PDF nobody can paste), parsed with
`parse_inline_source`, which refuses a repository record's id and file fixtures. The BFF keeps the database records, decides
which may fetch (published, or a draft within its own request's 24 hours) and
hands this package the configuration; the guard still holds the hosts and the
public addresses.

Which one a source is: a repository file (**built in**) only when its engine's
configuration is code-level, read by the agent's own tools (RIS, Fedlex);
every other source is a platform record. That class is being retired
(ADR-0174, amendment 2026-11-11): a source says how a law lookup reads it in
its `lookup` block, a turn carries the released ones of its countries, and a
repository file stays only as the fallback until its record is published. The rule, once:
[ADR-0174, Consequences](../../docs/adr/0174-public-sources-are-platform-records-kept-current-by-monitors.md#consequences).
`platform-knowledge-source-status` lists both (`POST /v1/public-sources/built-in`
gives it the built-in ones, with their fixtures' result).

## Where things are

| Path | What |
|---|---|
| `configs/sources/<territory>/<name>/source.yml` | One record. `at/ris` (Austria, `rest` + `ris_xml`), `ch/fedlex` (Switzerland, `http_eli` + `akn`) |
| `configs/sources/<territory>/<name>/fixtures/` | The recorded responses its fixtures replay |
| `src/source.py` | The record schema and loader. Unknown fields, URLs off the hosts and records without fixtures are refused; `parse_released_source` reads a released record as a turn carries it, without its fixtures |
| `src/lookup.py` | A record's `lookup` block: the locus grammar of its texts, the collections its search offers, the territory filter, the words a lookup writes back. What a country-neutral law lookup reads instead of code |
| `src/access/` | `rest`, `http_eli`, `web_document`, `ogc` (OGC API - Features, WFS 2.0), and the template language (`base.py`) |
| `src/engines/` | `ris_xml`, `akn`, `html_statute`, `geojson` (a FeatureCollection, a passage per feature), `pdf_document` (a passage per page, `page_<n>`) |
| `src/pdf.py` | A PDF's text for a capture and for `pdf_document`: ingestion's own text pass (`knowledge_layer.ingest.pdf_page_texts`), run in a child process (`src/pdf_reader.py`) with a deadline, a memory ceiling, a page and a text cap, a bare environment, and a problem code per refusal. One PDF pipeline, not a second reader |
| `src/monitor.py` | One monitor check: the record's `monitor.probe` against what was seen last (`sha256`, `etag`, `version`) and the terms page's hash; no model call |
| `src/capture.py` | One page for a citation capture (ADR-0170) |
| `src/egress.py` | The guard: hosts at every hop, public addresses after DNS, the headers that may leave |
| `src/routing.py` | The transport a caller uses: through the fetcher (`PUBLIC_SOURCE_FETCHER_URL`), and refused without one; a test hands in a transport |
| `src/fetcher.py` | The sandboxed fetcher service (`python -m public_sources.fetcher`), deployed by `deploy/pulumi/src/app/public-source-fetcher.ts` |
| `src/fixtures.py`, `src/__main__.py` | `source-test`: run a record's fixtures. A response that is a capture is read by `Engine.recorded_document` (`pdf_document` only: its capture text is the engine's own reading); one whose capture was not handed over is `awaiting`, never a pass |

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

A source whose protocol or format is not in the tables of ADR-0162 needs an
access type or an engine first: a class in `src/access/` or `src/engines/`
with its configuration model, registered in that package's `__init__.py`, and
tests. That is the only code a new country can need: the registry's keys are
the one list of protocols and formats, which the `vocabularies` hook writes into
the UI (`apps/workspace/shared/vocabularies.generated.ts`), and no migration or
CHECK lists them (0216).

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
- **A site point goes only to a site-keyed source.** `ogc` refuses a `bbox` on
  a `public_only` source before the request is built.
- **A key is never in a record.** A keyed source names the header
  (`credential: {header, prefix}`); the BFF stores the key write-only and hands
  it over per fetch, and the guard sets it after the strip, on the source's
  hosts only. The fetcher never keeps it on a client another request reuses.
- **Tests replay, never fetch.** No live call in a test.
