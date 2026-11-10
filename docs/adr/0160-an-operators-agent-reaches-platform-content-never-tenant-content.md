---
status: proposed
date: 2026-11-06
decision-makers: product owner (Matthias), Grid engineering
consulted: Grid engineering
informed: everyone working in this repo
---

# An operator's agent reaches the platform's own content, never what offices wrote

Amends ADR-0126 (the platform door) and ADR-0154 (the platform MCP gateway).

## Context and Problem Statement

Countries will be onboarded by an operator's own agent, Claude or any MCP client,
through the platform door (design `docs/design/international/design.md`, sections
4.3 and 4.5; the design lives on branch `claude/intl-design`, PR #1534, and is
not on `develop` yet). The product contains no onboarding
agent of its own. The operator's agent vendor is a processor for the platform's
operations, not for any office's content (design 6.1, "Platform door:
`platform_public` only").

On 2026-11-06 two paths gave that agent what offices wrote:

1. **The platform door** (`/api/platform/mcp`, ADR-0126) offered the whole
   `platform` domain: cross-office conversation search and timelines
   (`platform-profiler-*`), product feedback with reporters' names and emails
   (`platform-feedback-*`), ratings with their comments
   (`platform-answer-feedback-*`), lessons distilled from down-voted turns
   (`platform-lesson-*`), flagged turns (`platform-citation-health-export`),
   project names (`platform-quality-scope-options`) and each office's spend per
   named person (`platform-org-usage-get`).
2. **The platform MCP gateway's** `/langfuse/mcp` route (ADR-0154) handed the
   agent every tool of Langfuse 4.74.0's MCP server under the project key,
   including `listObservations` and `getObservation`. Traces carry every turn's
   question and answer.

WorkOS does not enforce custom scopes, so a token cannot be narrowed. One
onboarding session could have carried every office's conversations to the
operator's agent vendor.

## Decision Drivers

* Enforced by the server, never by the client's goodwill or a prompt.
* Platform staff keep what they have in the console in the browser.
* The platform knowledge operations later work adds are reachable by the agent
  without further plumbing.
* One rule, one place, a test that fails when the rule is broken.
* The gateway's own product does the gateway's part (buy, don't build).

## Considered Options

* **Classify every console operation; tenant content is on no door.** One door.
* **A second, knowledge-only door** (`/api/platform/knowledge/mcp`) with its own
  audience, beside the existing platform door.
* **A tool allowlist per OAuth client** (`via_client`) on the platform door.

## Decision Outcome

Chosen option: "classify every console operation; tenant content is on no door".

Every caller of the platform door is an outside agent: `principal.ts` refuses
the in-product agent's credential there, and the console in the browser calls its routes with
the cookie session, never through the door. So "withheld from any external agent
client" and "off the platform door" are the same set, and the existing exposure
rule (`isExposedTo`, read by every listing, search, describe and call) already
enforces it server-side. Nothing new has to be built on the request path.

* **The classification.** `apps/workspace/bff/agent-api/exposure/platform.ts`
  gives each console operation either `PLATFORM_PUBLIC` (on the platform door)
  or `tenantContent(reason)`. Tenant content is what offices or their people
  wrote or are, read across offices, and also any write that changes offices'
  own state: the kill switch stops every office's running turns, and the vector
  reconcile deletes chunks from offices' collections. An onboarding agent has no
  business with either, and staff run both from the console. A tenant-content
  entry is `withheld` under the new category `tenant-content`, so it is on no
  door at all, for every audience. The entry's type admits nothing else: its
  category is the literal `tenant-content`. 20 operations are tenant content and
  35 are platform-public. Organization names (`platform-overview-get`) stay
  platform-public: they are the customer's account record, needed to address an
  organization, not something written in the workspace.
* **The gateway.** Each server in `mcpServers` (`deploy/pulumi/src/platform/mcp-gateway.ts`)
  declares `tools`. `"all"` is for a server that holds only the platform's own
  content (the website CMS). A list is for a server that also holds tenant
  content, and becomes agentgateway's `mcpAuthorization` with one `allow` rule.
  agentgateway v1.7.0 then leaves every other tool out of `tools/list`, refuses
  it on `tools/call`, and refuses the server's prompts and resources. Langfuse
  keeps its configuration tools: prompts and evaluators with their rules to
  read, and skills, models and score configs to read and write, plus health.
  Prompts and evaluators are read-only because a write there moves offices'
  content without reading it: a prompt under the `production` label steers
  every office's turns within a minute, and an evaluator rule runs over every
  trace (a `CODE` evaluator with code the agent wrote, in a sandbox whose
  network we have not checked). Both still change through the repo's reviewed,
  ask-first tasks (`task prompts:push -- --apply`,
  `task langfuse:provision -- --apply`) or in Langfuse's UI. A tool a later
  Langfuse adds stays refused until it is named.
* **Staff.** The console's pages and routes are unchanged: the route's
  `platform:*` permission decides, under the audited platform bypass
  (`withPlatformAccess`, ADR-0041), as before. Langfuse's own UI stays behind
  its OIDC gate.
* **No flag.** The build split reserved `knowledgeDoor` for a change that
  could lock staff out. Nothing here does: staff lose no surface they had in the
  browser. Withdrawing tenant content from agents is the safety fix itself, and
  a default-off flag would leave the leak open by default.

### Consequences

* Good, because the line is drawn where the agent meets the product: one table
  for the door, one field per gateway server, and both default to refusing.
* Good, because a platform knowledge operation added later as `PLATFORM_PUBLIC`
  is on the door with no further work.
* Bad, because a platform operator who triaged feedback or read conversation
  profiles through Claude now does it in the console. That is the intent.
* Bad, because the platform door still offers writes of the same class as a
  production prompt: `platform-skill-create` and `-update` publish instructions
  every office's agent reads. They are platform-public data, and an operator
  needs them; whether publishing one needs the person's yes on the server
  (`personDecides`, design 4.4) is left to the agent-grade door's work.
* Bad, because the Langfuse allowlist is a list of another product's tool names,
  read from its source at 4.74.0. A rename on upgrade removes a tool from the
  agent (fail closed), never adds one.
* Neutral: `platform-citation-health-get` would help onboarding (its
  missing-source candidates name sources answers failed to cite), but those
  candidates can name an office's own documents. A platform-public rollup that
  keeps only public-source targets is a separate operation, if wanted.
* Bad, because lessons are tenant content on the door, yet their text reaches
  every office's turn another way. `buildPlatformLessonsInjection`
  (`bff/platform-lessons/service.ts`) puts every active lesson into every turn,
  and a lesson goes active as soon as a model auditor passes it; only a flagged
  one waits for a person. That is a cross-office flow outside the doors, named
  here as an open risk for the residency work (design 6.1, "Lessons distiller":
  refuse turns that used office or licensed text, a shingle check), not
  decided by this record.
* Neutral: tenant-content reads in the console are covered by the platform
  bypass's reason, not by one WorkOS audit event per read. Adding that is a
  separate change.

### Confirmation

* `apps/workspace/bff/agent-api/exposure/platform.spec.ts`: every console
  operation is one of the two classes; tenant content is used only there; a
  pinned list of tenant-content operations and a path pattern
  (`/api/platform/{feedback,answer-feedback,lessons,profiler,quality,citation-health,conversations}`)
  stay tenant content; none is on any door or visible to an operator's agent, an
  office's agent or the in-product agent; and through the real MCP server on the platform door,
  none is listed, found by search, described or called, and no route runs.
  As positive controls, a platform-public operation is listed, found by search
  and called (its route runs), and the OpenAPI document describes no
  tenant-content operation to staff.
* `deploy/pulumi/index-mcp-gateway.spec.ts`: the Langfuse route's
  `mcpAuthorization` names exactly `LANGFUSE_PLATFORM_TOOLS`, which holds none of
  Langfuse's trace, score, comment, dataset, queue, media or metrics tools; the
  generated config passes agentgateway v1.7.0's own schema in CI.
* Nothing checks Langfuse's tool names against a running Langfuse. The
  runbook's first-deploy check lists the tools through a signed-in client.

## Pros and Cons of the Options

### A second, knowledge-only door

* Good, because its name says what it is for.
* Bad, because the platform door would still offer tenant content to the same
  outside agents. The leak would only move, unless the old door also lost tenant
  content, which is this decision plus a second audience, resource registration
  in WorkOS and a second runbook.

### A tool allowlist per OAuth client

* Good, because it could keep a trusted client's access to everything.
* Bad, because no client of this door is a processor of tenant content, so the
  list would be the same for every client. It would also rest on `client_id`,
  which any CIMD client chooses itself (its metadata URL).

## More Information

* ADR-0122 and its amendment (the doors and `withheld`), ADR-0126 (the platform
  door), ADR-0154 and its amendment (the gateway, and staff of any sign-in
  organization), ADR-0041 (the platform bypass).
* `docs/architecture/agent-surface.md#the-platform-door-a-second-server`,
  `docs/deployment/platform-mcp-gateway.md`.
