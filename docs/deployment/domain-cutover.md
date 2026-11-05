# Domain cutover: moving every public host to the domain in `identity.json`

**Status: dev switching, prod prepared** (owner decision D2, 2026-10-29: prepare, don't flip;
2026-11-05: switch dev). The new zone is in the same Cloudflare account as the former one. The
dev stack's switch is committed in `Pulumi.dev.yaml` and deploys once its `dnsZoneId` holds the
new zone's id (the placeholder fails `pulumi preview`). Staging's WorkOS entries are added. Prod
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
- **The former hosts' DNS.** With `formerBaseDomain` set, the former apex and `app.` host keep
  their A records at the Gateway, under the same Pulumi resource names they had as the stack's
  own hosts, so the move neither deletes nor re-creates them (`deploy/pulumi/src/platform/dns.ts`).
  When the former domain is another Cloudflare zone, `formerDnsZoneName` and `formerDnsZoneId`
  name it, and the one `cloudflareApiToken` must edit both zones. The former `s3.`, `otel.`,
  `langfuse.`, `qdrant.` and `cms.` records are deleted by the move, as the table above says.
- **The token check.** `deploy/pulumi/scripts/check-cloudflare-token.sh --stack <stack>` asks the
  Cloudflare API whether the stack's token can see, read and write each zone (the new one and the
  one prod serves, by default), and prints each zone's id. It needs `pulumi login`, or the token in
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
| `cloudflareApiToken` (ESC) | prod's token | unchanged, once `check-cloudflare-token.sh --stack prod` passes for both zones; otherwise add the new zone to the token in Cloudflare (its value stays) |
| `dnsDmarc` | the former domain's policy | **unset.** `_dmarc.$NEW` has one owner, the project-mail block of `Pulumi.prod.yaml` (agreed 2026-11-05 with the mail work, archos-at/archos#1464 and its follow-up), because mail needs it before prod's switch. Two TXT records at `_dmarc` make DMARC fail, and Cloudflare accepts the second without a word. The former value also does not fit: it reports to the former registrar and was written for a domain with no mail, while `$NEW` carries Google Workspace mail. The policy itself (start at `p=none` with `sp=` set) is the owner's mail decision |
| comment on the Qdrant dashboard | `https://qdrant.$OLD/oauth2/callback` | `https://qdrant.$NEW/oauth2/callback` |

`dnsZoneBaseline: "true"` stays on prod: it publishes the new zone's apex, `www` (301 to the
apex at Cloudflare); `_dmarc` belongs to the mail block (row above). The former zone's `www`, `_dmarc` and `www` redirect rule
stay where they are only after step 4 takes them out of the state.

### Dev (`deploy/pulumi/Pulumi.dev.yaml`)

Committed on 2026-11-05, except the one value marked TODO(owner) in the file:

| Key | Was | Now |
|---|---|---|
| `baseDomain` | `$OLD_DEV` | `$NEW_DEV` |
| `formerBaseDomain` | (unset) | `$OLD_DEV` |
| `dnsZoneName` | `$OLD` | `$NEW` (the same zone as prod) |
| `dnsZoneId` | the former zone's id | `REPLACE_ME` until the id from `check-cloudflare-token.sh --stack dev` replaces it |
| `formerDnsZoneName` / `formerDnsZoneId` | (unset) | `$OLD` and the former zone's id |
| `cloudflareApiToken` | (secure) | unchanged: the same token, once it edits both zones |

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

**Connected agents must reconnect.** A token for the agent doors names the door's URL as
its audience, and the door accepts exactly one (`principal.ts`, `acceptedAudiences`). After
the switch the doors are `https://app.$NEW/api/mcp` and `/api/a2a`; a client still holding a
token for the former URL is refused, and its POST to the former host meets the 301, which
does not carry a POST across. TODO(owner): choose one before the switch — (a) announce it:
a release note and a mail to offices with a connected agent, who run their client's
"reconnect" once; or (b) a follow-up change that accepts the former audiences for a
grace period (`MCP_FORMER_RESOURCE_URLS` in `mcp-config.ts`, not built). (a) is the
default this runbook assumes.

### PostHog (project 269895, read 2026-10-29)

Settings the project holds today, and what to add. Writes are **live** (owner, or an agent
with the owner's go-ahead):

| Setting | Today | Add or change |
|---|---|---|
| Authorized URLs (`app_urls`, toolbar and heatmaps) | both former app hosts and websites, plus `https://$NEW` and `https://$NEW_DEV` (read 2026-11-05) | `https://app.$NEW`, `https://app.$NEW_DEV` |
| Test account filter (`test_account_filters`) | excludes `app_host` = `app.dev.$OLD` and `$host` = `app.dev.$OLD` | add `app.dev.$NEW` to both, **before dev's deploy**, or staging's traffic counts as production in every insight |
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
3. Agents: announce the reconnect (if option a).

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
   new zone, two `https-former-*` listeners and their certificates, two `former-*-redirect`
   HTTPRoutes, new hostnames on every listener, and changed env on the frontend, web, api and
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
   ```
   Sign in on `https://app.$NEW` (AuthKit's session cookie is per host, so everyone signs in
   once more), open a document preview (S3), connect an agent to the new URL.
8. Search Console Change of Address; PostHog replay regex; a release note for the move.

**Months later:** remove the former entries from WorkOS and PostHog, unset
`formerBaseDomain`, and delete the former zone's records in Cloudflare. Keep the domain
registered.

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
