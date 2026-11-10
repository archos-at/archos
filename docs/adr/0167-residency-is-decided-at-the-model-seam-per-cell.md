---
status: proposed
date: 2026-11-10
decision-makers: engineering
consulted: the country base knowledge design (v7, sections 6.1 to 6.5, build split S14) and its review
informed: everyone who adds a model call, a model endpoint or an audit event, and whoever answers a data-protection officer
---

# Residency is decided at the model seam, per cell, and every generation records where it ran

## Context and Problem Statement

"Where does our data go?" is the first question a buyer's data-protection officer asks, and a second
country needs it answered per office. Until now the answer was a preference: zero data retention
(ADR-0074) was switchable per organization, and `OPENROUTER_PREFERRED_PROVIDERS` asked OpenRouter to
try EU endpoints first, with fallbacks anywhere. Embeddings, vision, reranking and the chat models
all called the global gateway `openrouter.ai`, which runs in the US. Nothing refused a call outside
the EU, nothing recorded where a call ran, and the judges graded any organization's turns.

Every model call already passes one of two seams (ADR-0164): the httpx transport of
`common/openrouter.py` for the bespoke call sites, and the chat-request contract of
`common/llm_factory.py` for every LangChain chat model. The data-flow register
(`configs/subprocessors/*.yaml`) already names each processor and a processing location per flow.

## Decision Drivers

- **Provable, per generation.** The answer to the officer is a recorded fact on every generation,
  not a configuration someone believes.
- **Fail closed on unknown.** A host the register does not place is in no zone; a policy that cannot
  be read allows the service alone; a cell nobody defined refuses to start.
- **Flag off is unchanged.** Without a cell nothing is rewritten or refused.
- **Zero retention and the licensed-text rules keep holding.** Routing is added on top of the pin,
  never instead of it.
- **One code path.** No second client per zone, no per-call-site switch.

## Considered Options

1. **A cell names its zone; the seam rewrites into it and refuses outside it; the register places
   each host.**
2. **Per-organization zones**: each office picks `eu` or `any`, and the seam routes per request.
3. **Configuration only**: point every base URL at `eu.openrouter.ai` and trust it.

## Decision Outcome

Option 1.

- **A cell is one deployment** (`configs/residency/cells.yaml`, `eu-at-1` with zone `eu`), named by
  `RESIDENCY_CELL`. A zone is a set of processing locations (ISO 3166 codes, `EU` for the Union)
  and the rewrites that keep a call inside it (`openrouter.ai` to `eu.openrouter.ai`).
- **The register places hosts.** A processor row may list `endpoints`, each a host and its
  processing location (`eu.openrouter.ai` in `EU`, `openrouter.ai` in `US`). The location and the
  row's id are what a generation records as `processing_location` and `subprocessor`.
- **The seam routes and refuses.** `common/residency.enforce` rewrites a URL into the zone, judges
  it against the register, records the route and raises `ResidencyViolation` outside the zone. The
  transport does it for every bespoke call (embeddings, vision, reranking, summaries, titles,
  decisions, the distiller, dictation, the judge scripts); the chat contract judges the chat
  model's fixed base URL, which a cell sets through `OPENROUTER_BASE_URL`.
- **An office is placed in a cell** (`organizations.residency_cell`, migration 0205). A deployment
  refuses to serve an organization placed in another cell, or one whose placement cannot be read,
  on every path: both transports and the chat contract check the request's organization (off the
  event loop on the async paths), and `data_policy_for` checks it for detached work. NULL is served
  by the cell it reaches. A call with no organization is pinned to zero retention inside a cell.
- **Zero retention is the cell's promise.** Inside a cell the organization's switch cannot turn it
  off: the backend pins whatever is stored, and the BFF refuses the switch (409).
- **Bring-your-own-key is held to the zone.** An office's OpenRouter key is rewritten to the zone's
  host; any other endpoint is unplaced and refused inside a cell.
- **Purposes.** `organization_processing_policies` (migration 0205) holds what an office's data may
  be processed for; no row reads as `service`, `quality_evaluation`, `human_review`, and
  `product_improvement` is opt-in. Every chat trace carries `cell`, `purpose_ok` and
  `processing_policy_version`, and is tagged `purpose_ok:quality_evaluation` when that purpose is
  allowed. The judge rule requires the tag (include-only): a trace without it is never judged.
- **Recording.** A direct generation receives its route through a sink the seam calls; a chat
  generation carries it in `response_metadata`, which the span exporter keeps and
  `ProcessingLocationProcessor` lifts onto the generation. The seam writes the trace score
  `processing-location-compliant` once per distinct route.
- **Audit.** Inside a cell, names in WorkOS audit events (WorkOS keeps them in the US) leave as
  HMAC-SHA256 hashes under `AUDIT_NAME_SALT`, keyed per organization, or are withheld without it.
- **Boot.** `assert_residency` runs beside `assert_no_latent_vendor` in every Python process and
  refuses an unknown cell, an unset `OPENROUTER_BASE_URL`, and any model base URL the zone cannot
  hold after its rewrite.

### Consequences

- Good: one place answers "where", and the answer is on every generation and every trace.
- Good: a planted non-EU endpoint fails the boot; one reached at runtime fails the call before any
  byte leaves.
- Good: without a cell the score already measures what switching it on would refuse.
- Bad: `eu.openrouter.ai` needs OpenRouter's Business or Enterprise contract (design decision 6);
  until it is signed no deployment can set a cell.
- Bad: a model with no EU upstream fails inside an EU cell. That is the promise working: it is not
  offered, never silently rerouted.
- Neutral: the Langfuse judge rule's new filter reaches Langfuse only through
  `task langfuse:provision -- --apply`, which a person runs; until then it reports config drift.

### Confirmation

`packages/agent/tests/common/test_residency.py` drives the real transport, the async limited client
and the chat contract with a cell set and unset, plants a non-EU endpoint at boot and at runtime,
and patches each guard out to show the planted call then leaves (the revert check).
`apps/workspace/bff/audit/residency-names.spec.ts` and the ZDR route spec hold the BFF's half;
`tests/test_data_flow_register.py` holds the `endpoints` schema.

## Pros and Cons of the Options

### Per-organization zones

- Good: one deployment could serve an `any` office and an `eu` office.
- Bad: the chat models are built once per process on one base URL; per-request zones would rebuild
  a client per turn or keep a pool per zone.
- Bad: an office in an EU cell choosing `any` would make the cell's promise depend on a switch,
  the problem ZDR's switch already had. Offices that need another zone get another cell.

### Configuration only

- Good: no code.
- Bad: a default base URL in any call site (there are a dozen) silently stays global; nothing
  proves the answer on a generation.

## More Information

- Amends ADR-0074 (zero retention is no longer switchable inside a cell) and builds on ADR-0164.
- Deferred, each with its trigger: a writer for `organization_processing_policies` (the first office
  that opts into `product_improvement`); gating the lessons distiller on `product_improvement`
  (the same); staff break-glass access (the first staff read of tenant content outside the
  operator console); the egress proxy and in-process egress clients for non-model flows (design
  6.5, B4 and B7).
