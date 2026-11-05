# Domain cutover: moving every public host to the domain in `identity.json`

**Status: dev switching, prod prepared** (owner decision D2, 2026-10-29: prepare, don't flip;
2026-11-05: switch dev). The new zone is in the same Cloudflare account as the former one. The
dev stack's switch is committed in `Pulumi.dev.yaml` with the new zone's id, and dev's new
account-owned token is in ESC, checked against both zones. Staging's WorkOS entries are added. Prod
is unchanged: its configuration below is ready to apply. The owner triggers it; every step that
changes a live system is marked **one-way door** or **live** and needs the owner.

The product's name and domain are copy and live in one place:
`packages/brand/identity.json` (`"domain"`). The website already reads it (canonical URLs,
sitemap, JSON-LD, the signatures). What still runs on the former domain is infrastructure:
the stack's `baseDomain`, the Cloudflare zone, and the third-party services that keep an
allowlist of our URLs. This runbook moves those, keeps every former URL answering with a
301 to its new twin, and says how to go back.

## Names used below

Run from the repository root. The two values are read, never typed, so this page holds no
domain of its own:

```bash
NEW=$(jq -r .domain packages/brand/identity.json)                                  # the new domain
base() { yq -r '.config | to_entries[] | select(.key | test(":baseDomain$")) | .value' "deploy/pulumi/Pulumi.$1.yaml"; }
OLD=$(base prod)                                                                   # the domain prod serves today
OLD_DEV=$(base dev)                                                                # dev.$OLD today
NEW_DEV="dev.$NEW"
```

| Host | Prod today | Prod after | Dev after | After the move, the former host |
|---|---|---|---|---|
| Website (apex) | `$OLD` | `$NEW` | `$NEW_DEV` | 301 to the new host, same path (gateway) |
| `www.` | `www.$OLD` | `www.$NEW` | — | 301 to the apex (Cloudflare, `dnsZoneBaseline`), then the line above |
| App | `app.$OLD` | `app.$NEW` | `app.$NEW_DEV` | 301 to the new host, same path (gateway) |
| S3 (presigned URLs) | `s3.$OLD` | `s3.$NEW` | `s3.$NEW_DEV` | none: URLs are signed per request and expire |
| `otel.`, `langfuse.`, `qdrant.` (operators) | `*.$OLD` | `*.$NEW` | `*.$NEW_DEV` | none: operators re-bookmark; their sign-in callbacks are re-registered |

## What is already staged in the code

- **The 301s.** `formerBaseDomain` (unset by default, so nothing changes today) adds
  an HTTPS listener and a certificate per former host to the Gateway and one HTTPRoute each
  with a `RequestRedirect` that changes only the host, status 301
  (`deploy/pulumi/src/app/former-domain.ts`, tested in `former-domain.spec.ts`). Path and
  query carry over. Plain HTTP on the former host is first sent to HTTPS by the existing
  catch-all, then moved.
- **Agents keep their URLs.** The former `app.` host keeps *serving* the agent doors
  (`/api/mcp`, `/api/a2a`, `/api/platform/mcp`) and their RFC 9728 documents instead of
  redirecting them, and the platform MCP gateway keeps `platform-mcp.$OLD` as a second host. See
  [Connected agents](#connected-agents-keep-working) below.
- **The former hosts' DNS.** With `formerBaseDomain` set, the former apex and `app.` host (and
  `platform-mcp.` where the gateway runs) keep their A records at the Gateway, under the same Pulumi resource names they had as the stack's
  own hosts, so the move neither deletes nor re-creates them (`deploy/pulumi/src/platform/dns.ts`).
  When the former domain is another Cloudflare zone, `formerDnsZoneName` and `formerDnsZoneId`
  name it, and the one `cloudflareApiToken` must edit both zones. The former `s3.`, `otel.`,
  `langfuse.`, `qdrant.` and `cms.` records are deleted by the move, as the table above says.
- **The token check.** `deploy/pulumi/scripts/check-cloudflare-token.sh --stack <stack>` asks the
  Cloudflare API whether the stack's token can see, read and write each zone (by default the
  brand's domain, the zone prod serves, and the stack's own and former zones), and prints each
  zone's id. It needs `pulumi login`, or the token in
  `CLOUDFLARE_API_TOKEN`; the token is Pulumi config, not a cluster Secret.
- **Every derived host.** `app.`, `s3.`, `otel.`, `langfuse.` and `qdrant.` derive from
  `baseDomain`; so do the app's `WORKOS_REDIRECT_URI`, the MCP and A2A resource URLs
  (`apps/workspace/bff/agent-api/mcp-config.ts`), `LANDING_URL` and with it the website's
  signed-in cookie domain (`bff/auth/signed-in-cookie.ts`), the website's `PUBLIC_APP_URL`
  and Langfuse's `NEXTAUTH_URL`. One key moves them.
- **Release notes** may link the new domain (`scripts/release_notes.py`).

## Exact configuration changes

The values to set on switch day, per stack. Keys are written without the project's
namespace, as `pulumi config set <key>` takes them in `deploy/pulumi`. Never touch a `secure:`
value by hand (`deploy/AGENTS.md`); set secrets with `pulumi config set --secret` or ESC.

### Prod (`deploy/pulumi/Pulumi.prod.yaml`)

| Key | Today | Set to |
|---|---|---|
| `baseDomain` | `$OLD` | `$NEW` |
| `formerBaseDomain` | (unset) | `$OLD` |
| `dnsZoneName` | `$OLD` | `$NEW` |
| `dnsZoneId` | the former zone's id | the new zone's id, as dev has it |
| `formerDnsZoneName` | (unset) | `$OLD` |
| `formerDnsZoneId` | (unset) | the former zone's id (today's `dnsZoneId`) |
| `cloudflareApiToken` (ESC) | prod's user token, `piloti.at` only | a new **account-owned** token (Manage Account → API Tokens). Zone Resources `$NEW` and `$OLD`: Zone → DNS → Edit, Zone → Single Redirect → Edit (the `www` rule), Zone → Zone → Read, and for project mail on `$NEW` Zone → Zone Settings → Edit and Zone → Email Routing Rules → Edit; Account Resources the account: Workers Scripts → Edit, Email Routing Addresses → Edit (the mail block's list, `src/platform/inbound-mail.ts`). Prove it with `CLOUDFLARE_API_TOKEN=<token> check-cloudflare-token.sh --stack prod` before setting it |
| `dnsDmarc` | the former domain's policy | **unset.** `_dmarc.$NEW` has one owner, the project-mail block of `Pulumi.prod.yaml` (agreed 2026-11-05 with the mail work, archos-at/archos#1464 and its follow-up), because mail needs it before prod's switch. Two TXT records at `_dmarc` make DMARC fail, and Cloudflare accepts the second without a word. The former value also does not fit: it reports to the former registrar and was written for a domain with no mail, while `$NEW` carries Google Workspace mail. The policy itself (start at `p=none` with `sp=` set) is the owner's mail decision |
| comment on the Qdrant dashboard | `https://qdrant.$OLD/oauth2/callback` | `https://qdrant.$NEW/oauth2/callback` |

`dnsZoneBaseline: "true"` stays on prod: it publishes the new zone's apex, `www` (301 to the
apex at Cloudflare); `_dmarc` belongs to the mail block (row above). The former zone's `www`, `_dmarc` and `www` redirect rule
stay where they are only after step 4 takes them out of the state.

### Dev (`deploy/pulumi/Pulumi.dev.yaml`)

Committed on 2026-11-05. The token was checked against both zones the same day and stored in ESC:

| Key | Was | Now |
|---|---|---|
| `baseDomain` | `$OLD_DEV` | `$NEW_DEV` |
| `formerBaseDomain` | (unset) | `$OLD_DEV` |
| `dnsZoneName` | `$OLD` | `$NEW` (the same zone as prod) |
| `dnsZoneId` | the former zone's id | the new zone's id (`31df51fb…`), printed by `check-cloudflare-token.sh --stack dev` on 2026-11-05 |
| `formerDnsZoneName` / `formerDnsZoneId` | (unset) | `$OLD` and the former zone's id |
| `cloudflareApiToken` | (secure, a user token on `$OLD` only) | removed from the stack file; a new **account-owned**, DNS-only token on `$NEW` and `$OLD` (Zone → DNS → Edit, Zone → Zone → Read) in ESC, `esc env set …/dev pulumiConfig.<project>:cloudflareApiToken` |

## Third-party allowlists (additive, before the switch)

Each list gets the new entries **added** next to the old ones a week before; the old ones
are removed only after the old hosts have redirected for a while. Adding is harmless,
because nothing asks for the new URLs until the switch.

### WorkOS (per environment: Staging for dev, Production for prod)

**Staging: added 2026-11-05** through the WorkOS MCP server, next to the former entries: the
AuthKit redirect URI, the CORS origin and the logout URI `https://$NEW_DEV` on the app's AuthKit
application, the three Connect redirect URIs for `qdrant.` and `langfuse.` (`otel.` is retired),
and the four resource indicators (`/api/mcp`, `/api/a2a`, `/api/platform/mcp`,
`https://platform-mcp.$NEW_DEV/langfuse/mcp`). Left for after dev's deploy, because each is one
value and changing it now would send people to a host that does not answer yet: the AuthKit
application's initiate-login URI (`https://app.$NEW_DEV/api/auth/signin`) and homepage
(`https://app.$NEW_DEV`), and making the new redirect URI, logout URI and `/api/mcp` resource the
defaults. **Production: not yet.**

Reconciled by `apps/workspace` `npm run provision:workos-env` (dry run by default; `--apply`
is a **one-way door**, owner only; `docs/deployment/workos-provisioning.md`):

| What | Add (prod; dev uses `$NEW_DEV`) | How |
|---|---|---|
| AuthKit redirect URI | `https://app.$NEW/api/auth/callback` | `WORKOS_DESIRED_REDIRECT_URIS` |
| CORS origin (widgets) | `https://app.$NEW` | `WORKOS_DESIRED_CORS_ORIGINS` |
| Resource indicators (the agent doors, RFC 8707) | `https://app.$NEW/api/mcp`, `https://app.$NEW/api/a2a`, `https://app.$NEW/api/platform/mcp` | dashboard (`platform-agent-door-runbook.md`) |
| Connect application (operator sign-in) redirect URIs | `https://otel.$NEW/oauth2/callback`, `https://langfuse.$NEW/oauth2/callback`, `https://langfuse.$NEW/api/auth/callback/custom`, `https://qdrant.$NEW/oauth2/callback` | `WORKOS_CONNECT_REDIRECT_URIS` (all four; Langfuse needs both of its own, `kubernetes.md` §9b) |
| Sign-out redirect / app homepage, if set in the dashboard | `https://$NEW` / `https://app.$NEW` | dashboard |

Keep the former domain's resource indicators (`https://app.$OLD/api/{mcp,a2a,platform/mcp}`,
`https://platform-mcp.$OLD/{langfuse,cms}/mcp`) registered for as long as `formerBaseDomain` is
set: a connector still on the former URL asks AuthKit for a token with that `resource`.

#### Connected agents keep working

A connector (claude.ai, `claude mcp add`, Cursor) holds the URL it was set up with. A 301 does
not move it: an MCP client does not carry its POST across one, and even one that did would
then meet metadata whose `resource` is not the URL it holds, which RFC 9728 section 3.3 tells it
to reject, and a token whose audience the new host refused. So while `formerBaseDomain` is set
the former hosts serve agents as the new ones do, which is how RFC 9728 expects one server
reachable under two URLs to look: two resource identifiers, each with its own metadata.

- **Envoy.** `app.$OLD` keeps its 301 for every path except `AGENT_DOOR_PATHS`
  (`deploy/pulumi/src/app/former-domain.ts`), which go to the frontend with the app route's
  timeout, retry and per-client limit (BackendTrafficPolicy `former-app-timeouts`).
  `platform-mcp.$OLD` gets a listener, a certificate and an A record, and the gateway's own
  HTTPRoute serves both hosts.
- **The app** (`MCP_FORMER_ORIGINS=https://app.$OLD`, set by the program): each door accepts a
  token for its identifier under either host, and its metadata and 401 name the host the
  request came in on (`mcp-config.ts`, `requestHost`). A host outside that allowlist gets the
  canonical identifier.
- **agentgateway**: one extra route per server, bound to `platform-mcp.$OLD`, whose metadata
  names that host; every route's `audiences` holds both hosts' identifiers
  (`mcp-gateway-config.ts`).

A connector set up before the move therefore keeps its URL and its refresh token: nothing to
announce, nobody reconnects. New connectors are offered the new URL only (Settings → Agents,
Platform → Agents).

### PostHog (project 269895, read 2026-10-29)

Settings the project holds today, and what to add. Writes are **live** (owner, or an agent
with the owner's go-ahead):

| Setting | Today | Add or change |
|---|---|---|
| Authorized URLs (`app_urls`, toolbar and heatmaps) | both former app hosts and websites, and since 2026-11-05 `https://$NEW`, `https://$NEW_DEV`, `https://app.$NEW`, `https://app.$NEW_DEV` | nothing |
| Test account filter (`test_account_filters`) | excludes `app_host` and `$host` = `app.dev.$OLD`, and since 2026-11-05 `app.dev.$NEW` too | nothing for dev; done before dev's deploy |
| Replay trigger "Baseline sample (production only)" | URL regex for the former app host | `^https://app\.$NEW(/|$)` with the dots escaped; during the transition match both hosts |
| Conversations widget domains | `https://app.$OLD/`, `https://app.dev.$OLD/` | `https://app.$NEW/`, `https://app.$NEW_DEV/` |
| Cookieless server hash mode | `0` (off) | **Stateful** (Settings → Web analytics). Independent of the move and needed now: without it PostHog drops every cookieless website event (`apps/website/README.md`, Analytics) |
| Hog functions (`deploy/posthog/README.md`) | `default_host` = `app.$OLD`, `allowed_hosts` = both former app hosts | `default_host` = `app.$NEW`; `allowed_hosts` adds `app.$NEW`, `app.$NEW_DEV` |

### Langfuse and Qdrant

No setting of their own: Langfuse's `NEXTAUTH_URL` and both dashboards' hosts derive from
`baseDomain`. Their sign-in works on the new hosts once the four Connect redirect URIs above
are registered. Bookmarks and links in runbooks change from `langfuse.$OLD` to `langfuse.$NEW`.

### Search engines

- Google Search Console: add and verify a **Domain** property for `$NEW` (a DNS TXT record
  in the new zone) a week before. Keep the `$OLD` property verified for as long as the
  redirect runs.
- After the switch and once the 301s are confirmed: in the `$OLD` property, Settings →
  **Change of Address** → `$NEW`. Then submit `https://$NEW/sitemap-index.xml` in the new
  property. Bing Webmaster Tools has the same in its Site Move tool.
- Keep the redirect for at least a year (Google carries signals while it sees the 301s;
  180 days is its minimum).

### Website build: the site's own address

The website writes its address into every canonical URL, the sitemap, hreflang, the feeds and
JSON-LD (`Astro.site`). That address is **one value, the prod stack's `baseDomain`**, not the
brand's domain in `identity.json` (which is the brand's address in copy and e-mail):

- CI builds the `web` image with `PUBLIC_SITE_URL=https://<prod baseDomain>`
  (`ci/image_inputs.py build-args web`, passed by `.github/actions/build-image`). The value is
  part of the image's input hash, so changing `baseDomain` in `Pulumi.prod.yaml` rebuilds the
  website with its new address in the same merge; no separate flip.
- A local `bun run build` reads the same key from `deploy/pulumi/Pulumi.prod.yaml`
  (`apps/website/src/lib/site-url.mjs`). Only a build with neither falls back to the brand domain.

So before the switch the live pages name `$OLD` as canonical, and after it `$NEW`. Check it in
the switch PR's build: `python3 ci/image_inputs.py build-args web` prints the new address, and
the image's input hash for `web` changes.

## Order of operations

**A week before (all additive, nothing changes for a visitor):**

1. Create the Cloudflare zone for `$NEW` (registrar nameservers to Cloudflare; done: it shares
   the former zone's account and nameservers). Run `deploy/pulumi/scripts/check-cloudflare-token.sh
   --stack <stack>`: every zone `ok`, and its id printed. A zone it cannot see is fixed in Cloudflare
   by adding that zone to the token's Zone Resources; the token's value stays, so no config
   changes. Lower the TTL of the former zone's records to 300 s.
2. WorkOS, PostHog, Search Console: add the entries above.
3. Agents: nothing to announce; the former hosts keep serving them (above).

**Switch day, dev first, then prod after a day of dev running clean:**

4. **Prod only: keep the former zone's baseline.** The former apex and `app.` records need
   nothing: the program keeps them (`formerDnsZone*`). The zone-level records are different:
   `dns-www`, `dns-dmarc` and `dns-www-redirect` move to the new zone with `dnsZoneName`, and
   Pulumi would delete the former `www`, its redirect rule and its DMARC policy. Take those three
   out of prod's state first, so they stay in Cloudflare as they are (`www.$OLD` then 301s to
   `$OLD`, which 301s to `$NEW`):
   ```bash
   cd deploy/pulumi
   pulumi stack --stack prod --show-urns | grep -E '::dns-(www|dmarc|www-redirect)$'
   pulumi state delete --stack prod '<each of the three urns>'   # one-way for the state, not for DNS
   ```
   Dev owns no baseline and skips this step.
5. Open a PR with the configuration changes above for that stack. Read its `pulumi preview`
   (CI posts it; `npm run preview` with stack credentials): expected are new records in the
   new zone, two `https-former-*` listeners and their certificates (three, with
   `https-former-platform-mcp`, where the platform MCP gateway runs, plus its A record in the
   former zone), two `former-*-redirect` HTTPRoutes and the `former-app-timeouts` policy, new hostnames on every listener, and changed env on the frontend, web, api and
   Langfuse pods. The former apex and `app.` records show no change. The only `DnsRecord`
   deletes are the former `s3.`, `langfuse.`, `qdrant.`, `cms.` (and on prod any other operator)
   hosts; a delete of the former apex, `app.`, `www` or `_dmarc` means step 4 or
   `formerDnsZone*` is missing.
6. Merge. CI rebuilds the `web` image with `PUBLIC_SITE_URL=https://$NEW` (the new
   `baseDomain` is part of its hash), and the deploy runs `pulumi up` (**live**). cert-manager
   issues the new certificates over HTTP-01 within minutes. The former hosts' listeners use new
   Secrets (`former-web-tls`, `former-app-tls`), so they fail TLS for those minutes too.
7. Check, from outside the cluster:
   ```bash
   curl -sI "https://$OLD/blog/?x=1"     | grep -iE '^(HTTP|location)'   # 301, location https://$NEW/blog/?x=1
   curl -sI "https://app.$OLD/projects"  | grep -iE '^(HTTP|location)'   # 301, location https://app.$NEW/projects
   curl -s  "https://$NEW/healthz"                                       # ok
   curl -s  "https://$NEW/" | grep -o '<link rel="canonical"[^>]*>'        # names https://$NEW/
   curl -s  "https://app.$NEW/.well-known/oauth-protected-resource/api/mcp" | jq .resource   # "https://app.$NEW/api/mcp"
   # An agent connected before the move: served, not redirected, under its own identifier.
   curl -s  "https://app.$OLD/.well-known/oauth-protected-resource/api/mcp" | jq .resource   # "https://app.$OLD/api/mcp"
   curl -si -X POST "https://app.$OLD/api/mcp" | grep -iE '^(HTTP|www-authenticate)'       # 401, resource_metadata on app.$OLD
   curl -s  "https://platform-mcp.$OLD/.well-known/oauth-protected-resource/langfuse/mcp" | jq .resource
   ```
   Sign in on `https://app.$NEW` (AuthKit's session cookie is per host, so everyone signs in
   once more), open a document preview (S3), connect an agent to the new URL.
8. Search Console Change of Address; PostHog replay regex; a release note for the move.

**Months later (the sunset):** the former hosts serve agents only until `formerBaseDomain` is
unset, so that is a decision, made on evidence: the gateway's access log (or the frontend's
traces) shows no request on `app.$OLD/api/*` or `platform-mcp.$OLD` for four weeks, or the
owner names the remaining offices and asks them to reconnect first. Then remove the former
entries from WorkOS (redirect URIs and resource indicators, re-reading each list before the
write) and PostHog, unset `formerBaseDomain`, and delete the former zone's records in
Cloudflare. Keep the domain registered. Permanent is the wrong default: it keeps a retired
brand's hosts, certificates and resource indicators alive forever for clients nobody can
count.

## Rollback

Before step 8 everything goes back by reverting the PR of step 5:

1. Revert the PR. The following `pulumi up` removes the new zone's records, listeners,
   certificates and redirect routes itself.
2. The former apex and `app.` records were never out of the state and need nothing. The
   former hosts the move deleted (`s3.` and the operator hosts) are re-created by the `up`.
   On prod, reconcile the three baseline resources of step 4 one by one before the `up`.
   `dns-www` and `dns-www-redirect` are in the state again, but for the new zone; the reverted
   config moves them back, and both creates collide with what step 4 left in the former zone:
   - `dns-www` (`DnsRecord`): delete `www.$OLD` in Cloudflare right before the `up`, or
     `pulumi state delete` the new-zone entry and import the former record over it
     (`pulumi import cloudflare:index/dnsRecord:DnsRecord dns-www <zoneId>/<recordId>`).
   - `dns-www-redirect` (`Ruleset`, not a record): a zone holds one entrypoint ruleset per
     phase, so delete the former zone's `http_request_dynamic_redirect` entrypoint in
     Cloudflare (Rules → Redirect Rules) right before the `up`, or import it with
     `pulumi import cloudflare:index/ruleset:Ruleset dns-www-redirect zones/<zoneId>/<rulesetId>`
     after removing the new-zone entry from the state.
   - `dns-dmarc` (`DnsRecord`): not in the state at all, and the reverted config declares it
     again. Import the former `_dmarc.$OLD` record as above, or delete it right before the `up`.
   Deleting is a few minutes of resolution failures for that name, bounded by the 300 s TTL;
   importing has none.
3. WorkOS and PostHog need nothing: the old entries were never removed.

After step 8, Search Console's Change of Address can be withdrawn in the `$OLD` property,
but Google may already have moved results; treat it as the one step that is hard to undo.
