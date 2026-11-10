# The data-flow register

Decision: [ADR-0161](../adr/0161-every-outbound-flow-is-a-row-in-one-data-flow-register.md).

Every place data leaves our cluster is one row in `configs/subprocessors/`: which
processor, which data, for what purpose, where it is processed, on which transfer
safeguard, and what deletion at contract end reaches. Two things are generated
from the rows and never edited by hand:

- the tables and lists of the public page `/legal/subprocessors`
  (`apps/workspace/bff/legal/content/subprocessors.generated.ts`, placed by
  `de.ts` and `en.ts` between their own paragraphs);
- the DPA annex, [`dpa-subprocessor-annex.md`](dpa-subprocessor-annex.md), with
  what the page leaves out: the contract status, the data classes, the purposes
  and transfer safeguards as [DPV](https://w3id.org/dpv) terms, and every store
  where deletion at contract end does not reach yet.

[`external-dependencies.md`](external-dependencies.md) is the July 2026 audit
that preceded the register; where the two disagree, the register is right.

## The ratchet

`scripts/check_data_flow_register.py` (the `data-flow-register` pre-commit hook,
and `tests/test_data_flow_register.py` in the backend suite) reads every file that
ships or deploys: the whole of `apps/`, `packages/`, `deploy/` and `configs/`
(the website, the CMS, Helm and `ifc-spatial-py` included), plus Compose,
`deploy/.env.example` and the env reference. It fails each thing that opens a flow
and that no file names:

| Found | Must be named by |
|---|---|
| A variable ending `_URL`, `_HOST`, `_ENDPOINT`, `_KEY`, `_TOKEN`, `_TOKEN_ID`, `_SECRET` or `_DSN` | a row's `env` or `activation_env`, `build.yaml`, `in-cluster.yaml`'s `env`, or `not-flows.yaml` |
| A host: `http(s)://` or `ws(s)://`, one built in an f-string or a template (its fixed part), a quoted bare hostname under a public suffix, or a public IPv4 address | a row's `hosts` (a subdomain counts), `public-sources.yaml`, `build.yaml`, `in-cluster.yaml`'s `hosts`, or `not-flows.yaml` |
| A default model id (`DICTATION_MODEL = "elevenlabs/…"`, `model_name: ${DEFAULT_MODEL:-openai/…}`) | a row's `model_vendors`, or `not-flows.yaml` |
| A `.hog` file under `deploy/posthog/` | a row's `hog_files` |
| A destination id in `deploy/posthog/README.md`, whole or cut short (`01a15d7e…`) | a row's `posthog_destinations` (a short id is claimed by a full one it starts), or `not-flows.yaml` |
| A direct runtime dependency (the `pyproject.toml` of the agent, its packages and `ifc-spatial-py`; the `package.json` of the workspace, the CMS and the website): an SDK reaches its vendor's default host with no URL in our code | a row's `sdks` (`py:<name>` or `js:<name>`), or `not-flows.yaml`'s `packages`, grouped under the reason it opens no flow of its own |
| A latent row's `activation_config` pattern in a config under `configs/` (Modal's `deep_research_sandbox`) | nothing: the vendor must become `active` first |

Every row must name at least one thing the scan finds (`hosts`, `env`,
`activation_env`, `sdks`, `hog_files`, `posthog_destinations`, `model_vendors`),
or say why not in `no_signal`. Otherwise deleting the row would leave the check
clean.

A retired variable name counts as the name it is read as now (`current_name` in
`apps/agent-host/entrypoint.py`), so the register lists only current names. Each
kind of flow has a positive control in `tests/test_data_flow_register.py`: it
plants the flow in a scratch tree and asserts the scan fails on it.

Only files git tracks are read: what a local build writes and `.gitignore` names
(`next-env.d.ts`) never ships, so it needs no row and keeps no exemption alive.
Not read either: specs, tests, fixtures, `/app/dev/` preview pages, migrations, `public/`
assets, build output and dependencies. Not flows: reserved names (`example.com`,
`.invalid`, `.test`, `.internal`, `.svc`), Kubernetes API groups (`*.k8s.io`), the
product's own domain (`packages/brand/identity.json`), and private, loopback,
documentation and other special-use addresses (CGNAT, benchmarking, multicast,
reserved: the exceptions a NetworkPolicy lists). An entry in `not-flows.yaml` that no longer occurs, or a
named package that is no longer a dependency, fails too, so an exemption cannot
outlive its reason. A host that only arrives at runtime (a BYOK base URL, a
browser's push endpoint) is caught through its variable, or listed on the row by
hand. PostHog's live destinations are read through the README's tables: a
destination created in PostHog without a row there is not seen.

## The boot check

A row with `status: latent` is a vendor the code can reach and nobody uses:
Modal's sandbox, Serper, Jina, Weights & Biases, LangSmith, Anthropic and Gemini
direct. Its `activation_env` names the variables that would switch it on, and
`activation_files` the files (`~/.modal.toml`).
`agent.common.data_flow_register.assert_no_latent_vendor` runs when each Python
process starts (both web roles, the job worker, the ingest worker) and refuses to
start a deployment people sign in to (`REQUIRE_AUTH=true`) while one of them is
set to anything but empty, `0`, `false`, `no` or `off`, or one of its files exists. To use such a vendor,
set its row to `active` with the copy the page needs, which lists it publicly,
and the boot passes. A latent row whose switch no process can see (Datadog's
browser SDK, injected by an overlay) says why in `no_boot_check`.

## A row

One file per recipient, named by its `id`. The four list files (`in-cluster.yaml`,
`public-sources.yaml`, `build.yaml`, `not-flows.yaml`) hold the rest.

A public source in `public-sources.yaml` is `active` (the default: an office's
work fetches from it, and the page lists it) or `unused` with an `unused_reason`
(configured under `configs/sources/`, entitled to no office: Fedlex). The annex
lists both; the page only the active ones. Every host a record under
`configs/sources/` names is held to this file by the scan, so a new source
cannot ship unlisted.

| Field | Values |
|---|---|
| `kind` | `processor` |
| `status` | `active` (in use), `conditional` (only when an office or the operator configures it), `latent` (refused at boot) |
| `name`, `entity_country`, `processing_countries` | the legal entity, its seat, where the data is processed (ISO 3166, or `various`/`global`) |
| `transfer` | `eea` (no third-country transfer), `eu_storage_us_access` (stored in the EU by a US group), `third_country`. The page renders the safeguard from it |
| `contract` | `dpa`, `terms`, `none`, `unknown`. Only `dpa` counts as signed; the annex lists every other listed row under "Contracts still to confirm", and shows its transfer basis as "basis to confirm" until a `dpa` or `terms` contract carries it |
| `data_classes` | `tenant_content`, `model_io`, `voice_audio`, `account_identity`, `audit_metadata`, `telemetry`, `operational_log`, `support_text`, `trace_metadata`, `search_query`, `address_query`, `mail_transit`, `notification`, `ids_only`, `backups` |
| `purposes` | `service_provision`, `quality_evaluation`, `product_improvement`, `customer_support`, `security`, `operations` (mapped to DPV in the annex) |
| `holds_tenant_text`, `deletion` | whether an office's text rests there, and `deletion.status` (`covered`, `partial`, `gap`, `unknown`, `not_retained`, `no_tenant_text`, `vendor_retention`, `controller_designated`, `not_used`) with German and English text |
| `hosts`, `env`, `activation_env`, `hog_files`, `posthog_destinations`, `sdks`, `model_vendors` | what the scan matches against; `no_signal` with a reason where there is nothing |
| `activation_files`, `activation_config` | latent rows only: files whose existence (boot) and config patterns (scan) switch the vendor on |
| `flows` | optional, one per purpose a recipient serves: `id`, `what` (de/en), `data_classes` and `purposes` from the row's, and `processing_location` (ISO 3166 codes, or `per_model`). Residency enforcement reads it; the annex lists it |
| `copy` | `name`, `purpose`, `data`, `location`, `required`, each `de` and `en`: the page's cells. `{productName}` is filled in. `transfer` overrides the safeguard cell, and a listed third-country row without a contract must have it: SCCs are a contract |
| `evidence` | files that show the flow; each must exist |

Legal copy is customer-facing: a change to `copy`, `transfer` or a new `active`
row changes the public page, so it goes in the PR's list of sentences for a
person's review, with a release note.

## Adding a flow

1. Add or extend the row; run `.venv/bin/python scripts/check_data_flow_register.py`
   until it is clean.
2. Run `.venv/bin/python scripts/generate_subprocessor_pages.py` and commit the
   two generated files.
3. If the privacy policy's own paragraphs (section 4, recipients) no longer
   describe the flow, change them in `de.ts` and `en.ts` too; the spec
   `apps/workspace/bff/legal/content/content.spec.ts` holds the facts that must
   stay on the page.

## Known gaps

- No run deletes an organization as a whole. The annex's last section lists each
  store that keeps an office's text after its contract ends (design §6.6).
- Error tracking (the PostHog SDKs) and the BFF's request spans are not redacted
  like the logs are: an exception message that names a document reaches PostHog
  and, as an issue title, the error-tracking alert in Slack (`slack.yaml`).
- `contract` is `unknown` for every processor we have a contract with: the
  register does not yet record which DPAs are signed.
