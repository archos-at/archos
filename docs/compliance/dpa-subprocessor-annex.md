<!-- AUTO-GENERATED from configs/subprocessors/*.yaml by scripts/generate_subprocessor_pages.py. Do not edit; change the register. -->

# DPA annex: subprocessors and recipients

The processor list of the data processing agreement (AVV, Art. 28 GDPR), generated from the data-flow register ([how it works](data-flow-register.md)). The public page `/legal/subprocessors` is generated from the same rows. **Engineering inventory, not legal advice: counsel reviews it before it is signed.**

Statuses: `active` is in use; `conditional` only when an organization or the operator configures it; `latent` is reachable in code but refused at boot in a deployment people sign in to.

## Recipients

| Recipient | Status | Entity | Processed in | Data classes | Purposes (DPV) | Transfer (DPV) | Contract | Deletion at contract end |
|---|---|---|---|---|---|---|---|---|
| IPAX GmbH | active | AT | AT | tenant_content, model_io, account_identity, telemetry, backups | dpv:ServiceProvision | — | to confirm | **gap**: The servers and the nightly Velero copy of every volume are at IPAX. A project deletion reaches the database, the object store and the vector index; the copies age out after 30 days. No deletion run for a whole organization at contract end exists yet. |
| OpenRouter, Inc. | active | US | US | model_io, tenant_content | dpv:ImproveExistingProductsAndServices, dpv:ServiceProvision | **basis to confirm** (no contract on record) | to confirm | **partial**: On the platform's key every request runs with zero data retention: neither OpenRouter nor the model provider keeps content, so nothing is left to delete. Where an organization switches zero data retention off or brings its own key, the provider's retention applies, and deletion at contract end does not reach those copies. |
| Upstream AI model providers (via OpenRouter) | active | various | various | model_io, tenant_content | dpv:ServiceProvision | **basis to confirm** (no contract on record) | to confirm | **partial**: As for OpenRouter; the provider is reached only through OpenRouter. |
| ElevenLabs, Inc. (via OpenRouter) | active | US | US | voice_audio | dpv:ServiceProvision | **basis to confirm** (no contract on record) | to confirm | **not_retained**: Every transcription runs on the platform's key with zero data retention; the audio is not stored. |
| WorkOS, Inc. | active | US | US | account_identity, audit_metadata | dpv:EnforceSecurity, dpv:ServiceProvision | **basis to confirm** (no contract on record) | to confirm | **gap**: WorkOS holds accounts, memberships, the audit trail and, in WorkOS Vault, an organization's own AI keys. Audit events carry project, organization and document names. At contract end neither the organization, its users, its audit trail nor its keys are deleted automatically. |
| PostHog, Inc. | active | US | DE | telemetry, operational_log, support_text, trace_metadata | dpv:CustomerCare, dpv:ImproveExistingProductsAndServices, dpv:ServiceOptimisation | **basis to confirm** (no contract on record) | to confirm | **gap**: Events are kept up to 12 months, session recordings up to 30 days. Support tickets carry a report's text (masked by the organization's content screening) and stay until we delete them. At contract end an organization's persons, events and tickets are not deleted automatically. |
| Slack Technologies, LLC | active | US | US | ids_only, operational_log | dpv:CustomerCare, dpv:ServiceOptimisation | **basis to confirm** (no contract on record) | to confirm | **gap**: Notices about reports carry the ticket number, kind, deployment, the organization's name and links, no text of a report or a chat. Error alerts carry the issue's title, which is the exception message and can name a document or a project. Everything stays under the Slack workspace's retention; deletion at contract end does not reach it. |
| AlphaAI Technologies Inc. (Tavily) | active | US | US | search_query | dpv:ServiceProvision | **basis to confirm** (no contract on record) | to confirm | **unknown**: Tavily's privacy policy names no period: search queries stay as long as needed to provide and improve the service, and may be used to improve answers to future queries unless a contract says otherwise. No zero-retention agreement exists; deletion at contract end does not reach the queries. |
| Cloudflare, Inc. | active | US | global | mail_transit, telemetry | dpv:ServiceProvision | **basis to confirm** (no contract on record) | to confirm | **vendor_retention**: Mail to a project address passes through Cloudflare and is not stored there; Email Routing's activity log keeps sender, recipient, time and outcome under Cloudflare's own retention. |
| komoot GmbH | conditional | DE | DE | address_query | dpv:ServiceProvision | — | **no contract** | **unknown**: The public Photon service is used without an account or a contract; whether komoot logs queries, and for how long, is not established. Deletion at contract end does not reach them. |
| Browser push services (Google FCM, Mozilla, Apple, Microsoft) | active | US | global | notification | dpv:ServiceProvision | **basis to confirm** (no contract on record) | **no contract** | **not_retained**: The notification is end-to-end encrypted (RFC 8291); the push service cannot read it and holds it only until delivery. |
| OpenAI, L.L.C. (direct) | conditional | US | US | model_io, voice_audio | dpv:ServiceProvision | **basis to confirm** (no contract on record) | to confirm | **controller_designated**: Reached only when an organization stores its own OpenAI key or the operator sets a base URL to api.openai.com; then OpenAI's retention applies under the key holder's contract. |
| An organization's own AI endpoint (Azure OpenAI or a custom gateway) | conditional | various | various | model_io, tenant_content | dpv:ServiceProvision | **basis to confirm** (no contract on record) | **no contract** | **controller_designated**: Reached only when an organization stores its own key with its own base URL in the model settings (Azure OpenAI or a gateway of its own). The organization then names the recipient; its retention applies under the organization's contract. |
| Modal Labs, Inc. | latent | US | US | model_io | dpv:ServiceProvision | **basis to confirm** (no contract on record) | **no contract** | **not_used**: Not in use; a deployment people sign in to does not start while the service is configured. |
| Serper.dev | latent | US | US | search_query | dpv:ServiceProvision | **basis to confirm** (no contract on record) | **no contract** | **not_used**: Not in use; a deployment people sign in to does not start while the service is configured. |
| Jina AI GmbH | latent | DE | DE | model_io | dpv:ServiceProvision | — | **no contract** | **not_used**: Not in use; a deployment people sign in to does not start while the service is configured. |
| Weights & Biases, Inc. | latent | US | US | telemetry | dpv:ServiceOptimisation | **basis to confirm** (no contract on record) | **no contract** | **not_used**: Not in use; a deployment people sign in to does not start while the service is configured. |
| LangChain, Inc. (LangSmith) | latent | US | US | model_io | dpv:ServiceOptimisation | **basis to confirm** (no contract on record) | **no contract** | **not_used**: Not in use; a deployment people sign in to does not start while the service is configured. |
| Datadog, Inc. | latent | US | US | telemetry | dpv:ServiceOptimisation | **basis to confirm** (no contract on record) | **no contract** | **not_used**: Not in use; this repository does not load the Datadog SDK. |
| Anthropic, PBC (direct) | latent | US | US | model_io | dpv:ServiceProvision | **basis to confirm** (no contract on record) | **no contract** | **not_used**: Not in use; a deployment people sign in to does not start while the key is set. |
| Google LLC (Gemini API, direct) | latent | US | US | model_io | dpv:ServiceProvision | **basis to confirm** (no contract on record) | **no contract** | **not_used**: Not in use; a deployment people sign in to does not start while the key is set. |

## Flows per recipient

Where one recipient serves several purposes, each flow with the place it is processed (`per_model`: the upstream follows the model an office chose).

| Recipient | Flow | Data classes | Purposes (DPV) | Processed in |
|---|---|---|---|---|
| OpenRouter, Inc. | Chat, research, project intake and permit extraction | model_io, tenant_content | dpv:ServiceProvision | per_model |
| OpenRouter, Inc. | Search index (embeddings) of every document and question | tenant_content | dpv:ServiceProvision | US |
| OpenRouter, Inc. | Text recognition of every page when a document is read in | tenant_content | dpv:ServiceProvision | US |
| OpenRouter, Inc. | Re-ranking of search hits | model_io | dpv:ServiceProvision | US |
| OpenRouter, Inc. | Quality evaluation of a sample of answers | model_io | dpv:ImproveExistingProductsAndServices | per_model |
| PostHog, Inc. | Events, masked session recordings, errors, surveys | telemetry | dpv:ImproveExistingProductsAndServices | DE |
| PostHog, Inc. | Warning-level logs without their text, spans and metrics through the OTel collector | operational_log | dpv:ServiceOptimisation | DE |
| PostHog, Inc. | Support tickets with a report's masked text | support_text | dpv:CustomerCare | DE |
| PostHog, Inc. | AI metadata and answer ratings from Langfuse | trace_metadata | dpv:ImproveExistingProductsAndServices | DE |

## Contracting entities and agreements

What each vendor publishes about itself, read on the day in the last column: the entity a contract is with, how its DPA is concluded and where its own subprocessors are listed. It says what a vendor offers, not what we signed: that is the `contract` column above, and stays `to confirm` until a person records it.

| Recipient | Contracting entity | DPA: how it is concluded | DPA text | Its subprocessors | Note | Checked |
|---|---|---|---|---|---|---|
| IPAX GmbH | IPAX GmbH, Donaustraße 106, 3400 Klosterneuburg, Austria (FN 610354f, Landesgericht Korneuburg) | Concluded by the customer in the IPAX Control Panel (cp.ipax.at, menu "Verträge"); not automatic with the order | <https://www.ipax.at/docs/vertrag-verrechnung/datenschutz-dsgvo/> | Data centres in Vienna run by Interxion (Digital Realty) and NESSUS (IP.ONE/NDC2) per ipax.at; no current list published, ask IPAX for the annex | — | 2026-11-11 |
| OpenRouter, Inc. | OpenRouter, Inc., 169 Madison Avenue, New York, NY 10016, USA | Part of the terms of service; effective when the customer accepts the terms. Standard contractual clauses (module 2) included. A countersigned copy on request | <https://openrouter.ai/data-processing-agreement> | https://trust.openrouter.ai/ (subscription by e-mail; 30 days' notice of a new subprocessor) | The EU endpoint (eu.openrouter.ai) is offered on the Business and Enterprise plans only. No statement on the EU-US Data Privacy Framework found. | 2026-11-11 |
| ElevenLabs, Inc. (via OpenRouter) | Reached through OpenRouter, so no contract of our own. ElevenLabs' EU terms name Eleven Labs Inc., 169 Madison Avenue, New York, USA | None with us; reached only as an upstream of OpenRouter, under OpenRouter's agreement | <https://elevenlabs.io/dpa> | <https://compliance.elevenlabs.io/subprocessors> | — | 2026-11-11 |
| WorkOS, Inc. | WorkOS, Inc., USA (address per order form) | Part of the agreement; binding from its effective date. Standard contractual clauses (modules 2 and 3) included | <https://workos.com/legal/dpa> | <https://trust.workos.com/subprocessors> | Data is stored in the United States; no EU residency option found. | 2026-11-11 |
| PostHog, Inc. | PostHog, Inc., USA (PostHog Cloud EU; entity and address per order form) | Offered at posthog.com/dpa; whether it applies with the terms or must be requested was not established | <https://posthog.com/dpa> | <https://posthog.com/subprocessors> | PostHog Cloud EU runs in AWS eu-central-1 (Frankfurt). Retention (events 12 months, recordings 30 days) is a project setting, not in this repository. | 2026-11-11 |
| Slack Technologies, LLC | To confirm from the workspace's billing details. For workspaces outside the US and Canada Slack's privacy policy names Slack Technologies Limited, Dublin, Ireland, not Slack Technologies, LLC | Slack states its DPA is available to every customer, on free and paid plans; standard contractual clauses through it | <https://slack.com/blog/news/a-note-to-our-customers-on-international-data-transfers> | <https://slack.com/slack-subprocessors> | — | 2026-11-11 |
| AlphaAI Technologies Inc. (Tavily) | AlphaAI Technologies Inc. d/b/a Tavily, New York, USA (the privacy policy and the terms give two different addresses). Nebius announced its acquisition in February 2026 | None published (tavily.com/dpa does not exist, the trust centre is empty). Ask Tavily for a DPA with standard contractual clauses and a no-retention, no-training term | — | None published | Terms of 4 May 2026, section 6.5, let Tavily and its AI providers retain customer input and use it to train models. That contradicts our "no training" statements until a contract excludes it. | 2026-11-11 |
| Cloudflare, Inc. | Cloudflare, Inc., 101 Townsend Street, San Francisco, CA 94107, USA | Customer DPA with standard contractual clauses (modules 2 and 3); takes effect when the customer signs or the parties otherwise agree to it, so confirm it is part of our plan's terms | <https://www.cloudflare.com/cloudflare-customer-dpa/> | <https://www.cloudflare.com/gdpr/subprocessors/> | — | 2026-11-11 |
| komoot GmbH | komoot GmbH, Kienberger Allee 4, 12529 Schönefeld, Germany (HRB 19363 CB, Amtsgericht Cottbus) | None offered for the public Photon service, which komoot runs without a contract or an availability promise | — | None published for Photon | Off in every shipped stack (geocoderUrl is empty by default and neither Pulumi stack sets it). Before a deployment opts in, weigh a self-hosted Photon instead; the server location of the public service is not published. | 2026-11-11 |
| OpenAI, L.L.C. (direct) | The key holder's own contract. For customers in the EEA OpenAI names OpenAI Ireland Limited | Between the key holder and OpenAI | <https://openai.com/policies/data-processing-addendum/> | <https://openai.com/policies/sub-processor-list/> | — | 2026-11-11 |
| An organization's own AI endpoint (Azure OpenAI or a custom gateway) | Named by the organization (its Azure tenant or its own gateway); we have no contract with it | Between the organization and its provider. The organization acts as controller for this recipient; the AVV should say so | — | — | — | 2026-11-11 |

## Contracts still to confirm

Listed recipients whose contract the register does not record as a signed DPA: IPAX GmbH, OpenRouter, Inc., Upstream AI model providers (via OpenRouter), ElevenLabs, Inc. (via OpenRouter), WorkOS, Inc., PostHog, Inc., Slack Technologies, LLC, AlphaAI Technologies Inc. (Tavily), Cloudflare, Inc., komoot GmbH, Browser push services (Google FCM, Mozilla, Apple, Microsoft), OpenAI, L.L.C. (direct), An organization's own AI endpoint (Azure OpenAI or a custom gateway).

## Deletion at contract end: where it does not reach yet

No run deletes an organization as a whole today; deletion is per project, conversation and folder. Every store below holds an office's text after its contract ends: until the bound it names, or without one.

- **IPAX GmbH** (gap): The servers and the nightly Velero copy of every volume are at IPAX. A project deletion reaches the database, the object store and the vector index; the copies age out after 30 days. No deletion run for a whole organization at contract end exists yet.
- **OpenRouter, Inc.** (partial): On the platform's key every request runs with zero data retention: neither OpenRouter nor the model provider keeps content, so nothing is left to delete. Where an organization switches zero data retention off or brings its own key, the provider's retention applies, and deletion at contract end does not reach those copies.
- **Upstream AI model providers (via OpenRouter)** (partial): As for OpenRouter; the provider is reached only through OpenRouter.
- **WorkOS, Inc.** (gap): WorkOS holds accounts, memberships, the audit trail and, in WorkOS Vault, an organization's own AI keys. Audit events carry project, organization and document names. At contract end neither the organization, its users, its audit trail nor its keys are deleted automatically.
- **PostHog, Inc.** (gap): Events are kept up to 12 months, session recordings up to 30 days. Support tickets carry a report's text (masked by the organization's content screening) and stay until we delete them. At contract end an organization's persons, events and tickets are not deleted automatically.
- **Slack Technologies, LLC** (gap): Notices about reports carry the ticket number, kind, deployment, the organization's name and links, no text of a report or a chat. Error alerts carry the issue's title, which is the exception message and can name a document or a project. Everything stays under the Slack workspace's retention; deletion at contract end does not reach it.
- **AlphaAI Technologies Inc. (Tavily)** (unknown): Tavily's privacy policy names no period: search queries stay as long as needed to provide and improve the service, and may be used to improve answers to future queries unless a contract says otherwise. No zero-retention agreement exists; deletion at contract end does not reach the queries.
- **komoot GmbH** (unknown): The public Photon service is used without an account or a contract; whether komoot logs queries, and for how long, is not established. Deletion at contract end does not reach them.
- **PostgreSQL** (in the cluster): A project deletion removes the project's rows; point-in-time recovery keeps copies for 30 days. A deletion run for the whole organization (including `llm_usage_events` and conversation state) is missing.
- **SeaweedFS (S3-kompatibel / S3-compatible)** (in the cluster): A project deletion removes the project's objects; the organization's bucket stays at contract end.
- **Qdrant** (in the cluster): A project deletion removes the project's points and snapshots keep them for 7 days; at contract end the organization's points stay.
- **Dragonfly (Redis-kompatibel / Redis-compatible)** (in the cluster): Nothing is written to a volume; entries expire or are evicted, and a restart empties the cache. The Velero copies do not contain it.
- **Langfuse** (in the cluster): Traces are deleted after 30 days and removed with a deleted chat.
- **Hatchet** (in the cluster): Jobs are deleted after 14 days.

## Public sources (not processors)

- Federal Legal Information System (Federal Chancellery, Austria): search terms and identifiers of legal provisions derived from your questions
- Federal Office of Metrology and Surveying (Austria): the public address register is downloaded whole twice a year and stored with us; an address you type is looked up in our database only and never sent to the BEV
- Fedlex (Swiss Federal Chancellery): identifiers of federal acts and dates derived from your questions — **not in use** (not on the page): configured in configs/sources/ch/fedlex/ to prove the http_eli access type (ADR-0162); no country pack entitles an office to it, so nothing is fetched for anyone. Set it active, which lists it on the page, when a pack uses it.

## Build, deployment and engineering services (not processors)

None receives a prompt, a document or account data of an office.

- GitHub (USA) — source-code hosting, CI pipelines, security scanning.
- Pulumi Cloud (Pulumi Corporation, USA) — the infrastructure's state and the operator's secrets (Pulumi ESC), among them the cluster credentials; no content from the product.
- Anthropic (USA) — AI assistant in development (Claude Code on issues and pull requests); receives source code, issue text and CI logs, no data from the product.
- Package registries, Helm charts and base images (PyPI, npm, Docker Hub, NVIDIA NGC, Debian/Node mirrors) — software dependencies fetched at build and deploy time.
- Let’s Encrypt (USA) — TLS certificates for the product domains; receives only the domain names.
- ClamAV signatures (Cisco Talos) — malware signatures are downloaded; nothing is uploaded.
- Google Fonts — fonts are downloaded once at build time and self-hosted; your browser never contacts Google when using the product.
- Buffer (USA) — publishes our blog's posts on social networks once a person has approved them; receives only those posts, no data from the product.
