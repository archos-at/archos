# Vendor list audit for the AVV (November 2026)

- **Date:** 2026-11-11, against `develop` at `7d8c8984`.
- **Question:** is the list of vendors we hand out with the data processing
  agreement (AVV, Art. 28 GDPR) complete and correct?
- **The list itself** is not this file. It is
  [`dpa-subprocessor-annex.md`](dpa-subprocessor-annex.md), generated from the
  [data-flow register](data-flow-register.md) in `configs/subprocessors/`. This
  file records what the audit checked, what it corrected, and what is still open.
- **Status: counsel sign-off OPEN.** Engineering inventory, not legal advice.

## Answer

The register names every vendor the code and the deployment reach. The audit
found no undeclared recipient of an office's content. It did find one recipient
class with no row, wrong or stale facts on existing rows, and three things no
repository can answer: which contracts are signed, which vendors the company
uses outside the product, and whether the website's promises match the list.
The last two sections say what a person has to do before the annex is signed.

## How it was checked

Eighteen read-only passes, each over one slice, each reported with file and
line: every active row against the code that calls the vendor; the two exemption
lists (`not-flows.yaml`, `build.yaml`); the browser side of the app; the BFF's
and the agent's outbound calls and dependencies; the website; the CMS;
`deploy/`; `.github/workflows/`; every ADR; the hand-written legal texts; the
two older audits. Six more passes read each vendor's own terms, DPA page and
imprint on the web. Every finding below was read again in the code before it
changed a row; findings that could not be confirmed are listed as open, not as
facts.

## Corrected in this change

| Row | Was | Now | Evidence |
|---|---|---|---|
| IPAX | `IPAX OG` | `IPAX GmbH`, Klosterneuburg, FN 610354f; Backupspace named as IPAX's own backup product | ipax.at imprint; `docs/deployment/kubernetes.md` (Velero) |
| Tavily | `Tavily`, retention "not established" | `AlphaAI Technologies Inc. (Tavily)`; the deletion text says what its policy allows | tavily.com terms (4 May 2026) and privacy policy |
| WorkOS | identity, authorization, audit log | also: sends invitation and verification mail, keeps an office's own AI keys in WorkOS Vault, receives the browser's user agent in audit events; "MFA" dropped (it is off) | `bff/llm-credentials/secret-store.ts`, `bff/audit/service.ts`, `docs/deployment/workos-provisioning.md` |
| PostHog | session replay "sampled" | recorded for every session unless the operator lowers the rate (the default is 1, prod sets none) | `bff/analytics/posthog-config.ts`, `deploy/pulumi/src/config/posthog.ts` |
| komoot Photon | `active` | `conditional`: off in every shipped stack since ADR-0159 | `deploy/pulumi/src/config.ts`; both `Pulumi.*.yaml` |
| Cloudflare | data class `mail_transit` only | plus `telemetry` for the `www` redirect, which the row's text already described | `deploy/pulumi/src/platform/dns.ts` |
| An office's own AI endpoint | no row | new conditional row `byok-endpoint`: an office can store a key with its own base URL (`azure-openai`, `custom`), and its prompts then go there | `bff/llm-credentials/providers.ts` |
| Dragonfly (in cluster) | "holds no tenant text" | holds the frames of running chats and the member directory, in memory | `deploy/pulumi/src/data/dragonfly.ts` |
| Build services | SonarSource listed | removed (no workflow uses it); Pulumi Cloud and Anthropic (Claude Code on pull requests) added | `.github/workflows/`, `docs/deployment/cd.md` |
| Privacy policy, section 4 | address search described as always on | "where address search is switched on" | `bff/legal/content/de.ts`, `en.ts` |

The annex also gained two sections: **Contracting entities and agreements**
(from the new `agreement` field of a row: who the contract is with, how the DPA
is concluded, where the vendor lists its own subprocessors, and the day it was
read) and **Build, deployment and engineering services**.

## Checked and found correct

- **Cloudflare is not in front of the app.** Every app, upload, website and CMS
  host is DNS-only; only `www` (a redirect) and project mail pass through it. No
  R2, D1, KV, Pages, Turnstile or Tunnel anywhere.
- **No second hoster.** Cluster, storage, load balancer and the nightly Velero
  copies are IPAX; database and vector snapshots stay in the cluster.
- **No vendor in the browser** beyond PostHog (proxied through our own origin)
  and WorkOS avatars: fonts, pdf.js, Excalidraw and the IFC viewer are served
  locally; no map tiles; no favicon or preview is loaded from a cited website.
- **No mail, billing, CRM, calendar, cloud-drive or BIM-platform vendor** in the
  product. The product sends no mail itself; WorkOS does.
- **Web search is Tavily only**, and the agent reads Tavily's snippets: no
  page-reader service, no second search provider.
- **The website** loads PostHog (consent-gated) and nothing else; its forms are
  `mailto:` links, so no server of ours receives them.
- **The CMS** runs in the cluster with its own Postgres; no mail adapter, no
  model calls, telemetry off. Buffer is the only outside party and is not
  deployed yet.
- **Telemetry of the frameworks** (Next.js, Astro, Payload) is switched off in
  the images; tiktoken's encoding is baked into the image.
- **No vendor an accepted ADR adopted is missing** from the register.

## Open: only a person can close these

### 1. No contract is on record for any vendor

Every row is `contract: unknown` or `none`, so the annex prints "to confirm" and
"basis to confirm" fourteen times. What each vendor offers is now in the annex;
what was signed is not in the repository. Per vendor:

| Vendor | To do |
|---|---|
| IPAX | Conclude the AVV in the IPAX Control Panel (menu "Verträge") and ask for the current list of its subcontractors (data centres: Interxion, NESSUS). Then set `contract: dpa`. |
| OpenRouter | Its DPA with SCCs applies with the terms. Confirm the account runs under those terms, then set `contract: terms`. The EU endpoint needs the Business or Enterprise plan. |
| WorkOS | Its DPA with SCCs is part of the agreement. Confirm and set `contract: terms`. Data is stored in the United States; no EU option was found. |
| PostHog | Get the DPA for PostHog Cloud EU and record the contracting entity. Confirm the project's retention settings match the row (12 months, 30 days). |
| Slack | Take the contracting entity from the workspace's billing page (for Europe Slack names Slack Technologies Limited, Dublin) and correct the row's `name`. |
| Cloudflare | Its DPA takes effect when agreed; confirm it is part of the plan's terms. |
| **Tavily** | **No DPA is published, and its terms allow keeping queries and using them for training.** Ask for a DPA with SCCs and a no-retention, no-training term, or replace the provider. Until then "no training" is not true for search queries. |
| komoot Photon | Leave off. A deployment that wants address search should run its own Photon. |

### 2. Vendors the repository cannot see

The register is built from code, so a tool the company uses by hand is not in
it. If any of these holds personal data of an office or its staff, it belongs in
the annex or in the record of processing (Art. 30):

- the mailbox provider behind the contact address (contact and demo requests
  arrive there, and so do the `postmaster@` and `abuse@` forwards);
- wherever support conversations, customer lists, contracts and invoices live
  (CRM, accounting, document storage, the company's Slack beyond the alerts);
- GoDaddy: the DMARC record still sends aggregate reports to
  `dmarc_rua@onsecureserver.net`, carried over from the old registrar.

### 3. The website promises more than the list supports

`apps/website/src/i18n/pages/security.ts` (German, mirrored in English):

| Claim | Against |
|---|---|
| "Ihre vollständigen Unterlagen verlassen dabei nie das Rechenzentrum in Wien." | Every page of a document is sent through OpenRouter when it is read in (text recognition, search index): `openrouter.yaml`, flows `vision` and `embeddings`. |
| "Für alle KI-Anfragen gilt Zero Data Retention." | True on the platform's key. An office can switch it off or bring its own key, and Tavily has no such term. |
| "Nach Vertragsende löschen wir Ihre Daten." | No run deletes an organization as a whole (annex, last section). |
| "Mit jedem Büro schließen wir einen Auftragsverarbeitungsvertrag ab." | No AVV text exists in the repository; the annex is its only part. |

The public processor page states standard contractual clauses for every
third-country vendor as fact (`TRANSFER_TEXT` in
`scripts/generate_subprocessor_pages.py`), while the annex says "basis to
confirm". Both become true once section 1 is done; until then counsel decides
which wording stands.

Nothing here says how an office is told about a new subprocessor or how long it
may object. The page says administrators "are informed"; the AVV needs the
period.

## Open: engineering

- `apps/agent-host` falls back to `api.openai.com` for summaries, consistency
  checks, skill review and dictation when no OpenRouter key is set but an OpenAI
  key is; that path carries no retention pin. Prod sets the OpenRouter key.
  `openai-direct.yaml` describes it as an operator configuration.
- The `embeddings`, `vision` and `reranking` flows say `processing_location:
  [US]`, while `common/openrouter.py` prefers or requires upstreams in the EU.
  Not re-checked line by line; the static label may be too pessimistic.
- `model-providers.yaml` names DeepSeek, Meta and Mistral as examples; the
  defaults in code are OpenAI, Qwen (re-ranking), ElevenLabs and Typesafe.
- PostHog's weekly report writes its summary with a model inside PostHog
  (`deploy/posthog/README.md`); which provider runs it is PostHog's
  subprocessor, to be read off its list.
- An outside agent a person connects to the MCP door (Claude, Cursor) receives
  what that person can read. It is the person's own tool, not our subprocessor;
  the AVV should say so in a sentence.
- `Pulumi.dev.yaml` still carries keys of the retired error-to-issue flow
  (a GitHub token, an Anthropic key). Not read by any code; revoke and delete.
- `docs/deployment/coolify.md` still documents a Coolify deployment. If one
  runs with real accounts, its server is a second hoster and needs a row.
