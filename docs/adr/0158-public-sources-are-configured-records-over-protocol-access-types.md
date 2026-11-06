---
status: proposed
date: 2026-11-06
decision-makers: engineering
consulted: the country base knowledge design (claude/intl-design, design.md 4.1, 4.2, 6.4)
informed: everyone who adds a legal or geodata source, and whoever reviews one
---

# Public sources are configured records over protocol access types, fetched from a sandbox

## Context and Problem Statement

Austria's legal database was code. `packages/ris-adapter` held the OGD-RIS hosts,
the application-to-controller map, the document path segments, the nine
Bundesland search parameters and which date parameter each application takes,
and two more copies of the Bundesland table lived in the norm admin route and
the catalog builder. A second country would have been a second adapter: code
written, reviewed and deployed per country, by a developer.

The international foundation needs a country onboarded by an operator's agent
and an expert reviewer, without a developer (design 4.1). The question this
record answers: what a legal or geodata source is, what is code and what is
data, and where its requests are made.

## Decision Drivers

- **A new country is data.** Code is written for a new protocol or a new
  format, once, for every later source of that kind (design 4.2).
- **Proven before used.** A record is accepted only with recorded fixtures that
  its own access type and engine pass, with no live call.
- **Fetching public sources cannot reach the cluster.** The fetch takes URLs
  that originate, one step removed, from a model and from the publisher's own
  redirects.
- **Nothing about a tenant leaves beyond what the source contract allows.**
- **Austrian answers do not change.** The adapter's requests stay byte-identical.
- **Industry standards and their names**: ELI, Akoma Ntoso, OpenAPI's shape of a
  read, SPARQL where the publisher resolves ELI that way.

## Considered Options

1. **A source record over access types and engines** (chosen).
2. **One adapter package per country**, as `ris-adapter` was. Rejected: code per
   country, which is what the foundation removes.
3. **A generic HTTP tool the agent drives with URLs.** Rejected: no host list,
   no fixtures, no anchors; every answer would cite a URL instead of a provision.
4. **Buy an aggregator** (a commercial legal API). Rejected for now: none covers
   RIS, Fedlex and the Länder portals together, and each is a new processor.

## Decision Outcome

Chosen option 1, in a new package `packages/public-sources` (import
`public_sources`) and records under `configs/sources/<territory>/<name>/source.yml`.

### What a record says

`id`, `territory` (ISO 3166), `protocol`, `format`, `hosts` (exact DNS names),
`data_flow` (`public_only` or `site_keyed`), `terms` (URL, licence class
`public_open | public_restricted | licensed`, attribution, the day checked),
`monitor` (`sha256 | etag | version | none`), the protocol's `access`
configuration, the format's `engine` configuration, and `fixtures`. Unknown
fields are refused, so a misspelt key cannot be ignored silently.

### Access types (protocols) and engines (formats)

| Access type | Speaks | First record |
|---|---|---|
| `rest` | a GET API: base URL, a path and parameters per operation, as templates over the arguments and the record's tables | `at-ris` |
| `http_eli` | ELI expression URIs, with a `direct` or `sparql` resolver to the manifestation; every argument has a declared pattern | `ch-fedlex` |
| `web_document` | a list of published pages, with `If-None-Match` | test record |

| Engine | Reads | First record |
|---|---|---|
| `ris_xml` | the OGD-RIS search payload and RIS document pages (moved from `ris_adapter.client`, which re-exports it) | `at-ris` |
| `akn` | Akoma Ntoso: passages per configured unit, anchored by `eId`, notes dropped | `ch-fedlex` |
| `html_statute` | an HTML statute by XPath, anchored AKN-style (`§ 6a` -> `para_6a`) | test record |

The template language is `{arg}`, `{table[arg]}` and literals; a parameter that
renders empty is not sent. That one rule is how a record says "`Fassung.FassungVom`
only for consolidated federal law" as a table instead of an `if`.

`ogc`, `bulk_file` and `arcgis_rest` are not built: no source in a pack needs
them yet (the brief: do not build connectors for countries we do not have).
OWSLib is the dependency for `ogc` when one does.

### Where requests are made: `sourceRouting`

`public_sources.routing.source_transport(id)` is an httpx transport. With
`PUBLIC_SOURCE_FETCHER_URL` set it sends each request to the
`public-source-fetcher` Deployment; without it the same guard runs in process.
The guard refuses a URL off the record's hosts at every redirect hop, opens TCP
only to an address it resolved itself and found globally routable (so a
rebinding name cannot reach the cluster; TLS still verifies the host name),
allows GET and the SPARQL POST, and forwards only `Accept`, `Accept-Language`,
`If-None-Match`, `If-Modified-Since` and `Content-Type`.

The fetcher's NetworkPolicy admits the chat, api and agent-worker roles and
allows egress to DNS and to public addresses on 443 only. On Cilium a CIDR
rule never matches a cluster identity, so no pod or Service is reachable from it.

The RIS client chooses per request: the `source-routing` WorkOS flag of the
turn's organization (`GET /api/internal/stages`, `features.sourceRouting`),
default off, any failure read as off. The requests are identical either way;
`packages/ris-adapter/tests/test_source_routing.py` holds that.

### Monitors

Deterministic, no model call: a `Snapshot` of the bytes' sha256, the server's
ETag, the protocol's version and a hash per passage anchor; `changes_since`
under the record's `monitor.kind` yields a `Change` with the changed, added and
removed anchors and `needs` (`review_text`, `new_edition`, `recheck_relations`).
`Change.review_item()` is the shape a review queue takes. The queue, the inbox
item and the change request belong to the platform records (build S7); nothing
here schedules a monitor yet.

### Consequences

- Good: a statute database or a portal is a reviewed file and its fixtures.
  `python -m public_sources test <id>` is what an operator's agent runs before
  proposing one.
- Good: the Bundesland table has one home; the norm admin route and the catalog
  builder read it from the record instead of their own copies.
- Good: the Austrian requests are frozen in a parity test against the code they
  replaced, parameter order included (it is part of the search cache key).
- Bad: the record's template language is a small language to learn. It is
  deliberately too small to express logic; a source that needs logic is a new
  access type.
- Bad: `GuardedTransport` replaces httpx's private connection pool to plug in a
  network backend httpx does not expose. `test_egress.py` fails if an httpx
  upgrade renames it.
- Neutral: records load from the repository and deploy with the image. Records
  as database rows behind change requests (design 4.4) are the next step and
  reuse the schema here.

### Confirmation

`packages/public-sources/tests` (every record's fixtures, the guard, the
fetcher, the engines, the monitors), `packages/ris-adapter/tests/test_source_record_parity.py`,
`test_source_routing.py`, `deploy/pulumi/src/app/public-source-fetcher.spec.ts`,
and the answer suite before and after with `SOURCE_ROUTING=on`.

## More Information

- Design: `docs/design/international/design.md` 4.2 and 6.4 on `claude/intl-design`.
- ELI: Council conclusions 2012/C 325/02 and 2017/C 441/05. Fedlex resolves ELI
  through JOLux SPARQL (`https://fedlex.data.admin.ch/sparqlendpoint`).
- Akoma Ntoso: OASIS LegalDocML 1.0.
