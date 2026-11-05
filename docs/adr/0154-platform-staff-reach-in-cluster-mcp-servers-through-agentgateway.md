---
status: accepted
date: 2026-11-05
decision-makers: product owner (Matthias), Grid engineering
consulted: Grid engineering
informed: everyone working in this repo
---

# Platform staff reach the cluster's MCP servers through one gateway: agentgateway behind Envoy, signed in with WorkOS

## Context and Problem Statement

The cluster runs MCP servers that are for the team, not for offices. Langfuse's
is the first (`/api/public/mcp` on `langfuse-web`), and more are coming. Today a
person reaches one of them in one of two ways. They can port-forward, which no
cloud agent and no CI job can do. Or the server gets a public host, which puts it
on the internet behind whatever authentication it brings itself.

The edge gate we already have does not fit. `platform-oidc.ts` gates Langfuse's
UI and Qdrant's dashboard with Envoy Gateway's OIDC filter: a browser redirect, a
session cookie, and the WorkOS token written into `Authorization`. An MCP client
follows no redirect. It expects the MCP authorization flow (MCP 2025-06-18): a
401 whose `WWW-Authenticate` names protected-resource metadata (RFC 9728), an
OAuth 2.1 flow it runs itself against the authorization server named there, and
a bearer token bound to the server's URL (RFC 8707). Langfuse's MCP endpoint
adds a second conflict: it wants HTTP Basic with a project key in the very
header the gate overwrites.

The platform door (ADR-0126, `/api/platform/mcp`) does not cover this either.
It offers the operator console's own operations. It proxies nothing, and the
office door's rule (ADR-0122, amended) keeps proxying other services out of it.

How does a platform operator's agent reach an in-cluster MCP server without
publishing that server, and without handing each person each server's
credential?

## Decision Drivers

* No in-cluster MCP server gets a public host of its own.
* One sign-in: WorkOS AuthKit, the authorization server the agent doors already use.
* Each server's credential stays in the cluster. A person holds only their own
  WorkOS token, which lasts five minutes.
* The standards: the MCP authorization spec, OAuth 2.1, RFC 8707, RFC 9728,
  and Client ID Metadata Documents for client registration.
* Buy, don't build. A gateway is someone else's product, and it should be one
  that will outlive its first vendor.
* Off until switched on, like every agent door.

## Considered Options

* **agentgateway (Linux Foundation), standalone, as an internal service behind Envoy Gateway.**
* **Agent Router (formerly Envoy AI Gateway), its MCPRoute on our Envoy Gateway.**
* **IBM ContextForge.**
* **A proxy in the BFF**, for example behind the platform door.
* **Network-only access**: Tailscale's Kubernetes operator, or `kubectl port-forward`.
* **An Envoy Gateway SecurityPolicy with JWT only** in front of each server.

## Decision Outcome

Chosen option: "agentgateway, standalone, behind Envoy Gateway". It is the one
option that speaks the MCP authorization flow itself, injects a credential per
server, and adds no second edge. Its governance (a Linux Foundation project with
contributors from AWS, Cisco, IBM, Microsoft and Red Hat) and its activity (857
commits in the three months to 2026-11-05) make it the safest long-term bet of
the candidates.

**The shape.** `platform/mcp-gateway.ts` runs agentgateway v1.7.0 (pinned by
digest) as the `platform-mcp-gateway` Deployment: two replicas and a ClusterIP
Service on 8080, configured from a ConfigMap. Envoy Gateway terminates TLS for
`platform-mcp.<baseDomain>` (the `https-platform-mcp` listener) and routes the
whole host there, ungated. The gate is agentgateway's, because only it answers
with the 401 and the metadata a client needs. The standalone mode, not
agentgateway's own Gateway API control plane: our edge stays one Envoy fleet,
with one load balancer address and one certificate path, and the config is a
file this program writes.

**One server, one resource.** Each in-cluster server is a route at
`/<name>/mcp` (`mcpServers` in `mcp-gateway.ts`): Langfuse at `/langfuse/mcp`.
Each route is its own protected resource, `https://platform-mcp.<baseDomain>/<name>/mcp`,
and accepts only tokens whose `aud` names it. A token for the office doors, the
platform door or another server's route is refused with 401. agentgateway can
also combine servers behind one endpoint. We don't use that yet: with one
server it buys nothing, and agentgateway applies one route-level `Host` rewrite
to every target, which the Langfuse route needs for itself.

**Who gets in.** WorkOS issues the token (CIMD or DCR registration, AuthKit's
own endpoints; agentgateway proxies neither). The route requires two things.
The token's `org_id` must be the platform organization's WorkOS id
(`mcpGatewayPlatformOrgId`). Its `roles` claim must hold `org-platform-owner`
(`ADMITTED_ROLES`). WorkOS tokens carry no permissions claim, so the gate cannot
be the console's `platform:*` permission. The role comes from the environment's
JWT template (`docs/deployment/platform-mcp-gateway.md`). A missing claim makes
the rule error, and agentgateway counts that as unmet, so the gate fails closed.
`org-platform-support` is not admitted. It is read-only in the console, but the
credential behind a route need not be: Langfuse's project key writes prompts.

**The credential.** agentgateway validates the caller's token and strips it. It
never reaches the server. In its place the route presents the server's own
credential, read from a file mounted with only that one Secret key (Langfuse:
`otlp-basic-auth` of `langfuse-secrets`, the `Basic …` header the collector
already sends). Langfuse refuses a `Host` it does not know, so its route
rewrites the authority to Langfuse's public host. That is the first choice in
Langfuse's docs, ahead of `LANGFUSE_MCP_ALLOWED_HOSTS`.

**Observability.** agentgateway sends its spans to the collector as service
`platform-mcp-gateway`. They reach Langfuse like every other surface's
(ADR-0089).

### Consequences

* Good, because no MCP server is on the internet, and adding one is an entry in
  `mcpServers` plus, when its pod is withheld from the namespace, one
  NetworkPolicy.
* Good, because one WorkOS sign-in reaches every server. Each server's
  credential stays in a Secret the person never sees.
* Good, because the protocol work is agentgateway's. The specs hold the file we
  generate against its published JSON schema at the pinned version, so a key it
  does not know fails CI and never reaches a pod.
* Bad, because the gate is a claim check, not the live membership lookup the
  platform door makes (`resolvePinnedRequesterSession`). A person removed from
  the platform organization keeps a working access token until it expires, which
  is five minutes on AuthKit's default.
* Bad, because the `roles` claim exists only once someone edits the
  environment's JWT template, a dashboard step nothing in this program applies
  or checks. Until then every request gets 403, and nothing more.
* Bad, because a second proxy runs in the request path, and its CVEs are ours.
  The pin is a literal digest, so `ci/pinned_images.py` hands it to trivy.
* Bad, because two things rest on reading agentgateway's source at v1.7.0, not
  on running it: the Host rewrite reaching Langfuse, and agentgateway's own
  `--validate-only` over the file. Both are the first-deploy checks in the
  runbook.
* Neutral: Compose gets no gateway. It has no WorkOS edge to sign in through,
  and a developer reaches a local Langfuse's MCP endpoint directly.

### Confirmation

* `deploy/pulumi/index-mcp-gateway.spec.ts`: the listener, the DNS record and
  the route; the generated config against agentgateway v1.7.0's schema
  (`src/test-support/agentgateway-config.v1.7.0.schema.json`); the audience per
  route, the organization and role rule, the credential mount of one key, the
  two NetworkPolicies; nothing at all when the flag is off; `loadMcpGateway`
  refusing a missing dependency, a non-`org_` id and a malformed session key.
* `ci/pinned_images.py`: the image pin is scanned by trivy.
* Nothing enforces the WorkOS dashboard steps (resource indicator, CIMD, JWT
  template). The runbook's checks are by hand.

## Pros and Cons of the Options

### agentgateway, standalone

* Good, because it implements the MCP authorization flow: the 401, the
  RFC 9728 metadata, JWT validation, and CEL rules over the claims.
* Good, because it injects a credential per target, and strips the caller's token.
* Good, because a Linux Foundation project with many vendors behind it is less
  likely to stall when one of them loses interest.
* Bad, because it is a second proxy beside Envoy, with its own config dialect.

### Agent Router (formerly Envoy AI Gateway)

* Good, because it runs on the Envoy Gateway we already operate, with the same
  resource family as our SecurityPolicies.
* Bad, because its MCPRoute API changed shape between 0.4 and 0.6
  (`v1alpha1` to `v1beta1`). It also needs a matching Envoy Gateway version, and
  `gateway.ts` tracks the latest `gateway-helm` unpinned. Adopting it means
  pinning both.
* Bad, because it had about a fifth of agentgateway's activity (181 commits in
  the same three months, read 2026-11-05). It moved foundations and changed name
  in September 2026. Re-check both figures if this decision is revisited.

### IBM ContextForge

* Bad, because it is its own application, with a database and an admin UI: a
  registry and federation layer, where we need a proxy with a gate.

### A proxy in the BFF

* Good, because the platform door's principal already makes the live membership
  check this gateway cannot.
* Bad, because it means writing an MCP gateway (session fan-out, SSE, upstream
  auth) inside the product, which is someone else's domain. The door's rule
  (ADR-0122, amended) keeps proxied services off it.

### Network-only access

* Good, because Tailscale's operator publishes nothing, and `port-forward`
  needs no setup at all.
* Bad, because a cloud agent or a CI job is not on the tailnet, and every
  laptop then holds every server's credential, with no WorkOS identity in the
  path.

### An Envoy Gateway SecurityPolicy with JWT only

* Bad, because we found no SecurityPolicy field, as of 2026-11-05, that adds
  `resource_metadata` to the JWT filter's 401 or serves an RFC 9728 document.
  Without them a client cannot discover where to sign in. This premise was not
  checked against Envoy Gateway's source; re-check it before revisiting. The
  option would also still need a header rewrite per server for the upstream
  credential.

## More Information

* Runbook, WorkOS setup and first-deploy checks: [`../deployment/platform-mcp-gateway.md`](../deployment/platform-mcp-gateway.md).
* ADR-0122 and its amendment, ADR-0126: the agent doors, and why they proxy nothing.
* ADR-0044 and ADR-0089: Langfuse, and why every surface traces to it.
* agentgateway: <https://github.com/agentgateway/agentgateway>, docs at <https://agentgateway.dev/docs/standalone/latest/>.
