# R2: Data residency, sovereignty and provenance for an architects' workspace

Research input for the international foundation design (Notion ticket 30), with its two primary consumers: project setup (ticket 31) and office base knowledge (ticket 32). External research as of 2026-11-04. All sources are cited with their date, or with the date I retrieved them where the page carries none (retrieved 2026-11-04). Confidence markers: **[V]** means checked against a primary source (the regulator, the official journal or the vendor's own docs). **[S]** means secondary sources only (law firms, trade press); verify before relying on it. **[J]** marks my own judgement or inference.

Repository state is from the docs as they stand today: `docs/compliance/compliance-audit-2026-07.md` and ADRs 0002, 0044, 0100, 0115, 0150, 0151.

---

## 0. The findings that change the design

1. **Residency is a property of each data flow, not of the deployment.** Every vendor that sells residency (Atlassian, Slack, Notion, GitHub, OpenRouter, Anthropic, Bedrock) covers some data classes (content at rest, sometimes inference) and leaves others global (identity, billing, audit and abuse logs, analytics). The foundation needs a data classification on every store and every outbound call; a `region` column on the organization is not enough. [V]
2. **EU-only LLM inference is buyable, but not from Anthropic's first-party API.** That API offers `inference_geo: "us" | "global"` and workspace geo `"us"` only [V]. Claude stays in the EU through Bedrock `eu.` profiles, Vertex EU endpoints, or `eu.openrouter.ai`, which fails closed [V/S]. Today every prompt goes through OpenRouter in the US with no pinning (audit 2026-07) [repo].
3. **The DPF stands but is on appeal.** The General Court upheld it on 2025-09-03 (T-553/23). Latombe appealed on 2025-10-31 (C-703/25 P), still pending as far as I can find [S]. Use SCCs as well, and keep a tested EU-only fallback so an adverse judgment is a configuration change.
4. **Swiss public bodies effectively bar international SaaS for confidential data.** privatim, 2025-11-18: only with customer-held keys the provider cannot reach [S]. An LLM must see plaintext, so a municipal Swiss client needs Swiss or EU-operated processing or "not for this data class".
5. **Germany has made sovereignty auditable.** C5:2026 (published 2026-04-07, audits from 2027-06-01), C3A sovereignty criteria (2026-04-27) and the Commission's SEAL levels are what public buyers now ask about [S]. A startup inherits only the infrastructure controls its provider's assessment covers; the application's own controls need their own assessment. It says so per data class, without claiming the whole service is C5-compliant.
6. **The architect's confidentiality duty is per-country professional law.** Austria § 14 ZTG 2019 plus Standesregeln [S]; Germany through chamber law and contract, not § 203 StGB as far as I can tell [J]; Switzerland contractual [J]. German federal buildings can carry VS-NfD classification under RBBau [S]. This is country base knowledge, and it drives a per-project sensitivity class.
7. **AI Act: Art. 50 applies since 2026-08-02, with machine-readable marking due by 2026-12-02 for systems already on the market** [S]. The Omnibus moved high-risk duties to 2027-12-02/2028-08-02 [S]. The agent is very likely not high-risk [J].
8. **Tenant relocation is rare and painful in the industry.** Atlassian accepts up to 24 h downtime; Langfuse, Datadog and GHE.com do not move tenants at all [V]. A tenant partition key everywhere plus one export/import operation is cheap now and serves Data Act switching too.
9. **Provenance has a standard per layer:** W3C PROV for derivation, ELI for legal sources (RIS and Fedlex publish it), C2PA 2.3 for file outputs only [V/S].
10. **Four vendors need a residency decision before a second country:** WorkOS (no EU region found), Tavily (US, Nebius-owned since the February 2026 deal), komoot's public Photon (every typed address leaves, no published API terms) and OpenRouter (unpinned). Self-hosted Langfuse, Hatchet and Qdrant plus PostHog EU are fine.

---

## 1. Law: what binds a B2B SaaS that stores project documents and sends text to LLMs

### 1.1 GDPR Chapter V (EU/EEA customers: Austria, Germany, Liechtenstein, South Tyrol)

**The mechanism stack.** A transfer to a third country needs one of three things: an adequacy decision (Art. 45); appropriate safeguards (Art. 46), in practice the 2021 SCCs (Commission Implementing Decision (EU) 2021/914, modules 2 controller-to-processor and 3 processor-to-processor); or a narrow derogation (Art. 49). After Schrems II, SCCs need a transfer impact assessment and supplementary measures where needed, following EDPB Recommendations 01/2020 (final version 2.0, adopted 2021-06-18) [V via EDPB news, 2021-06]. The Recommendations say explicitly that *remote access* from a third country, and storage by a cloud provider outside the EEA, count as transfers [S, 2021]. So a US support engineer opening a tenant's data is a transfer even when the bytes sit in Frankfurt [J].

**Our role chain.** The office is controller, the agent its processor, and every LLM, observability, search or geocoding vendor that receives tenant content a sub-processor; Chapter V applies per hop. The July 2026 audit rates the current OpenRouter path Critical: no provider/region/data-policy allowlist and no ZDR pinning (`compliance-audit-2026-07.md`, lines 23-25, 48) [repo].

**EU-US Data Privacy Framework (DPF), status 2026-11.**
- Adequacy decision of 2023-07-10. The General Court dismissed Latombe's annulment action on **2025-09-03** (Case T-553/23) [S: WilmerHale 2025-12-01; HLC; FKKS].
- Latombe filed an appeal on **2025-10-31** (Case **C-703/25 P**). The pleas include bulk collection and the dependence of the redress mechanism on an Executive Order. I found no hearing, AG opinion or judgment as of this research [S: WilmerHale 2025-12-01; Captain Compliance; Digital Policy Alert].
- In February 2026 the Norwegian DPA said the DPF remains in effect but companies should prepare an exit strategy. Danish guidance called for concrete plans to "free themselves" from US services if the DPF falls [S, 2026-02].
- **Design consequence [J]:** treat DPF as a convenience, never as the only leg. Every US sub-processor needs SCCs and a TIA as well, and every data class that may go to the US needs a tested EU-only alternative path. If the CJEU annuls the DPF, Schrems II showed there is no grace period.

**EU-hosted does not mean out of reach of US law.** A US-parented processor running in the EU can still be compelled under the CLOUD Act (2018). That is not a Chapter V transfer in itself, but it is a risk that DPAs, the EU Data Act (Art. 32, below) and the sovereignty frameworks (C3A, SEAL) all score [S/J]. This is the line between *residency* (where the bytes are) and *sovereignty* (whose law can reach them and who operates the system). The foundation should record both, per vendor.

**EDPB on AI models.** Opinion 28/2024 (2024-12-17): a model trained on personal data is not anonymous by default [S: CMS 2024-12]. It matters upstream, and for what we persist from model output: the audit's open finding S4 is memory distillates stored without a PII filter [repo].

### 1.2 Switzerland: revDSG/nDSG

- **In force since 2023-09-01.** Cross-border disclosure (Art. 16) is allowed to countries the Federal Council lists as adequate (Annex 1 DPO). Otherwise it needs safeguards (Swiss-adapted SCCs, with the FDPIC's acknowledgement of the EU SCCs plus a Swiss addendum), or an Art. 17 exception [S: Lexmundi, presencis, FDPIC page].
- **The EU/EEA is on the Swiss list**, so a Swiss office whose data is processed in Frankfurt makes no problematic transfer [S]. I would not assume the Swiss and EU adequacy lists stay identical; the Federal Council decides on its own [S].
- **Swiss-US DPF:** the Federal Council decided on 2024-08-14, effective 2024-09-15, for certified US organisations only [S: Lenz & Staehelin; Schellenberg Wittmer].
- **Personal criminal liability [J from statute; verify].** The revDSG fines *natural persons* (up to CHF 250,000) for intentional breaches, including of the duty of care when disclosing data abroad or engaging a processor. This is a likely reason Swiss buyers ask harder questions than German buyers of the same size: the person who signs bears the risk.
- **What Swiss customers expect [J].** Private offices usually accept EU hosting; larger offices and anything near the public sector ask for Swiss hosting (AWS Zurich, Azure Switzerland North, GCP europe-west6) and a Swiss-law contract. Vendor "EU" and "Europe" differ in extent: GitHub's EU includes Norway and Switzerland, OpenRouter's Europe includes the UK and Switzerland, Atlassian sells Zurich separately [V]. Store the list of jurisdictions per region, never a label.
- **Public sector:** privatim (the conference of Swiss cantonal data protection officers), resolution of **2025-11-18**. International SaaS for particularly sensitive data, or data under a legal secrecy duty, is acceptable only with customer-side encryption where the provider has no key access. Most SaaS, Microsoft 365 named, does not meet this [S: heise 2025-11; The Register 2025-12-01; datenrecht.ch; Canton of Fribourg OEDSMB news]. datenrecht.ch reads it as guidance, not a ban [S]. For an LLM workspace the model must see plaintext, so client-side encryption alone cannot satisfy the resolution. The honest product answer is Swiss-operated processing, or keeping this class out of the model [J].
- **AI regulation:** no Swiss AI Act. On 2025-02-12 the Federal Council decided to implement the Council of Europe AI Convention (signed 2025-03-27) through sectoral amendments. The consultation draft was announced for end of 2026; an SME-portal item of 2026-09-23 says early 2027 [S: BAKOM; kmu.admin.ch 2026-09-23].

### 1.3 Austria

- **GDPR + DSG**, supervised by the Datenschutzbehörde.
- **NIS2: NISG 2026**, adopted 2025-12-12, published 2025-12-23, in force **2026-10-01**. Registration runs to the end of 2026. Competent authority BMI, CSIRT CERT.at [S: Schönherr; Lex Mundi; Cerha Hempel 2026-06].
- **Professional secrecy of architects:** § 14 ZTG 2019, Verschwiegenheitspflicht. The chamber's Standesregeln (Berufskodex, in force 2024-01-01) add that statements about a commission and its content may be made to third parties only with the client's express consent, and that information received under secrecy may be used only in a limited way [S: arching.at Standesregeln PDF; jusline]. The VfGH has held the duty is not absolute [S]. **Flag:** one RIS metadata entry shows an end-of-validity date of 2025-08-31 for a ZTG 2019 provision, which may mean an amendment. Verify the current consolidated text in RIS before quoting it in product copy.
- **Design consequence [J]:** sending a client's project documents to a sub-processor is lawful under GDPR with a DPA. Whether it is consistent with § 14 ZTG depends on the office's commission terms. The agent should give the office (a) a sub-processor list per data class, (b) a contract template clause, and (c) a per-project setting that keeps a project out of model processing or restricts it to an EU-only path.

### 1.4 Germany

- **Professional secrecy:** § 203 StGB, reformed in 2017 to allow outsourcing to contractors bound to confidentiality (§ 203(4)), lists doctors, lawyers, tax advisors, auditors and others. As far as I can determine, it does not list architects [J, verify]. Their confidentiality comes from the Länder Architektengesetze/Baukammergesetze, the chamber Berufsordnungen and the commission contract. Offices that work with lawyers or notaries on a project may still receive § 203 material [S: CMS on § 203 outsourcing].
- **Classified building documents:** for federal construction, RBBau requires security measures to be specified and a Geheimschutz classification of the building documents. VS-NfD contracts bind contractors and subcontractors to the VS-NfD Merkblatt, and the BSI IT-Grundschutz module CON.11.1 governs the digital processing [S: Bavarian RBBau document; Bundeswehr Merkblatt; Grant Thornton 2025]. An office planning a ministry, a barracks or critical infrastructure may hold VS-NfD drawings. **Design consequence [J]:** the project must be able to carry a sensitivity class that blocks model processing and third-party connectors entirely, and country base knowledge should hold "what classification regimes exist here" as data.
- **BSI C5:** C5:2020 is the reference attestation for cloud services used by German public bodies and, increasingly, regulated industry. **C5:2026** was published on 2026-04-07 as a non-binding catalogue that includes a German reading of the EU cloud certification scheme. It grew from 121 to 168 criteria and applies to audits that start on or after 2027-06-01 [S: Digital Policy Alert; heise; cloudmagazin 2026-05-28]. Earlier sources expected a "C5:2025" with a 2027-01-01 start; the naming changed.
- **BSI C3A** (Criteria enabling Cloud Computing Autonomy), published **2026-04-27**: six sovereignty domains SOV-1 to SOV-6, with C5 as a prerequisite [S: KPMG; vergabeblog 2026-04-30; cloudmagazin 2026-07-11].
- **Federal procurement practice:** a sovereign federal AI cloud (about EUR 250 million, May/June 2026) went to T-Systems/SAP and an SVA consortium on STACKIT infrastructure, with ISO 27001 + C5 required and C3A as the next stage; no US hyperscaler won [S: cloudmagazin 2026-05-21, 2026-07-02].
- **NIS2: NIS2UmsuCG** promulgated and in force **2025-12-06** (BGBl. I 2025 Nr. 301). The registration deadline was 2026-03-06, through the MUK and BSI portal [S: usd.de; iww; pv magazine 2026-01-06].
- **Gaia-X:** labels Level 1-3 are live, adoption is pilot-scale [S: Gaia-X; Forrester]. **[J]** Not a procurement gate for SaaS sold to architecture offices; C5, C3A and SEAL are what a municipal IT department asks about.

### 1.5 Sovereignty frameworks at EU level

- **Commission Cloud Sovereignty Framework**, v1.2.1, October 2025: eight sovereignty objectives (SOV-1 to SOV-8), each scored from SEAL-0 (none) to SEAL-4 (full digital sovereignty). SEAL-1 is jurisdictional, SEAL-2 data sovereignty, SEAL-3 digital resilience. A tender rejects any bid below the minimum on any objective; the weighted score then becomes an award criterion. It was first applied in a roughly EUR 180 million EU institutions sovereign-cloud tender, reportedly with SEAL-2 as minimum [S: framework PDF mirrored by ppc.land 2025-11; Proliance; arc42 quality].
- **AWS European Sovereign Cloud:** GA 2026-01-14/15, region `eusc-de-east-1` (Brandenburg), a separate partition `aws-eusc`, EU-resident operations, more than EUR 7.8 billion investment. Sovereign Local Zones are announced for Belgium, the Netherlands and Portugal [V: Amazon press 2026-01-15; InfoQ 2026-01].
- **[J] What this means for us.** Sovereignty is now a vector of separately scored dimensions (jurisdiction, operations, supply chain, technology), not a yes/no. The foundation's per-region record should carry those dimensions for each vendor and each infrastructure layer, so a customer or tender can be answered from data.

### 1.6 Beyond DACH

**United Kingdom.** UK GDPR plus the DPA 2018, amended by the **Data (Use and Access) Act 2025**. The Commission renewed the EU→UK adequacy decisions on **2025-12-19**, valid to **2031-12-27** [S: Hunton; eucrim; RPC spring 2026]. UK→US transfers use the UK Extension to the DPF ("data bridge", in force 2023-10-12) or the IDTA/UK Addendum to the EU SCCs [J from prior knowledge]. EU-hosted processing therefore serves UK customers without a transfer problem. A UK region is a market choice, not a legal necessity.

**EU Data Act (Regulation (EU) 2023/2854).** Applicable since **2025-09-12**.
- *Chapter VI, switching (Arts. 23-31):* a customer of a "data processing service" (SaaS included) can switch provider or go on-premises. Notice is at most two months and the transition period 30 days, with export of exportable data and digital assets. Reduced switching charges are allowed until **2027-01-12**; from that date no switching or egress charges may be levied [S: Alston 2025-09; McCann FitzGerald; Bundesnetzagentur glossary]. There are lighter rules for custom-built services and for providers in trial periods [J, verify].
- *Art. 32:* providers must take reasonable technical, legal and organisational measures against third-country governmental access to **non-personal** data held in the EU where it would conflict with EU or member-state law [S: presencis; Stephenson Harwood]. Project documents, IFC models and drawings are largely non-personal data, so Art. 32 reaches exactly the data GDPR does not [J].
- **Design consequence [J]:** "export the whole office, in open formats, in a defined time" is a legal duty. It is the same operation as tenant relocation between regions (section 3.3), so build it once.

**EU AI Act (Regulation (EU) 2024/1689)**, as amended by the Digital Omnibus on AI.

| Date | What applies | Relevance to us |
|---|---|---|
| 2024-08-01 | Entry into force | — |
| 2025-02-02 | Prohibitions (Art. 5), AI literacy (Art. 4) | Art. 4: staff and *customer* guidance. The Omnibus reportedly rewrote Art. 4 into "supporting measures" (July 2026) [S] |
| 2025-08-02 | GPAI model obligations (Arts. 53-55), governance | Upstream (Anthropic, etc.). We become a GPAI *provider* only by modifying a model substantially; the Commission's July 2025 GPAI guidelines put the threshold at about one third of the original training compute [J, verify] |
| 2026-08-02 | Art. 50 transparency; Commission enforcement powers over GPAI | Art. 50(1): tell people they are talking to an AI unless obvious. Art. 50(2): machine-readable marking of synthetic text, images and audio by system providers. 50(4): deployers label deepfakes and AI text published to inform the public on matters of public interest |
| 2026-12-02 | End of grace period for Art. 50(2) marking by systems already on the market before 2026-08-02; new Art. 5 prohibition (non-consensual intimate imagery/CSAM) | We have been on the market, so marking must be in place by 2026-12-02 [S] |
| 2027-12-02 | Annex III high-risk (moved from 2026-08-02) | Annex III does not list architectural planning or permit preparation by private offices [J] |
| 2028-08-02 | Annex I (product-embedded) high-risk | Not us |

Sources: Omnibus adopted as Regulation (EU) 2026/1744, OJ 2026-07-24, in force 2026-07-27 [S: compliancehub, SRD Rechtsanwälte, Holistic AI; Council approval 2026-06-29]. Code of Practice on marking and labelling AI-generated content, final **2026-06-10**, voluntary, with a presumption of conformity for signatories; Commission adequacy confirmation reported for 2026-07-08 and final Art. 50 guidelines for 2026-07-20 [S: Jones Day 2026-06; SCL; Commission digital-strategy page].

**[J] Obligations we should meet:**
- Art. 50(1) disclosure in the UI and in anything the agent sends outward, such as letters drafted to authorities.
- Art. 50(2) machine-readable marking of generated documents. For text exports (PDF, DOCX) this can be embedded metadata, with C2PA where the format supports it.
- Logging: Arts. 12/19/26(6) bind only high-risk systems, but the same trace (which model, which sources, which version of the base knowledge, which human confirmed) is what the provenance and quality obligations elsewhere in this design need. Langfuse already holds most of it.
- An AI-literacy pack per country, as country base knowledge content.

**NIS2.** Cloud computing service providers are in Annex I (digital infrastructure) but subject to the size cap, so a small or micro SaaS company is generally outside direct scope [J from the Directive's size-cap rule; verify against NISG 2026 and NIS2UmsuCG thresholds]. In-scope customers pass supply-chain requirements down (Art. 21(2)(d)). Architecture offices themselves are rarely NIS2 entities. Their public clients, hospitals and utilities can be.

**United States.** No federal privacy statute. Relevant: the **CLOUD Act** (2018); FISA § 702 (reauthorised in April 2024 for two years; check its status after April 2026, which matters to the DPF appeal); state laws (CCPA/CPRA and others); and the **DOJ Data Security Program** (28 CFR Part 202, effective **2025-04-08**), which restricts access by "countries of concern" (China incl. HK/Macau, Cuba, Iran, North Korea, Russia, Venezuela) and covered persons to bulk US sensitive data, including via vendor agreements and even when anonymised or encrypted; amended January/February 2026 [S: Cornell; Foley Hoag 2025-06]. **[J]** For US tenants, no covered-person model or sub-processor may be in the routing set: a per-region allowlist, the same primitive as the EU one.

---

## 2. What this means per data class

The design needs one classification that every store, queue, log and outbound call carries. From the law above and the vendor patterns below, I propose these classes. Names follow existing vocabulary where possible (ISO/IEC 27001 asset classes, NIST SP 800-60 style categories); the final words belong in `naming.md` [J].

| Class | Examples in the agent | Residency rule | Notes |
|---|---|---|---|
| **Tenant content** | Uploaded documents, IFC models, drawings, chat turns, generated documents, project facts (address, parcel, Stichtag, Steckbrief) | Stored in the tenant's residency region. Processed only in that region's allowed processing set | Includes non-personal data, which the Data Act Art. 32 covers |
| **Tenant-derived index** | Qdrant vectors, chunk text, memory digests, search indices | Same as tenant content | An embedding of a document is a copy of it. EDPB Opinion 28/2024 logic: not anonymous by default |
| **Model I/O in transit** | Prompts, completions, tool arguments sent to LLM, search and geocoder providers | Only to processors in the region's allowed set, with the residency proven per request (e.g. `usage.inference_geo`, region-pinned endpoint) | The hardest flow; see section 4 |
| **Telemetry with content** | Langfuse traces (prompts and outputs), error reports with payloads | Same region as tenant content | Self-hosted Langfuse per region does this already (ADR-0044) |
| **Telemetry without content** | Metrics, counts, latencies, PostHog events without properties that carry content | May be pooled per jurisdiction bloc (EU+CH+UK) | PostHog EU Cloud (Frankfurt) |
| **Identity and directory** | Users, org membership, SSO config, roles (WorkOS) | Industry norm is a *global* identity plane (Atlassian, Slack and Notion all keep it out of residency scope) | Must be minimal: no project names or document filenames in audit events (the audit found WorkOS audit events carry document filenames) |
| **Platform base knowledge** | Legal corpus, standards metadata, authority registry, public data connectors' cached results that are not tenant-specific | Global, replicated read-only to every region | Licensing, not residency, governs it. ÖNORM/DIN full text is licensed |
| **Office base knowledge (overlay)** | An office's licensed norms, commentaries, authority directives, its own standards | **Tenant content**: regional, never pooled | Same primitives as platform base knowledge, owner = organization (ticket 32). Licensed text adds a no-training/ZDR requirement on every model that sees it |
| **Commercial and billing** | Contracts, invoices, entitlements | Global control plane | Entitlements (which countries an org has enabled) live here, separate from home country and residency region |
| **Security and audit logs** | Access logs, admin actions | Regional for tenant-scoped events; global for platform events | Every vendor keeps some of this global. Say which, in the sub-processor list |

**Three attributes on the organization, never conflated** (task gap (f)) [J]:
1. `home_country`: the jurisdiction that sets defaults (base knowledge, legal-advice regime, language).
2. `residency_region`: where tenant content lives and is processed. It references a region record that lists the jurisdictions it spans, its processor allowlist and its sovereignty profile.
3. `enabled_countries` (entitlements): the countries whose base knowledge the office may use (an Austrian office with a Bavarian project).

A project in an enabled foreign country stays in the office's residency region. Base knowledge is read from the global replica, and public-source connectors for the project's country are called from the residency region. Residency follows the *customer*, not the *site* [J; this is also how Atlassian, Slack and Notion scope it].

---

## 3. Engineering patterns

### 3.1 AWS cell-based architecture (Well-Architected, "Reducing the Scope of Impact with Cell-Based Architecture", published 2023-09-20) [V]

The concepts that transfer to residency:
- **Cell:** a complete, independent instance of the workload that serves a subset of tenants. A cell does not depend on another cell at runtime.
- **Partition key:** the attribute that maps a request to its cell. For us the natural key is `organization_id`. The residency region is a constraint on *which cells* an org may be placed in, not the key itself [J].
- **Cell router:** the thinnest possible layer that maps key → cell. It holds no business logic and must stay up when the control plane is down. For residency the router's mapping table is itself sensitive metadata (it reveals which org is where), so keep it global but content-free [J].
- **Control plane vs data plane:** the control plane provisions cells, places and migrates tenants and pushes configuration. The data plane serves requests. The data plane must keep working without the control plane: **static stability** (AWS Builders' Library, "Static stability using Availability Zones"). For residency, the global control plane may hold identity, billing, entitlements and the routing table, but never tenant content, and no regional data plane may need a synchronous call to it to answer a turn [J].
- **Cell migration:** moving a tenant between cells is an explicit, tested operation, which the whitepaper treats as a first-class capability.

**[J] Mapping to the agent.** Region = a set of one or more cells in one jurisdiction bloc. Start with one cell per region and one region (EU, Austrian or German datacentre). The primitives (partition key on every regional row and object key, a router, a global control plane that carries no content) cost little now. Adding Switzerland is then "add a cell in Zurich", not "re-architect".

### 3.2 How SaaS vendors draw the residency boundary

| Vendor | Model | In scope | Explicitly out of scope | Relocation | Source |
|---|---|---|---|---|---|
| **Atlassian** | Pinned locations over a global default. EU = Frankfurt + Dublin; also Germany, Switzerland (Zurich), UK and others | Issues, pages, attachments, comments, search data, project/workflow config, in-app notifications. Rovo chat logs and agent config. Loom transcripts and AI content | App analytics, user accounts (global identity service), audit and operational logs, data in transit (up to 30 days), caches | Scheduled move, up to 24 h downtime, up to 3 days of search re-indexing. Backups pinned only for those created after 2026-04-28 | Atlassian support, "Understand data residency" (retrieved 2026-11-04) [V] |
| **Slack** | Data regions incl. Frankfurt and Paris (each backs up the other) | Messages, canvases, files, search index, app/bot content at rest | Member profiles, workspace and channel membership | Through sales | Slack help 360035633934 [V] |
| **Notion** | EU = eu-central-1 Frankfurt, eu-west-1 Ireland backup | Workspace content at rest | Account info, usage data, subprocessor processing (incl. LLM providers). Calendar, Mail and beta features | Enterprise migration on request; otherwise data stays in US | Notion help, "Data residency" [V] |
| **GitHub (GHE.com)** | Dedicated subdomain stamp per enterprise; EU (incl. Norway, Switzerland), AU, US, JP | Code and "company data" | Some data may be stored elsewhere depending on feature or operational purpose; some features unavailable | Existing github.com orgs cannot be moved; migration happens at setup | GitHub docs [V] |
| **Datadog** | Fully separate *sites* (US1, US3, US5, EU1, AP1, AP2, US1-FED) | Everything for that site | Nothing shared across sites | Site cannot be changed after creation | Datadog docs, "Getting started with sites" [V] |
| **PostHog** | Fully separate EU Cloud on AWS eu-central-1 (Frankfurt) | "All event data, user data, and the product itself" | Per their FAQ: no EU→US transfer | Migration tutorial (export/import) | PostHog blog and subprocessors page (updated 2026-03-10) [V] |
| **Langfuse Cloud** | Fully separate regions: EU = Ireland (eu-west-1), US = Oregon, JP, HIPAA | Everything | Postgres backups to a second region in the same jurisdiction (EU → eu-central-1) | Not possible in place; new account + migration scripts | Langfuse, "Data regions" (retrieved 2026-11-04) [V] |
| **Hatchet Cloud** | Data planes in us-west-2, us-east-1, eu-west-1, ap-southeast-2 | Workflow data | Control plane in us-west-2 | — | Hatchet docs, region availability [V] |

**The three shapes [J]:**
1. **Isolated stacks** (Datadog, PostHog, Langfuse): the strongest residency, simple to explain, no relocation. Fits observability.
2. **Pinned content over a global identity/control plane** (Atlassian, Slack, Notion): the dominant pattern for collaboration SaaS. Content is regional, identity global, and relocation is a supported operation with downtime.
3. **Dedicated stamps** (GHE.com): per-customer or per-region stamp with its own hostname and identity isolation. This is the answer for a sovereign or public-sector tier (Swiss canton, VS-NfD project).

**Recommendation [J]:** shape 2 by default, with an exit to shape 3 for a sovereign tier. Identity stays global (WorkOS), but only with minimal attributes and an honest out-of-scope list. That is an explicit exception to the EU-only fallback, covered by SCCs and a transfer impact assessment until an EU identity option is chosen. That is exactly what the market leaders publish, and buyers accept it when it is written down.

### 3.3 Tenant relocation

From the vendors above [J]: every regional row, object key, vector point and trace carries `organization_id`, so a tenant's footprint can be enumerated (a CHECK constraint and a storage-key convention, the ratchet `AGENTS.md` asks for). Relocation is export in open formats, import into the target cell, router flip, verified deletion at the source, and re-embedding of derived indices in the target. Scheduled downtime is acceptable; Atlassian's 24 h shows the market tolerates it. Decide up front whether backups move or expire in place (Atlassian pins only backups made after 2026-04-28). Where the residency policy forbids retention in the source region, source backups are removed rather than left to expire, and any copy that remains is disclosed. One operation serves Data Act switching, region relocation and a DPF-failure fallback.

### 3.4 Global vs regional

Global, with no tenant content: minimal identity attributes, the routing table, billing and entitlements, connector *definitions*, prompts, skills, the model catalogue, and the **platform base knowledge** (legal corpus, standards metadata, authority registry, calendars, classification schemes, fee tables). Everything tenant-derived is regional. The platform layer replicates read-only to every region; the office layer is born regional because it is tenant content. Overlay resolution for a turn therefore reads two layers that are both local and makes no cross-region call [J]. That is the residency argument for "same primitives, differing only in owner".

---

## 4. LLM and AI-service regional processing (status 2026-11-04)

| Path | EU-only inference possible? | Mechanism | Storage at rest | Price effect | Source |
|---|---|---|---|---|---|
| **Anthropic Claude API (1P)** | **No.** Values are `"global"` (default, any geography) and `"us"`. Workspace geo only `"us"` | Per-request `inference_geo`; workspace `allowed_inference_geos`, `default_inference_geo`; response `usage.inference_geo` reports where it ran | US | US-only 1.1x on Claude 4.6+ | platform.claude.com, "Data residency" (retrieved 2026-11-04) [V] |
| **Claude on Amazon Bedrock** | **Yes**, via `eu.` geographic cross-region inference profiles, or single-region application inference profiles. Check every destination region of a profile for each source region before allowlisting: blocking one with an SCP makes inference fail rather than narrowing the routing | Inference profile ID; IAM must allow every destination region | Source region | Bedrock regional pricing | AWS ML blog (2026-08) and secondary [S]; claude.com/regional-compliance lists Europe "Included" [V] |
| **Claude on AWS European Sovereign Cloud** | Model availability to be checked per model | Separate partition `aws-eusc` | Brandenburg | — | AWS press 2026-01-15 [V]; model list not verified |
| **Claude on Google Vertex AI** | **Yes**, regional endpoints (e.g. europe-west1/3/4) and an EU multi-region endpoint. The global endpoint gives no location guarantee | Endpoint URL | Customer-selected location | Regional endpoints +10% | Google Cloud blog and Vertex data-residency page [V/S]; model × region matrix to verify |
| **Claude in Microsoft Foundry** | Europe "coming soon"; only a US Data Zone Standard today | Deployment type | — | 1.1x on US Data Zone | claude.com/regional-compliance; Anthropic docs [V] |
| **Azure OpenAI** | **Yes**: Data Zone Standard EU routes within the EU data zone (current docs say it follows the EU Data Boundary, which can include EFTA). Regional deployment for single-region | Deployment type | Resource region | — | Microsoft Learn, deployment types [V/S] |
| **Mistral (La Plateforme)** | **Yes** by default per secondary sources; `api.eu.mistral.ai`, EU/EFTA data centres | — | EU | — | Secondary only [S]; verify in the DPA at legal.mistral.ai |
| **OpenRouter** | **Yes**: `eu.openrouter.ai` decrypts in region and routes only to European endpoints (EU/EEA, UK, CH). Fails closed. Guardrail `allowed_data_regions: global/europe/us` rejects other domains with 403 | Base URL + guardrail; `provider.data_collection: "deny"`, `provider.zdr: true` | Account, billing, auth, security and abuse-monitoring records may be in the US | Business plan (self-serve) or Enterprise | openrouter.ai docs, "Sovereign AI" (retrieved 2026-11-04) [V] |

**What this means [J]:**
- ADR-0010 (LLM-agnostic, OpenAI-compatible) and the BYOK and runtime model configuration ADRs (0014, 0022) are the right base. Residency becomes a **constraint on model resolution**: the region record holds an allowlist of `(provider, endpoint, data policy)` tuples, and model resolution for a turn intersects the admin's chosen model with that allowlist. A model with no compliant endpoint in the region is not offered there. It must not be silently routed elsewhere.
- **Proof per call:** record the processing location the provider reports where it is precise enough (`usage.inference_geo`; for Bedrock, CloudTrail `additionalEventData.inferenceRegion` when it can be tied to the call) as Langfuse trace metadata, and mark the proof unknown otherwise. The Bedrock profile ID and the OpenRouter domain are evidence of a documented destination set, not of where a call ran. The repo already makes every model call a Langfuse generation, so this is one metadata field plus a score that fails when the location falls outside the region's set. That is the ratchet.
- **Fastest compliant step for the EU:** route EU tenants through `eu.openrouter.ai` with an `allowed_data_regions: ["europe"]` guardrail (Europe-wide: it can include UK and Swiss endpoints, so it is not EU-only unless an EU-only restriction is verified separately), `data_collection: "deny"` and `zdr: true`. Then check which Claude models OpenRouter serves from European endpoints. If the strongest model is not among them, use Bedrock `eu.` or Vertex EU directly for that model. OpenRouter's account and abuse metadata stays in the US, so it is a US sub-processor in any case and needs SCCs/DPF.
- **Licensed office overlay text** (ticket 32) may go only to endpoints with ZDR and no training. That is a data-policy constraint on top of the region constraint, and the same allowlist carries it.
- **Switzerland:** for the sensitive tier, an EU endpoint (lawful, since the EU is adequate) or a Swiss region where one exists. For data under professional secrecy, adequacy alone is not enough, since an EU endpoint does not stop the provider reading plaintext: keep such data out of international SaaS unless the required safeguards hold. Vertex and Azure both have Swiss regions; model availability there must be checked per model.

---

## 5. The vendors this product uses

| Vendor | Use in the agent | Today | Residency status | Risk | Action [J] |
|---|---|---|---|---|---|
| **WorkOS** | Identity, SSO, roles, folder roles, audit events (ADR-0002, 0087, 0097) | SaaS | No official EU region found. A secondary analysis (retrieved 2026-10-09) says the DPA names the US for storage and access. WorkOS publishes a "selective residency" view treating auth as a global control-plane function. Vault BYOK supports geographic residency *for keys* only [S/V] | Medium. Acceptable as global identity if attributes are minimal. The audit found audit events carry email, client IP **and document filenames** | Strip content (filenames, project names) from WorkOS audit events and keep the content-bearing audit trail regional. Get the DPA and DPF/SCC evidence (ADR-0002's open question). Name WorkOS as the global identity sub-processor in the residency statement |
| **Langfuse** | Traces, scores, review queue, prompts (ADR-0044, 0089) | **Self-hosted** OSS | Fully under our control. Cloud alternative EU = Ireland [V] | Low | One Langfuse per region. Never ship EU traces to a global instance |
| **PostHog** | Product analytics, feedback, metrics (ADR-0100, 0118, 0119) | **EU Cloud**, Frankfurt | Independent EU instance, "no EU→US transfer" per FAQ; subprocessors updated 2026-03-10 [V] | Low for EU/CH/UK. Medium if event properties carry content | Keep content out of events. For a US region, a separate US project |
| **Qdrant** | Vectors (ADR-0115) | **Self-hosted** on Kubernetes | Under our control. Cloud has EU regions; Hybrid Cloud keeps data on our clusters [V/S] | Low | One collection set per region. Re-embed on relocation |
| **Hatchet** | Background work (ADR-0150) | **Self-hosted** | Under our control. Cloud has an EU data plane (eu-west-1), but its control plane is in us-west-2 [V] | Low (self-hosted) | Stay self-hosted. Hatchet Cloud would put a US control plane into scope |
| **komoot Photon (public)** | Address autocomplete in project setup (ADR-0151, decided 2026-11-03) | `photon.komoot.io` | Public best-effort service under fair-use throttling. I found no published privacy or retention terms for the API and no stated server location. komoot GmbH (Germany) was acquired by Bending Spoons (Italy) in March 2025 [S]. ADR-0151 itself states that every typed address leaves the cluster | **High for international and for the public sector.** A client's property address linked to a project is personal data. Keystroke-level queries go to a party with no DPA. Throttling breaks setup at scale | Treat it as a *connector* with a declared data-flow class. For ticket 31's "verified address", prefer the country's **official address register** where it is open (Austria: BEV address register / basemap geocoder; Germany: Länder and BKG services; Switzerland: swisstopo/geo.admin.ch search), called server-side. Keep Photon as a fallback, or self-host per country index if volume grows |
| **Tavily** | Web search for the agent | SaaS | US. Privacy policy (updated 2025-11-24) covers the website, not API payloads. Nebius announced the acquisition on 2026-02-10 (USD 275 M) and says Tavily keeps its brand. No API ZDR found [S/V] | Medium. The audit already flags "Tavily & co. receive prompt-derived queries undocumented" | Treat search queries as model I/O in transit: strip tenant identifiers, list Tavily as a US sub-processor, and look for an EU-processing alternative before the sovereign tier |
| **OpenRouter** | LLM gateway (ADR-0010, 0014) | Global/US, unpinned | EU in-region routing available; account and ops data US [V] | **Critical** (the audit's top finding) | See section 4 |

**[J] Connectors are the new residency surface.** Ticket 31's public location sources (zoning GIS, hazard zones, heritage registers, cadastre, subsidies, local rules) are mostly public bodies' services inside the country. Calling them from the EU region is not a GDPR transfer problem for EU and Swiss sources. Each call still sends *a project's location* to a third party, and some are commercial (land-registry extracts with fees, Grundbuch access that needs an authorised user). So every connector descriptor in the base knowledge needs these fields:
- what it sends (address, parcel ID, coordinates, owner name);
- operator and jurisdiction;
- legal basis or terms;
- whether a DPA exists;
- the data class of its response (public reference data, or tenant content once attached to a project);
- caching rules (whether a response may be cached globally as platform reference data, or only regionally as tenant content).

With these fields, residency for setup is a property the agent can query, not a code path.

---

## 6. Provenance: standards and how they fit

### 6.1 W3C PROV (PROV-DM / PROV-O, W3C Recommendation, 2013-04-30) [V from prior knowledge, stable standard]
The core types are **Entity**, **Activity** and **Agent**. The relations: `wasGeneratedBy`, `used`, `wasDerivedFrom` (with the subtypes `wasRevisionOf`, `wasQuotedFrom`, `hadPrimarySource`), `wasAttributedTo`, `wasAssociatedWith`, `actedOnBehalfOf`, `wasInvalidatedBy`, plus `generatedAtTime`/`invalidatedAtTime`. **[J] How it fits:**
- A base-knowledge item edition is an Entity, and `wasRevisionOf` links it to its predecessor.
- An ingestion run is an Activity that `used` a source URL at a time.
- A derived project value, e.g. "Bauklasse = GK 3 under OIB-RL 2 (2023)", is an Entity that `wasDerivedFrom` the Steckbrief facts and the rule item. It `wasAttributedTo` the agent, and a person confirms it by an Activity associated with the person. That confirmation is ticket 31's "derived values confirmed before they count as secured", expressed in the standard's words.
- The office overlay is attribution: `wasAttributedTo` the organization, against the platform as Agent. A commentary is `wasDerivedFrom` the norm it comments on and is never a `hadPrimarySource` for a requirement. That is the founder's rule, stated in the standard's vocabulary.

Use PROV as the conceptual model and the field names. An RDF store is not required [J].

### 6.2 ELI, the European Legislation Identifier [V/S]
ELI is a URI template plus metadata ontology for legislation, coordinated by the ELI Task Force under the Council's e-Law working party. **Austria** has implemented it in four RIS applications, including federal and Länder law gazettes and consolidated federal law, under `ris.bka.gv.at/eli/...` [V: EUR-Lex ELI register, Austria page]. **Switzerland** publishes ELI on **Fedlex** [V: EUR-Lex testimonial]. **Germany** is listed as implementing. The electronic Bundesgesetzblatt (since 2023, recht.bund.de) and the federal legal information portal use ELI-style identifiers, but I did not verify the URI structure in this pass [S]. **[J]** ELI is the right identifier for the *statute* half of "Normen vs. Gesetze": an item for a law, an ordinance or a Land building code points to its ELI work, expression (language, version date) and manifestation. That is exactly the edition/validity/language axis the foundation needs. Technical standards (ÖNORM, DIN, SN/SIA, EN, ISO) have no ELI. They need the standards body's identifier plus edition date. Use the same item primitive with a different `identifier_scheme`, never a second model.

### 6.3 C2PA content credentials [V]
Specification **2.2** (2025-05-01) and **2.3** (2026-01-05). A manifest carries assertions (including "created by AI" actions and ingredients) with a *hard binding* (cryptographic hash) and zero or more *soft bindings* (watermark or fingerprint, from a registered algorithm list) so the manifest can be recovered after metadata is stripped. Its scope is images, video, audio and documents. Plain-text support is limited [V: C2PA spec 2.3; softbinding repo]. **[J]** It serves the AI Act Art. 50(2) marking for the agent's *file* outputs: generated PDFs, rendered plans and images. For chat text, the reasonable path is the Code of Practice measures (metadata and disclosure). For the legal provenance of an answer (which source, which edition), C2PA's "ingredients" could reference the PROV chain. C2PA should be an output format of provenance, not its store.

---

## 7. Implications for the foundation (tickets 30, 31, 32)

These are design inputs, not the design [J throughout].

**7.1 Primitives this research requires**
1. **`Region`** (data, versioned like other configuration): jurisdictions spanned (ISO 3166 codes, not a label like "EU"), infrastructure provider and location, sovereignty profile (SEAL-style dimensions; C5/C3A inherited from which layer), allowed processor set (LLM endpoints with data-policy flags, search, geocoders, connectors), and which data classes it accepts.
2. **`Organization`**: `home_country`, `residency_region`, `enabled_countries`, as three separate fields.
3. **Data class tag** on every store and every outbound call, enforced in code at the one egress point. The repo already has a single provider limiter for model calls (ADR-0081); egress policy belongs on that same path.
4. **Sub-processor record** per vendor: jurisdiction, operator, transfer mechanism (adequacy/DPF/SCC), ZDR and training flags, the data classes it receives, and evidence links. This generates the customer-facing sub-processor list and fails CI when a new outbound host appears without a record (the "agents can act in every tool" checklist gets a residency line).
5. **Processing-location evidence** per call in Langfuse metadata, with a score that fails on violation.
6. **Export/relocate operation**: one implementation for Data Act switching, region relocation and DPF fallback.
7. **Project sensitivity class**: normal / restricted (EU-only model path, no third-party connectors without confirmation) / classified (no model processing, no connectors; e.g. VS-NfD). It is a fact the setup agent can propose from base knowledge ("this is a federal building, RBBau Geheimschutz may apply") and a person sets.

**7.2 Ticket 31 (project setup), line by line, where residency touches it**
- *Verified address → jurisdiction chain:* the geocoder and address-register lookups are connectors with declared data flow (section 5). The jurisdiction chain itself (country, state, municipality, authority) comes from global platform reference data, with no egress. The address the user enters is tenant content once attached to the project.
- *Captured dates → Stichtag:* no external flow. The rule from transitional provisions is a platform base-knowledge item (with an ELI reference for the statute).
- *Decisive facts per region and documents to request:* platform base knowledge, global. The answers are tenant content.
- *Public location sources (zoning GIS, local rules, subsidies):* connectors called from the residency region. Responses are cached as public reference data only if they hold no tenant link; once a response is attached to a project with its source and retrieval time, it is tenant content with provenance.
- *Classification existing vs after works:* model work on tenant content, so a regional model path.
- *Steckbrief listing applicable Grundlagen with edition:* references to base-knowledge item editions (PROV `used`, with ELI or standards-body identifier). A licensed norm the office holds appears with full text only for that office.
- *Derived values confirmed before they count as secured:* a PROV confirmation Activity by a person. That is also the AI Act Art. 50 and liability story, because a human took editorial responsibility.

**7.3 Ticket 32 (office base knowledge)**
- Office items are tenant content and therefore regional. The platform layer is global and replicated read-only, so resolution of the two layers happens locally in the region with no cross-region read.
- Licensed text (ÖNORM, DIN, SIA) from an office may go only to ZDR/no-training model endpoints and must never enter a shared cache, a shared embedding index or a global eval set. Visibility = owner organization. Per-office Qdrant collections or a tenant filter enforced in the storage layer, never in a prompt.
- Authority directives apply only for the project's authority. This is an applicability fact, not a residency fact, but it lives in the same item.

**7.4 Per-country data for this area** (authored and versioned like other items): data protection regime and authority; the transfer adequacy list as the country sees it (CH differs from EU); the architect's confidentiality source and what it allows; public-sector cloud expectations (C5/C3A in DE, privatim in CH); classification regimes (VS-NfD/RBBau in DE); NIS2 status; AI-specific rules (AI Act in EU/EEA, Swiss sectoral approach, UK).

**7.5 Order of work for DACH:** (1) close the audit's Critical finding with EU-pinned model routing, ZDR and processing-location evidence; (2) data class tags and the sub-processor record, enforced at egress in CI; (3) the organization's three attributes and the `Region` record, with one EU region populated; (4) connector descriptors with data-flow fields for ticket 31's sources, and address verification moved to official registers server-side; (5) partition-key discipline and the export/relocate operation; (6) a Zurich cell when the first Swiss customer needs it, plus a sovereign tier (EU-sovereign infrastructure, EU-only models, no US sub-processors for content) for public-sector work.

---

## 8. Open questions to verify before they reach copy or contracts

Current text of § 14 ZTG 2019 (RIS shows a 2025-08-31 date on one provision); whether any Land chamber law sanctions architects' confidentiality criminally, and that § 203 StGB does not cover them; the SIA 102 confidentiality clause; the C-703/25 P docket; FISA § 702 after April 2026; the Omnibus regulation number and Art. 50(2) grace date on EUR-Lex; which Claude models are served in Bedrock `eu.`, Vertex EU, AWS ESC and OpenRouter's EU endpoints; WorkOS DPA and hosting region; Tavily API retention after Nebius; komoot Photon API terms; NIS2 size-cap applicability to the agent.

---

## Sources

**EU and transfers**
- WilmerHale, "European Court of Justice to Review Challenge to EU-U.S. Data Privacy Framework", 2025-12-01: https://www.wilmerhale.com/en/insights/blogs/wilmerhale-privacy-and-cybersecurity-law/20251201-european-court-of-justice-to-review-challenge-to-eu-us-data-privacy-framework
- Captain Compliance, Latombe pleas in OJ: https://captaincompliance.com/education/latombe-pleas-in-eu-us-data-privacy-framework-appeal-published-in-eu-official-journal/
- Digital Policy Alert, Latombe appeal: https://digitalpolicyalert.org/event/35459-latombe-filed-appeal-against-general-court-dismissal-of-challenge-to-european-unionunited-states-data-protection-framework-adequacy-decision-in-latombe-v-commission
- HLC, General Court upholds DPF (2025-09): https://hlc.com/en/publications/transatlantic-data-transfers-eu-general-court-upholds-dat-privacy-framework
- Streamlex DPF tracker: https://streamlex.eu/resources/dpf-developments-tracker/
- EDPB, final Recommendations 01/2020 (2021-06): https://www.edpb.europa.eu/news/news/2021/edpb-adopts-final-version-recommendations-supplementary-measures-letter-eu_en
- CMS, EDPB Opinion 28/2024 key takeaways (2024-12): https://cms.law/en/int/legal-updates/edpb-opinion-28-2024-key-takeaways-on-processing-personal-data-in-the-context-of-ai-models
- Hunton, Commission renews UK adequacy (2025-12): https://www.hunton.com/privacy-and-cybersecurity-law-blog/european-commission-renews-uk-data-adequacy-decisions
- eucrim, UK adequacy renewal: https://eucrim.eu/news/commission-renewed-adequacy-decisions-for-data-transfers-to-the-uk/
- Alston & Bird, Data Act switching (2025-09): https://www.alston.com/en/insights/publications/2025/09/eu-data-act-switching-requirements-cloud-services
- McCann FitzGerald, Data Act developments 2026: https://www.mccannfitzgerald.com/knowledge/data-privacy-and-cyber-risk/data-act-developments-2026-and-beyond
- Bundesnetzagentur, Data Act glossary "switching charge": https://www.bundesnetzagentur.de/SharedDocs/A_Z_Glossar_DataAct_ENG/S/switching-charge.html
- Stephenson Harwood, Data Act switching and unauthorised access: https://www.stephensonharwood.com/insights/the-eu-data-act-switching-interoperability-and-prevention-of-unauthorised-access-to-non-personal-data/

**AI Act**
- SRD Rechtsanwälte, Digital Omnibus AI: https://www.srd-rechtsanwaelte.de/en/blog/digital-omnibus-ai-what-is-changing-in-the-ai-act
- compliancehub, Art. 50 and Omnibus (2026): https://compliancehub.wiki/eu-ai-act-article-50-transparency-digital-omnibus-2026/
- Holistic AI, deadline moved to 2027: https://www.holisticai.com/blog/eu-ai-acts-deadline-moved-2027
- Secure Privacy, Omnibus after Council approval: https://secureprivacy.ai/blog/eu-ai-act-digital-omnibus-the-new-high-risk-ai-deadlines-after-council-approval
- Jones Day, final Code of Practice on marking and labelling (2026-06): https://www.jonesday.com/en/insights/2026/06/european-commission-publishes-final-code-of-practice-on-marking-and-labelling-aigenerated-content
- European Commission, Code of Practice publication: https://digital-strategy.ec.europa.eu/en/news/commission-publishes-code-practice-marking-and-labelling-ai-generated-content

**Switzerland**
- FDPIC, cross-border transfer: https://www.edoeb.admin.ch/en/cross-border-transfer-of-personal-data
- Lenz & Staehelin, Swiss-US DPF (2024-08): https://lenzstaehelin.com/news-and-insights/browse-thought-leadership-insights/insights-detail/swiss-us-data-privacy-framework-swiss-adequacy-decision-for-us-certified-data-recipients
- privatim resolution 2025-11-18 (PDF mirror): https://steigerlegal.ch/wp-content/uploads/2025/11/20251118_privatim_resolution-internationale-cloud-dienste.pdf
- heise, Swiss DPOs on cloud (2025-11): https://www.heise.de/en/news/Switzerland-Data-Protection-Officers-Impose-Broad-Cloud-Ban-for-Authorities-11093477.html
- datenrecht.ch on the privatim resolution: https://datenrecht.ch/en/privatim-resolution-zur-auslagerung-von-datenbearbeitungen-in-die-cloud/
- The Register (2025-12-01): https://www.theregister.com/2025/12/01/infosec_news_in_brief/
- BAKOM, AI: https://www.bakom.admin.ch/en/artificial-intelligence
- KMU portal, consultation draft by early 2027 (2026-09-23): https://www.kmu.admin.ch/en/a-consultation-draft-to-regulate-ai-will-be-drawn-up-by-early-2027

**Austria**
- Schönherr, NISG 2026: https://www.schoenherr.eu/media/lsqb1bnl/nisg-2026-en.pdf
- Lex Mundi, NIS2 Austria: https://www.lexmundi.com/guides/status-of-the-nis2-implementation-act-in-the-european-union/jurisdictions/europe/austria/
- Kammer der ZiviltechnikerInnen, Standesregeln/Berufskodex 2024-01-01: https://www.arching.at/fileadmin/user_upload/redakteure/Normen/236_VO_Standesregeln_Berufskodex-der-ZT_2024-01-01.pdf
- jusline, ZTG 2019: https://www.jusline.at/gesetz/ztg_2019

**Germany**
- digitalpolicyalert, BSI adopts C5:2026: https://digitalpolicyalert.org/event/39466-federal-office-for-information-security-adopted-cloud-computing-compliance-criteria-catalogue-c52026
- heise, BSI C5 requires more: https://heise.de/-11247658
- KPMG, BSI C3A: https://kpmg.com/de/en/insights/digital-transformation/cloud-transformation/bsi-c3a-cloud-sovereignty-measurable-for-the-first-time.html
- vergabeblog, C3A (2026-04-30): https://vergabeblog.de/2026-04-30/bsi-veroeffentlicht-c3a-neuer-massstab-fuer-digitale-souveraenitaet-in-der-cloud-beschaffung/
- cloudmagazin, Deutschland-Stack federal AI cloud (2026-05-21): https://www.cloudmagazin.com/en/2026/05/21/germany-stack-federal-ki-cloud-sovereign/
- cloudmagazin, German hyperscaler (2026-07-02): https://www.cloudmagazin.com/en/2026/07/02/german-hyperscaler-who-really-has-substance/
- usd.de, NIS2UmsuCG in force 2025-12-06: https://www.usd.de/nis2umsucg-offiziell-in-kraft/
- pv magazine, BSI NIS2 portal (2026-01-06): https://www.pv-magazine.de/2026/01/06/bsi-schaltet-portal-fuer-nis-2-registrierung-frei/
- CMS, § 203 StGB outsourcing: https://cms.law/de/deu/legal-updates/update-203-stgb-rechtssicherheit-fuer-outsourcing-bei-berufsgeheimnistraegern
- Bavarian RBBau document (Geheimschutz in Bauunterlagen): https://mobilitaet.bayern.de/assets/stmi/buw/bauthemen/vergabeundvertragswesen/vhf/vi-7-0_risbau_1011a_bearb.pdf
- Grant Thornton, VS-NfD Merkblatt (2025): https://www.grantthornton.de/themen/2025/umsetzung-vs-nfd-merkblatt-verschlusssachen-sicher-digital-verarbeiten/
- Gaia-X: https://gaia-x.eu/gaia-x-welcomes-the-eu-cloud-and-ai-development-act-and-calls-for-a-practical-trusted-path-to-european-digital-sovereignty/ ; Forrester: https://www.forrester.com/blogs/gaia-x-is-back-but-only-adoption-will-signal-success

**Sovereignty and cloud**
- Commission Cloud Sovereignty Framework v1.2.1 (mirror, 2025-11): https://ppc.land/content/files/2025/11/Cloud-Sovereignty-Framework.pdf
- Proliance, SEAL framework: https://www.proliance.ai/en/blog/eu-seal-framework-how-sovereign-is-your-cloud-service
- Amazon, AWS European Sovereign Cloud launch (2026-01-15): https://press.aboutamazon.com/aws/2026/1/aws-launches-aws-european-sovereign-cloud-and-announces-expansion-across-europe
- InfoQ, AWS ESC (2026-01): https://www.infoq.com/news/2026/01/aws-european-sovereign-cloud

**US**
- Cornell, DOJ bulk data rule: https://researchservices.cornell.edu/policies/department-justice-doj-bulk-data-rule
- Foley Hoag, DSP in effect (2025-06): https://foleyhoag.com/news-and-insights/blogs/security-privacy-and-the-law/2025/june/doj-s-bulk-sensitive-data-rule%E2%80%9D-is-in-effect-and-may-require-significant-compliance-obligations-as

**Engineering patterns and vendors**
- AWS, Reducing the Scope of Impact with Cell-Based Architecture (2023-09-20): https://docs.aws.amazon.com/wellarchitected/latest/reducing-scope-of-impact-with-cell-based-architecture/reducing-scope-of-impact-with-cell-based-architecture.html
- Atlassian, Understand data residency: https://support.atlassian.com/security-and-access-policies/docs/understand-data-residency-and-realms/
- Slack, Data residency: https://slack.com/help/articles/360035633934
- Notion, Data residency: https://www.notion.com/help/data-residency
- GitHub, About GHE.com with data residency: https://docs.github.com/en/enterprise-cloud@latest/admin/data-residency/about-github-enterprise-cloud-with-data-residency
- Datadog, Getting started with sites: https://docs.datadoghq.com/getting_started/site
- PostHog, Introducing PostHog Cloud EU: https://posthog.com/blog/posthog-cloud-eu ; subprocessors: https://posthog.com/subprocessors
- Langfuse, Data regions: https://langfuse.com/security/data-regions
- Hatchet, Region availability: https://docs.hatchet.run/v1/region-availability
- Qdrant Hybrid Cloud: https://qdrant.tech/documentation/hybrid-cloud/platform-deployment-options
- WorkOS, data residency pattern blog: https://workos.com/blog/data-residency-for-enterprise-saas ; Vault BYOK: https://workos.com/docs/vault/byok ; security: https://workos.com/security
- Auth Omnibus, data residency comparison: https://authomnibus.com/provisioning/data-residency/
- Tavily privacy (2025-11-24): https://www.tavily.com/privacy ; Business Wire, Nebius to acquire Tavily (2026-02-10): https://www.businesswire.com/news/home/20260210002813/en/
- Bending Spoons acquires komoot (2025-03): https://www.silicon.co.uk/press-release/bending-spoons-acquires-komoot
- photon R package docs (public API terms quoted): https://rdrr.io/cran/photon/src/R/photon-package.R

**LLM regional processing**
- Anthropic, Data residency: https://platform.claude.com/docs/en/manage-claude/data-residency
- Anthropic, Regional compliance: https://claude.com/regional-compliance
- AWS ML blog, single-Region Claude Code on Bedrock (2026-08): https://aws.amazon.com/blogs/machine-learning/enforcing-data-residency-with-single-region-claude-code-on-amazon-bedrock
- Google Cloud, Vertex AI data residency: https://cloud.google.com/vertex-ai/generative-ai/docs/learn/data-residency ; multi-region endpoints for Claude: https://cloud.google.com/blog/products/ai-machine-learning/multi-region-endpoints-for-claude-available-on-vertex-ai
- Microsoft Learn, Azure OpenAI deployment types: https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/deployment-types
- OpenRouter, Sovereign AI: https://openrouter.ai/docs/guides/features/sovereign-ai ; in-region routing: https://openrouter.ai/blog/announcements/us-in-region-routing ; privacy and logging: https://openrouter.ai/docs/features/privacy-and-logging

**Provenance**
- C2PA Specification 2.3 (2026-01-05): https://spec.c2pa.org/specifications/specifications/2.3/specs/_attachments/C2PA_Specification.pdf ; soft-binding list: https://github.com/c2pa-org/softbinding-algorithm-list
- EUR-Lex ELI register, Austria: https://eur-lex.europa.eu/eli-register/austria.html ; implementing countries: https://www.eur-lex.europa.eu/eli-register/implementing_countries.html
- W3C PROV-DM (2013-04-30): https://www.w3.org/TR/prov-dm/
