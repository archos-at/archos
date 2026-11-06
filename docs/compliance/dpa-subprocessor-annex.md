<!-- AUTO-GENERATED from configs/subprocessors/*.yaml by scripts/generate_subprocessor_pages.py. Do not edit; change the register. -->

# DPA annex: subprocessors and recipients

The processor list of the data processing agreement (AVV, Art. 28 GDPR), generated from the data-flow register ([how it works](data-flow-register.md)). The public page `/legal/subprocessors` is generated from the same rows. **Engineering inventory, not legal advice: counsel reviews it before it is signed.**

Statuses: `active` is in use; `conditional` only when an organization or the operator configures it; `latent` is reachable in code but refused at boot in a deployment people sign in to.

## Recipients

| Recipient | Status | Entity | Processed in | Data classes | Purposes (DPV) | Transfer (DPV) | Contract | Deletion at contract end |
|---|---|---|---|---|---|---|---|---|
| IPAX OG | active | AT | AT | tenant_content, model_io, account_identity, telemetry, backups | dpv:ServiceProvision | — | to confirm | **gap**: The servers and the nightly Velero copy of every volume are at IPAX. A project deletion reaches the database, the object store and the vector index; the copies age out after 30 days. No deletion run for a whole organization at contract end exists yet. |
| OpenRouter, Inc. | active | US | US | model_io, tenant_content | dpv:ImproveExistingProductsAndServices, dpv:ServiceProvision | eu-gdpr:A46-2-c (eu-gdpr:A45-3 where DPF-certified) | to confirm | **partial**: On the platform's key every request runs with zero data retention: neither OpenRouter nor the model provider keeps content, so nothing is left to delete. Where an organization switches zero data retention off or brings its own key, the provider's retention applies, and deletion at contract end does not reach those copies. |
| Upstream AI model providers (via OpenRouter) | active | various | various | model_io, tenant_content | dpv:ServiceProvision | eu-gdpr:A46-2-c (eu-gdpr:A45-3 where DPF-certified) | to confirm | **partial**: As for OpenRouter; the provider is reached only through OpenRouter. |
| ElevenLabs, Inc. (via OpenRouter) | active | US | US | voice_audio | dpv:ServiceProvision | eu-gdpr:A46-2-c (eu-gdpr:A45-3 where DPF-certified) | to confirm | **not_retained**: Every transcription runs on the platform's key with zero data retention; the audio is not stored. |
| WorkOS, Inc. | active | US | US | account_identity, audit_metadata | dpv:EnforceSecurity, dpv:ServiceProvision | eu-gdpr:A46-2-c (eu-gdpr:A45-3 where DPF-certified) | to confirm | **gap**: WorkOS holds accounts, memberships and the audit trail. Audit events carry project, organization and document names. At contract end neither the organization, its users nor its audit trail are deleted automatically. |
| PostHog, Inc. | active | US | DE | telemetry, operational_log, support_text, trace_metadata | dpv:CustomerCare, dpv:ImproveExistingProductsAndServices, dpv:ServiceOptimisation | eu-gdpr:A45-3, eu-gdpr:A46-2-c | to confirm | **gap**: Events are kept up to 12 months, session recordings up to 30 days. Support tickets carry a report's text (masked by the organization's content screening) and stay until we delete them. At contract end an organization's persons, events and tickets are not deleted automatically. |
| Slack Technologies, LLC | active | US | US | ids_only | dpv:CustomerCare, dpv:ServiceOptimisation | eu-gdpr:A46-2-c (eu-gdpr:A45-3 where DPF-certified) | to confirm | **no_tenant_text**: Notices to the team carry the ticket number, the kind of report, the deployment, the organization's name and links, but no text of a report or a chat. They are kept by the Slack workspace's retention. |
| Tavily | active | US | US | search_query | dpv:ServiceProvision | eu-gdpr:A46-2-c (eu-gdpr:A45-3 where DPF-certified) | to confirm | **unknown**: Whether and how long Tavily keeps search queries is not established; deletion at contract end does not reach them. |
| Cloudflare, Inc. | active | US | global | mail_transit | dpv:ServiceProvision | eu-gdpr:A46-2-c (eu-gdpr:A45-3 where DPF-certified) | to confirm | **vendor_retention**: Mail to a project address passes through Cloudflare and is not stored there; Email Routing's activity log keeps sender, recipient, time and outcome under Cloudflare's own retention. |
| komoot GmbH | active | DE | DE | address_query | dpv:ServiceProvision | — | **no contract** | **unknown**: The public Photon service is used without an account or a contract; whether komoot logs queries, and for how long, is not established. Deletion at contract end does not reach them. |
| Browser push services (Google FCM, Mozilla, Apple) | active | US | global | notification | dpv:ServiceProvision | eu-gdpr:A46-2-c (eu-gdpr:A45-3 where DPF-certified) | **no contract** | **not_retained**: The notification is end-to-end encrypted (RFC 8291); the push service cannot read it and holds it only until delivery. |
| OpenAI, L.L.C. (direct) | conditional | US | US | model_io, voice_audio | dpv:ServiceProvision | eu-gdpr:A46-2-c (eu-gdpr:A45-3 where DPF-certified) | to confirm | **controller_designated**: Reached only when an organization stores its own OpenAI key or the operator sets a base URL to api.openai.com; then OpenAI's retention applies under the key holder's contract. |
| Modal Labs, Inc. | latent | US | US | model_io | dpv:ServiceProvision | eu-gdpr:A46-2-c (eu-gdpr:A45-3 where DPF-certified) | **no contract** | **not_used**: Not in use; a deployment people sign in to does not start while the service is configured. |
| Serper.dev | latent | US | US | search_query | dpv:ServiceProvision | eu-gdpr:A46-2-c (eu-gdpr:A45-3 where DPF-certified) | **no contract** | **not_used**: Not in use; a deployment people sign in to does not start while the service is configured. |
| Jina AI GmbH | latent | DE | DE | model_io | dpv:ServiceProvision | — | **no contract** | **not_used**: Not in use; a deployment people sign in to does not start while the service is configured. |
| Weights & Biases, Inc. | latent | US | US | telemetry | dpv:ServiceOptimisation | eu-gdpr:A46-2-c (eu-gdpr:A45-3 where DPF-certified) | **no contract** | **not_used**: Not in use; a deployment people sign in to does not start while the service is configured. |
| LangChain, Inc. (LangSmith) | latent | US | US | model_io | dpv:ServiceOptimisation | eu-gdpr:A46-2-c (eu-gdpr:A45-3 where DPF-certified) | **no contract** | **not_used**: Not in use; a deployment people sign in to does not start while the service is configured. |
| Datadog, Inc. | latent | US | US | telemetry | dpv:ServiceOptimisation | eu-gdpr:A46-2-c (eu-gdpr:A45-3 where DPF-certified) | **no contract** | **not_used**: Not in use; this repository does not load the Datadog SDK. |
| Anthropic, PBC (direct) | latent | US | US | model_io | dpv:ServiceProvision | eu-gdpr:A46-2-c (eu-gdpr:A45-3 where DPF-certified) | **no contract** | **not_used**: Not in use; a deployment people sign in to does not start while the key is set. |
| Google LLC (Gemini API, direct) | latent | US | US | model_io | dpv:ServiceProvision | eu-gdpr:A46-2-c (eu-gdpr:A45-3 where DPF-certified) | **no contract** | **not_used**: Not in use; a deployment people sign in to does not start while the key is set. |

## Contracts still to confirm

Listed recipients whose contract the register does not record as a signed DPA: IPAX OG, OpenRouter, Inc., Upstream AI model providers (via OpenRouter), ElevenLabs, Inc. (via OpenRouter), WorkOS, Inc., PostHog, Inc., Slack Technologies, LLC, Tavily, Cloudflare, Inc., komoot GmbH, Browser push services (Google FCM, Mozilla, Apple), OpenAI, L.L.C. (direct).

## Deletion at contract end: where it does not reach yet

No run deletes an organization as a whole today; deletion is per project, conversation and folder. Every store below holds an office's text after its contract ends: until the bound it names, or without one.

- **IPAX OG** (gap): The servers and the nightly Velero copy of every volume are at IPAX. A project deletion reaches the database, the object store and the vector index; the copies age out after 30 days. No deletion run for a whole organization at contract end exists yet.
- **OpenRouter, Inc.** (partial): On the platform's key every request runs with zero data retention: neither OpenRouter nor the model provider keeps content, so nothing is left to delete. Where an organization switches zero data retention off or brings its own key, the provider's retention applies, and deletion at contract end does not reach those copies.
- **Upstream AI model providers (via OpenRouter)** (partial): As for OpenRouter; the provider is reached only through OpenRouter.
- **WorkOS, Inc.** (gap): WorkOS holds accounts, memberships and the audit trail. Audit events carry project, organization and document names. At contract end neither the organization, its users nor its audit trail are deleted automatically.
- **PostHog, Inc.** (gap): Events are kept up to 12 months, session recordings up to 30 days. Support tickets carry a report's text (masked by the organization's content screening) and stay until we delete them. At contract end an organization's persons, events and tickets are not deleted automatically.
- **Tavily** (unknown): Whether and how long Tavily keeps search queries is not established; deletion at contract end does not reach them.
- **komoot GmbH** (unknown): The public Photon service is used without an account or a contract; whether komoot logs queries, and for how long, is not established. Deletion at contract end does not reach them.
- **PostgreSQL** (in the cluster): A project deletion removes the project's rows; point-in-time recovery keeps copies for 30 days. A deletion run for the whole organization (including `llm_usage_events` and conversation state) is missing.
- **SeaweedFS (S3-kompatibel / S3-compatible)** (in the cluster): A project deletion removes the project's objects; the organization's bucket stays at contract end.
- **Qdrant** (in the cluster): A project deletion removes the project's points and snapshots keep them for 7 days; at contract end the organization's points stay.
- **Langfuse** (in the cluster): Traces are deleted after 30 days and removed with a deleted chat.
- **Hatchet** (in the cluster): Jobs are deleted after 14 days.

## Public sources (not processors)

- Federal Legal Information System (Federal Chancellery, Austria): search terms and identifiers of legal provisions derived from your questions
