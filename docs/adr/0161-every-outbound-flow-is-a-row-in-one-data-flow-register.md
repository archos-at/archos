---
status: proposed
date: 2026-11-10
decision-makers: engineering
consulted: the international foundation design review (docs/design/international, S5)
informed: whoever adds a vendor, a host, a key or a dependency; whoever answers a customer's question about processors
---

# Every outbound flow is a row in one data-flow register, and the legal page and DPA annex are generated from it

## Context and Problem Statement

We promise offices "hosting in Vienna, zero retention, a DPA". Until now the
list of who receives their data was hand-written three times: the public page
`/legal/subprocessors` (`apps/workspace/bff/legal/content/{de,en}.ts`), the July
2026 audit (`docs/compliance/external-dependencies.md`) and the design's own
tables. They had already drifted. komoot's public Photon had received every typed
address since 2026-11-03 and was on none of them. Dictation audio went to
ElevenLabs. Two PostHog destinations quoted members' feedback into Slack. And
the page still named NVIDIA, Moonshot and three search providers that no code
reaches.

A flow nobody listed is a broken promise and a gap under GDPR Art. 28. Every new
country, and every Swiss or public-sector buyer, asks for this list first.

The question: where is the one list, how is the page made from it, and what
stops the next unlisted flow.

## Decision Drivers

- **One source.** The page, the DPA annex and residency enforcement (S14) read
  the same rows.
- **The second occurrence is caught by a machine.** A new host, key, SDK or
  PostHog destination fails CI, not a reviewer's memory.
- **Honest by default.** Contract status, transfer safeguard and deletion at
  contract end are recorded as known, `unknown` or `none`, never assumed.
- **Standard vocabulary** where one exists.

## Considered Options

1. YAML rows in `configs/subprocessors/`, one per recipient; generated page parts
   and annex; a scan of code, manifests and PostHog automation; a boot check for
   latent vendors.
2. A database table edited in the platform UI.
3. Keep the hand-written page and add a checklist to the PR template.

## Decision Outcome

Option 1.

- **Rows.** `configs/subprocessors/<id>.yaml` holds one recipient each:
  - processor and seat, `processing_countries`, the `transfer` safeguard, the `contract` status;
  - `data_classes` and `purposes`;
  - `deletion` at contract end;
  - what the scan matches: `hosts`, `env`, `sdks`, `hog_files`, `posthog_destinations`;
  - the page's cells in German and English;
  - optionally `flows`, each with its own `processing_location`.

  Four list files hold the rest:
  - `in-cluster.yaml`: self-hosted stores and their addresses;
  - `public-sources.yaml`;
  - `build.yaml`;
  - `not-flows.yaml`: hosts, variables and packages that carry nothing out, each with its reason.
- **Generated.** `scripts/generate_subprocessor_pages.py` writes:
  - the page's tables and lists (`subprocessors.generated.ts`), which `de.ts` and `en.ts` place between their own paragraphs;
  - the DPA annex (`docs/compliance/dpa-subprocessor-annex.md`), with purposes and transfer bases as W3C DPV terms.
- **The ratchet.** `scripts/check_data_flow_register.py` reads the whole of `apps/`, `packages/`, `deploy/` and `configs/`. It fails every unclaimed item of these kinds:
  - a variable ending `_URL`, `_HOST`, `_ENDPOINT`, `_KEY`, `_TOKEN`, `_SECRET` or `_DSN`;
  - a host: a URL of any scheme, one built in a template, a quoted bare hostname, or a public IP;
  - a default model id's vendor;
  - a `.hog` file;
  - a PostHog destination id, whole or cut short;
  - a direct runtime dependency (an SDK reaches its vendor's default host with no URL in our code).

  It also fails a row the scan could not find and an exemption that no longer occurs. It runs as the `data-flow-register` pre-commit hook and in `tests/test_data_flow_register.py`, with a positive control for each kind.
- **Boot check.** A row with `status: latent` names its `activation_env`.
  `agent.common.data_flow_register.assert_no_latent_vendor` stops every Python process of a deployment with `REQUIRE_AUTH=true` while one of those is set. Using such a vendor means making its row `active`, which lists it on the page.

### Consequences

- Good: adding a vendor is one reviewed YAML file. The legal diff, its release note and the person's review come with it.
- Good: the annex states, per store, where deletion at contract end does not reach yet (today: no organization-level purge).
- Good: S14 (residency) reads `processing_location` per flow instead of inventing a second list.
- Bad: every new dependency needs a line in `not-flows.yaml`, a small tax on each `bun add` and `uv add`.
- Bad: legal copy now lives partly in YAML; reviewers of `configs/subprocessors/` must read it as customer-facing text.

### Confirmation

- `tests/test_data_flow_register.py`:
  - the register validates;
  - the scan is clean;
  - the generated files equal the generator's output;
  - positive controls plant each kind of flow (a `_DSN`, `_TOKEN` and `_SECRET` variable, a `wss://`, templated, bare and IP host, a file in the CMS, the website, `ifc-spatial-py` and Helm, a model vendor, an SDK dependency, a PostHog destination, a latent vendor in a config), and each fails;
  - a row the scan cannot find fails.
- `packages/agent/tests/common/test_data_flow_register.py`: a latent vendor, by a variable or a token file, stops the boot.
- `deploy/pulumi/src/platform/posthog-log-redaction.spec.ts`: the real collector withholds a planted document name and licensed passage from PostHog Logs.
- `apps/workspace/bff/legal/content/content.spec.ts`: the page shows the register's rows, in order.

## Pros and Cons of the Options

### 1. YAML register, generated page, scan and boot check

- Good: reviewable in a PR, diffable, readable by the agent and by S14.
- Good: the scan reads code and manifests, so it does not depend on anyone remembering.
- Bad: the YAML repeats some prose the page used to hold inline.

### 2. A database table in the platform UI

- Good: legal could edit it without a deploy.
- Bad: CI cannot fail a pull request against a production table, and the ratchet is the point.

### 3. Hand-written page plus a checklist

- Bad: this is what drifted.

## More Information

- [`docs/compliance/data-flow-register.md`](../compliance/data-flow-register.md): the schema and how to add a flow.
- Design: `docs/design/international/design.md` §6.1–6.6 on `claude/intl-design`. The design's ADR table folds the register into its residency record (there numbered 0161). This record is the register; residency enforcement amends it.
- Related: ADR-0074 (zero data retention), ADR-0100 (PostHog), ADR-0151 (komoot's Photon), ADR-0157 (ClamAV).
