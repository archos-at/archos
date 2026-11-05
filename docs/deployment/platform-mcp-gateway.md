# The platform MCP gateway (ADR-0154)

One public host, `platform-mcp.<baseDomain>`, where platform staff's agents
(Claude Code, Cursor, MCP Inspector) reach the MCP servers that run inside the
cluster. The servers stay private. A person signs in with WorkOS, and the
gateway presents each server's own credential, which never leaves the cluster.

| Path | Server | Credential the gateway presents |
|---|---|---|
| `/langfuse/mcp` | Langfuse (`langfuse-web:3000/api/public/mcp`) | the project key's `Basic …` header (`otlp-basic-auth` in `langfuse-secrets`) |
| `/cms/mcp` | The website's CMS (`cms.cms.svc:3000/api/mcp`), where `cmsEnabled` | the MCP key of the CMS's agent account, `Bearer …` (`authorization` in `cms-platform-mcp`); every write is a draft |

The gateway is [agentgateway](https://github.com/agentgateway/agentgateway)
v1.7.0, standalone, behind Envoy Gateway. Code:
`deploy/pulumi/src/platform/mcp-gateway.ts` (the resources) and
`mcp-gateway-config.ts` (the file agentgateway reads).

```text
MCP client ──OAuth 2.1 (WorkOS AuthKit)──▶ platform-mcp.<baseDomain>   Envoy: TLS only
                                             │
                                             ▼
                                  platform-mcp-gateway:8080   agentgateway
                                   • 401 + RFC 9728 metadata, per route
                                   • iss, aud = this route's URL, org_id, roles
                                   • strips the caller's token, adds the server's
                                             │
                                             ▼
                                  langfuse-web:3000/api/public/mcp   (ClusterIP)
```

## Who gets in

A token passes when all of these hold. Anything else gets 401, or 403 for a
valid token from the wrong organization or role.

- WorkOS AuthKit issued it (`iss` is `https://<workosAuthkitDomain>`).
- Its `aud` is the route's own URL, e.g. `https://platform-mcp.<baseDomain>/langfuse/mcp`.
  A token for an office door, the platform door or another route is refused.
- Its `org_id` is the platform organization (`mcpGatewayPlatformOrgId`).
- Its `roles` claim holds `org-platform-owner`. Platform Support is not
  admitted: the Langfuse project key behind `/langfuse/mcp` writes prompts
  (`ADMITTED_ROLES` in `mcp-gateway-config.ts`).

The check reads the token's claims, with no live lookup. A person removed from
the platform organization keeps working until their access token expires, which
is five minutes on AuthKit's default.

## Turning it on

### 1. WorkOS, once per environment

Nothing here is applied by the deploy.

1. **MCP auth, CIMD and DCR** are on already if the agent doors work
   ([`agent-surface.md`](../architecture/agent-surface.md#workos-dashboard-setup), steps 1–3).
2. **Register the resource indicator**: `https://platform-mcp.<baseDomain>/*`.
   A path wildcard covers every route the gateway serves now or later. A
   wildcard cannot be the default indicator, so leave the default as it is.
3. **Add the `roles` claim to the JWT template** (Authentication → Sessions →
   JWT template), merged into whatever the template already holds:

   ```json
   { "roles": {{ organization_membership.roles }} }
   ```

   Without it every request is refused with 403 and nothing more. Check what
   the template produces before relying on it (step 4 of
   [the first-deploy checks](#first-deploy-checks)).
4. **Look up the platform organization's WorkOS id** (`org_…`, under Organizations,
   the platform organization's page). That is the WorkOS id, not `platformOrgExternalId`.

### 2. The stack

```bash
pulumi config set          mcpGatewayEnabled       true
pulumi config set          mcpGatewayPlatformOrgId org_...
```

The session key needs nothing: it defaults to a one-way HMAC of `pgAppPassword`,
like the CMS's credentials. `mcpGatewaySessionKey` (64 hex characters,
`openssl rand -hex 32`, in ESC on staging and prod) replaces it. The gateway also
needs `workosAuthkitDomain` (set wherever the agent doors work) and an MCP server
to serve: Langfuse or the CMS. A stack missing either fails the plan with the key
to set.

Staging runs it since 2026-11-05, and production has it switched on in
`Pulumi.prod.yaml` from the same day, live with the next promotion. In both
WorkOS environments the resource indicators for `/langfuse/mcp` and `/cms/mcp`
are registered one by one, for the `piloti.at` and the `archos.tech` hosts,
rather than as a wildcard, so a new route needs its own.

`mcpGatewayDomain` overrides the host. It must stay under the resource indicator
from step 2.

With `dnsEnabled` the record is written for you. Otherwise point
`platform-mcp.<baseDomain>` at the Envoy Gateway address by hand, as for the
other hosts.

### 3. Connect a client

```bash
claude mcp add --transport http langfuse https://platform-mcp.<baseDomain>/langfuse/mcp
```

The client opens the AuthKit sign-in. Choose the platform organization.
Signed in to an office organization, the gateway answers 403.

## First-deploy checks

These are the parts nobody has run yet: agentgateway's own validation of the
file, and two behaviours read from its source at v1.7.0.

1. **The file loads.** `kubectl -n <ns> logs deploy/platform-mcp-gateway` shows
   no config error, and the pods are ready (readiness waits for AuthKit's JWKS).
   The specs hold the file against agentgateway's JSON schema; this is the
   binary's own check.
2. **The challenge names the metadata.**

   ```bash
   curl -si -X POST https://platform-mcp.<baseDomain>/langfuse/mcp | grep -i www-authenticate
   curl -s https://platform-mcp.<baseDomain>/.well-known/oauth-protected-resource/langfuse/mcp
   ```

   The first must name `resource_metadata="https://platform-mcp.<baseDomain>/.well-known/oauth-protected-resource/langfuse/mcp"`.
   The second must give `resource` as the route URL and `authorization_servers`
   as the AuthKit issuer.
3. **Langfuse answers, not 403.** List the tools through a signed-in client (or
   MCP Inspector). A 403 from Langfuse itself means the `Host` rewrite did not
   reach it. Then set `LANGFUSE_MCP_ALLOWED_HOSTS=langfuse-web` on
   `langfuse-web` instead, and record which one held here and in ADR-0154.
4. **The token carries the role.** Decode a gateway token (the client's, or one
   from MCP Inspector) and check that `roles` is a list of slugs that includes
   `org-platform-owner`, and that `aud` is the route URL. A list of objects
   instead of slugs means the rule in `admissionRule` must change.

## Adding a server

1. An entry in `mcpServers` (`mcp-gateway.ts`): `name` (the path segment;
   lowercase, no `_`), its in-cluster URL, the credential's Secret and key if
   it needs one, and `authority` if it checks the `Host`.
2. If its pod is withheld from the namespace-wide allow (rule 2 of
   `network-policies.ts`), a rule naming the gateway as its caller, as rule 23
   does for Langfuse.
3. A case in `index-mcp-gateway.spec.ts`.
4. A row in the table at the top of this page.

On a stack whose resource indicator is a wildcard it already covers the new
route; staging lists each route, so register the new one there.

## Operating it

- **Rotate the session key**: set a new `mcpGatewaySessionKey` and deploy. The
  pods roll, and open MCP sessions end: clients reconnect on their own.
- **Logs**: JSON on stdout. **Traces**: Langfuse, service `platform-mcp-gateway`,
  for signed-in requests only (anonymous 401s and scanners are not traced).
- **Edge budget**: 300 requests a minute per client address
  (`RATE_PER_MINUTE`, in shadow mode while `rateLimitShadowMode` is on).
  **Metrics**: `:15020/stats/prometheus` on each pod (not scraped yet).
- **Upgrade**: move the digest in `MCP_GATEWAY.image`, and move
  `AGENTGATEWAY_VERSION` and `AGENTGATEWAY_SCHEMA_SHA256` in CI's infra job
  (`.github/workflows/ci.yml`) to the same tag. CI then holds the rendered file
  against that version's published schema, which is what tells you a key moved.
- **Off**: `mcpGatewayEnabled=false` removes the listener, record, route,
  Deployment and NetworkPolicies. Port-forward to Langfuse's MCP endpoint
  meanwhile.
