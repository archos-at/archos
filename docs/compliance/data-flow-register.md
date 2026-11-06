# The data-flow register

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
and `tests/test_data_flow_register.py` in the backend suite) scans the runtime
code, Pulumi, Compose, `deploy/.env.example`, the env reference and
`deploy/posthog/` for what opens a flow, and fails each one no file names:

| Found in the code | Must be named by |
|---|---|
| A variable ending `_URL`, `_BASE_URL`, `_HOST`, `_ENDPOINT`, `_API_KEY` or `_TOKEN_ID` | a row's `env` or `activation_env`, `in-cluster.yaml`'s `env`, or `not-flows.yaml` |
| A literal `http(s)://host` | a row's `hosts` (a subdomain counts), `public-sources.yaml`, `build.yaml`, `in-cluster.yaml`'s `hosts`, or `not-flows.yaml` |
| A `.hog` file under `deploy/posthog/` | a row's `hog_files` |
| A destination id in a table of `deploy/posthog/README.md` | a row's `posthog_destinations` |

A retired variable name counts as the name it is read as now (`current_name` in
`apps/agent-host/entrypoint.py`), so the register lists only current names.
Not scanned: specs, fixtures and `/app/dev/` preview pages; reserved names
(`example.com`, `.invalid`, `.test`, `.internal`, `.svc`). An entry in
`not-flows.yaml` that no longer occurs fails too, so an exemption cannot outlive
its reason. A host that only arrives at runtime (a BYOK base URL, a browser's push
endpoint) is caught through its variable, or listed on the row by hand.

## The boot check

A row with `status: latent` is a vendor the code can reach and nobody uses:
Modal's sandbox, Serper, Jina, Weights & Biases, LangSmith, Anthropic and Gemini
direct. Its `activation_env` names the variables that would switch it on.
`agent.common.data_flow_register.assert_no_latent_vendor` runs when each Python
process starts (both web roles, the job worker, the ingest worker) and refuses to
start a deployment people sign in to (`REQUIRE_AUTH=true`) while one of them is
set to anything but empty, `0`, `false`, `no` or `off`. To use such a vendor,
set its row to `active` with the copy the page needs, which lists it publicly,
and the boot passes. A latent row whose switch no process can see (Datadog's
browser SDK, injected by an overlay) says why in `no_boot_check`.

## A row

One file per recipient, named by its `id`. The four list files (`in-cluster.yaml`,
`public-sources.yaml`, `build.yaml`, `not-flows.yaml`) hold the rest.

| Field | Values |
|---|---|
| `kind` | `processor` |
| `status` | `active` (in use), `conditional` (only when an office or the operator configures it), `latent` (refused at boot) |
| `name`, `entity_country`, `processing_countries` | the legal entity, its seat, where the data is processed (ISO 3166, or `various`/`global`) |
| `transfer` | `eea` (no third-country transfer), `eu_storage_us_access` (stored in the EU by a US group), `third_country`. The page renders the safeguard from it |
| `contract` | `dpa`, `terms`, `none`, `unknown`. Only `dpa` counts as signed; the annex lists every other listed row under "Contracts still to confirm" |
| `data_classes` | `tenant_content`, `model_io`, `voice_audio`, `account_identity`, `audit_metadata`, `telemetry`, `operational_log`, `support_text`, `trace_metadata`, `search_query`, `address_query`, `mail_transit`, `notification`, `ids_only`, `backups` |
| `purposes` | `service_provision`, `quality_evaluation`, `product_improvement`, `customer_support`, `security`, `operations` (mapped to DPV in the annex) |
| `holds_tenant_text`, `deletion` | whether an office's text rests there, and `deletion.status` (`covered`, `partial`, `gap`, `unknown`, `not_retained`, `no_tenant_text`, `vendor_retention`, `controller_designated`, `not_used`) with German and English text |
| `hosts`, `env`, `activation_env`, `hog_files`, `posthog_destinations` | what the scan matches against |
| `copy` | `name`, `purpose`, `data`, `location`, `required`, each `de` and `en`: the page's cells. `{productName}` is filled in |
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
- The OTel collector's `logs/posthog` pipeline exports WARN-and-above logs with no
  redaction processor, so a log line that names a document reaches PostHog.
- `contract` is `unknown` for every processor we have a contract with: the
  register does not yet record which DPAs are signed.
