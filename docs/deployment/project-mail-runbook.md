# Project mail to production: the owner's runbook

One document, top to bottom, from "off" to "an office receives project mail".
Every step says what to do, how to see that it worked, and what to do when it did
not. Steps marked **one-way door** change production, money or a vendor account
and are the owner's to run; everything else is read-only or reversible.

Why it is built this way: [ADR-0138](../adr/0138-project-mail-arrives-through-cloudflare-email-routing-and-a-signed-worker.md)
(transport), [ADR-0137](../adr/0137-mail-sent-to-a-project-waits-until-a-person-files-it.md)
(holding and filing), [ADR-0157](../adr/0157-attachments-from-outside-are-scanned-in-cluster-by-clamav.md)
(the scanner). The reference this runbook orders:
[`kubernetes.md` §3c](kubernetes.md#3c-project-mail-cloudflare-email-routing-adr-0138)
(owner gates O1–O7, launch gates G0–G9, record of runs), the config keys in
[`deploy/pulumi/README.md`](../../deploy/pulumi/README.md#configuration-reference),
the flow inside the product in [`inbound-mail.md`](../architecture/inbound-mail.md).

**Done means:** a named office has the `inbound-mail` entitlement, its projects
show an address `project+<slug>.<token>@inbox.<domain>`, mail a project writer
sends from their own signed address is filed directly as them, everything else
waits in the project's E-Mail-Eingang, and gates G0–G9 are recorded as passed in
`kubernetes.md` §3c.

## Prod: one promotion (owner decision, 2026-11-14)

Prod does not take the three promotions of §6 to §8. The owner decided on
2026-11-14 that project mail goes live for **all offices** with the November
develop→prod release (its runbook `docs/deployment/prod-release-2026-11.md`, Phase 4),
and gave the data-protection go-ahead for all of them. Every office is a pilot,
and dev has received mail since 2026-11-05. The cost: §8's gates run after
go-live instead of before, against the first real mail, and G0's open question
(B2: does archos.tech take subaddressing without its Google apex being
onboarded?) is answered by the deploy itself.

`Pulumi.prod.yaml` carries the whole block, on and unpaused: `malwareScanEnabled`,
`inboundMailDomain: inbox.archos.tech`, its zone id, `inboundMailDmarc`,
`inboundMailOperatorAddress` with `inboundMailOperatorAddressShared: "true"`,
`inboundMailPaused: "false"`. `stack-files.spec.ts` and `loadConfig` check it on
the pull request.

**What the promotion does by itself**, in the `Pulumi up (prod)` job:

| Step | Before | Now |
|---|---|---|
| The scanner | promotion 1, then wait for ClamAV to be ready | the same apply. `pulumi up` does not wait for the `clamav` Deployment (`pulumi.com/skipAwait`, `src/app/clamav.ts`): its first readiness needs freshclam's update, about ten minutes or more, and would hold back the app tiers. Until it is ready every scan fails closed and is retried; mail is held, never filed unscanned |
| The verification click | the first apply failed at the forwards (error 2054); click, re-run | none. The forwards point at dev's destination address `matthias.bigl+mail-dev@archos.tech`, which the account holds verified; prod declares no address (`inboundMailOperatorAddressShared`). The preview refuses, with nothing changed, if the account does not hold it verified |
| Subaddressing (§7) | one `curl` by a person | the step `Project mail - subaddressing` after `pulumi up` (`scripts/inbound-mail-after-deploy.sh subaddress`): GET, PATCH `support_subaddress` only when it is off, GET again; a refusal fails the job (B2) |
| G7 | a person's `cloudflare` run | the step `Project mail - launch gates`, in the job summary |
| G3 (signed route) | a person's `signed --run` | the same step, once the `production` environment's secret `INBOUND_MAIL_TEST_ADDRESS` holds a test-office address; until then the summary says it was skipped |

**What still needs a person, before the promotion:**

- [ ] **The deploy token** (§4). Prod's `cloudflareApiToken` in ESC is still the
  user token on `piloti.at` only ([`domain-cutover.md`](domain-cutover.md), the
  token row: dev's was replaced 2026-11-05, prod's was not). Replace it with an
  account-owned token carrying §4's mail scopes on `archos.tech` and the
  account **and** everything prod's DNS block uses on `piloti.at` today (Zone ·
  DNS · Edit, Zone · Zone · Read, and the `www` redirect's Single Redirect /
  Dynamic URL Redirects · Edit). Prove it before setting it:
  `CLOUDFLARE_API_TOKEN=<token> deploy/pulumi/scripts/check-cloudflare-token.sh --stack prod`.
  A missing scope fails the preview, or the apply at the resource that needed it.
- [x] Workers Paid (§3, 2026-11-05). [x] The signing key in prod's ESC (§5, 2026-11-05).
- [ ] Optional, read-only, so the preview is not where you learn it: dev's
  destination address still verified, `GET /accounts/<account>/email/routing/addresses`
  (its `verified` is a date). Staging's deploys being green says so: dev's
  forwards to it could not exist otherwise.
- [ ] Langfuse (§3, O3), if not done: `task langfuse:provision -- --apply`.
  Mail is received without it; the suggestion's scores have no config.

**After the job is green, gates included:**

1. The owner switches `inbound-mail` on in WorkOS Production for all
   organizations (§9). Not before: until then the frontend shows no address,
   so no address exists that could bounce while subaddressing is still being
   switched on.
2. `kubectl -n grid rollout status deploy/clamav --timeout=30m` (§6's checks).
   Not ready after that: freshclam's log, §6.
3. A test-office address into the `production` environment's secret
   `INBOUND_MAIL_TEST_ADDRESS` (GitHub → Settings → Environments), so the next
   deploy runs G3; or run `signed --run` by hand now (§8's shell).
4. The gates no deploy can run, on the live system: G0's test mail, G1, G2,
   G5, G6's verdicts, G9 (§8, Phase B), recorded in `kubernetes.md` §3c. B1's
   check of the Worker's `LANDING_URL`.

**If the job fails:** at the forwards' preview guard, the shared address is not
verified (click its mail, re-run). At the subaddressing step, B2 has happened:
leave the WorkOS flag off, set `inboundMailPaused: "true"` (or
`inboundMailEnabled: "false"`) and decide D1 again; never onboard the apex.
At a gate, the summary names the check; leave the flag off until it is green.
Rollback, fastest first: the WorkOS flag off, then the pause, then
`inboundMailEnabled: "false"` (§10).

## 0. Before you start: what this runbook cannot fix

| # | Open item | Effect | What closes it |
|---|---|---|---|
| B1 | **Closed 2026-11-03: the help and privacy links follow the website's host.** The brand rename had replaced the real host with `https://example.org` (commit `5b1b6005c`). The bounce text is now a template (`rejectText` in `contracts/inbound-mail-contract.json`) that the Worker and the BFF fill with `LANDING_URL`, `https://<webDomain>` from Pulumi (`webOrigin` in `deploy/pulumi/src/config/ingress.ts`), and the UI's „Anleitung“ links take the same origin from the server (`AppConfig.publicSiteUrl`). The domain cutover moves all three with the stack's `webDomain` | Before the fix, a sender who mistyped an address was sent to `example.org`. Now, with `LANDING_URL` unset or malformed, the bounce says the same without links and the dialog shows no „Anleitung“: a refusal never turns into a retry | Nothing. Check once after the first promote: the Worker's `LANDING_URL` binding in Cloudflare (Workers → the inbound-mail Worker → Settings → Variables) is the website's origin |
| B2 | **G0 is unproven.** Cloudflare documents adding a subdomain to Email Routing from the *apex's* Email Routing settings, and onboarding an apex whose MX belong to another provider fails with error 2008 ("Non-Cloudflare MX records exist"). Pulumi enables the subdomain through the API (`email/routing/dns` with the subdomain's name), which is not documented to need the apex; subaddressing is set by the zone's settings endpoint (`PATCH …/email/routing`, §7), which is not documented to work on a zone whose apex is not onboarded | If the subdomain cannot be routed, or subaddressing cannot be switched on, without onboarding the apex, path (b) below is blocked | §7 and gate G0 prove it on the real zone. The fallback, a dedicated mail-only domain with an apex catch-all, is a code change (the address grammar, the Worker's shape check, the parser and the Pulumi rule; ADR-0138, "The fallback") |
| B3 | **Cloudflare refuses mail that passes neither SPF nor DKIM, and mail that fails the sender's DMARC policy** (Cloudflare Email Service, "Postmaster" → "Mail authentication requirement", required since 2025-07-03). ADR-0138's table says any sender is accepted and held; at Cloudflare that holds only for senders that authenticate | A small office or authority whose domain publishes neither SPF nor DKIM gets a bounce from Cloudflare, before the product sees the mail | Nothing in the product. Support says so (section 11) |

## 1. Facts as of 2026-11-03

Read with `dig` or DNS over HTTPS on 2026-11-03 (`archos.tech` re-read 2026-11-05: unchanged); `scripts/inbound-mail-smoke.ts g0`
re-reads the live values.

| | `piloti.at` | `archos.tech` |
|---|---|---|
| Role | `baseDomain` of the prod stack: the app (`app.piloti.at`), the website (apex), the zone the stack's DNS manages (`dnsZoneId`, `dnsZoneBaseline: true`) | The brand domain in `packages/brand/identity.json`; the prepared [domain cutover](domain-cutover.md) moves the stack here (not done) |
| Nameservers | Cloudflare | Cloudflare |
| Apex MX | none | `smtp.google.com` (Google Workspace: the company's mail) |
| SPF / DKIM | none | `v=spf1 include:_spf.google.com ~all`; Google's DKIM key at `google._domainkey` |
| DMARC | `v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;` (set by the stack, `dnsDmarc`) | none published |
| `inbox.` subdomain | does not exist | does not exist |
| Email Routing | not enabled | not enabled |

In the product on 2026-11-03: no stack set `inboundMailDomain`; prod had
`malwareScanEnabled` unset (off). Since then dev receives mail on
`inbox.dev.piloti.at` (2026-11-05) and prod's block is on for the November
release (the section above). The WorkOS entitlement `inbound-mail` exists
in both environments (owner gate O1, 2026-10-27): staging ON for all
organizations since 2026-11-05, production OFF until the owner switches it on
after the release's deploy (the section at the top). Every office is a pilot (owner, 2026-11-05), so §9 is one switch: production,
all organizations.

## 2. Decisions to make first

**D1, the receiving domain.** An address lives as long as the domain does: a
project's address is printed in letters, saved in contacts and set in Cc by
authorities, and the product has no alias for a former domain, so moving the
domain later stops every address (each project gets a new one; the old ones bounce).

| | (a) `inbox.piloti.at` | (b) `inbox.archos.tech` |
|---|---|---|
| Config | `inboundMailDomain` only: the stack's own zone, no zone id, no new token zone | `inboundMailDomain` and `inboundMailZoneId` (the brand zone's id); the token gains that zone |
| Risk B2 | Low. The apex has no MX, so even a forced apex onboarding would succeed and take no one's mail; the owner may accept that (§7, path a) | The real test. The apex's MX are Google's: never onboard the apex. If G0 fails here, the fallback is code |
| Lifetime | Ends at the domain cutover: every project mail address changes then | Survives the cutover |
| Sender's view | The retired domain in every address | The brand in every address |

Recommendation: **(b)**, if §7's call can switch subaddressing on without touching
the apex. If it cannot, decide between (a) with a planned address change at the
cutover and the fallback's code change. Write the choice into the record of runs
in `kubernetes.md` §3c.

**Decided 2026-11-05 (owner):** prod takes (b), `inbox.archos.tech`. Dev gets
mail too and goes first (§8a), on `inbox.dev.piloti.at` in the piloti.at zone:
Email Routing's state is one object per zone (the provider imports
`EmailRoutingDns` by zone id), so two stacks may not share one, and
`stack-files.spec.ts` refuses it. The cost of that choice: dev's G0 does not
prove what prod's must, that archos.tech's zone takes subaddressing without its
Google apex being onboarded. Prod's G0 answers that while prod is still paused.

**D2, the test office.** One WorkOS organization in production that is yours
(the company's own office), with one project, to receive every probe. Its
manager creates the address; nobody outside the company may hold it.

**D3, the operator mailbox.** The address `postmaster@` and `abuse@` of the
receiving domain forward to (RFC 2142), on the company's own mail, e.g. a Google
group: `inboundMailOperatorAddress`. Pulumi registers it with Cloudflare; a
person opens Cloudflare's verification mail to it once (§7). Or the stack
shares one the account already holds verified (`inboundMailOperatorAddressShared`):
no mail, no click. Prod shares dev's since 2026-11-14. The DMARC report
address (`rua=`) is set on its own in `inboundMailDmarc`.

**D4, the pilot office.** The first customer office (gate O7), and one of its
people who can export a few hundred messages of real project mail for G9.

## 3. Accounts and plans

- [x] **Cloudflare Workers Paid** (done: the owner confirmed the account has it, 2026-11-05) on the account that owns the zone (owner gate
  O2, **one-way door**: a subscription). Dashboard → Workers & Pages → Plans.
  Needed for CPU time: Free allows 10 ms per invocation, and the Worker copies
  and hashes up to 25 MiB (gate G5 measures it). Email Routing itself is free on
  every plan.
- [ ] **Langfuse** (owner gate O3, **one-way door**):
  `task langfuse:provision` (checks), then `task langfuse:provision -- --apply`
  (creates the score config `mail-thread-match` and the decision score's
  subject `inbound_mail_suggestion`).
- [ ] **WorkOS**: nothing to create. `inbound-mail` exists (O1); the audit-log
  schemas `inbound_mail.*`, `inbound_mail_address.*` and `mail_thread.*` are
  created by the deploy's audit-schema Job, and the authorization catalog by its
  catalog Job, on every deploy.
- [ ] **The code is on `develop`**: the project-mail branches (PR #1464 and the
  ones it builds on) are merged and CI passed on the commit you will promote.

Tools on your machine: `pulumi` and `esc` (logged in to Pulumi Cloud), `kubectl`
with the prod kubeconfig, `bun`, `jq`, `openssl`, `git`.

Names used below. Run from the repository root, so the commands hold no product
name of their own:

```bash
cd deploy/pulumi
P=$(sed -n 's/^name: *//p' Pulumi.yaml)                                    # the Pulumi project
ENV=$(awk '/^environment:/{getline; sub(/^ *- */,""); print; exit}' Pulumi.prod.yaml)  # the ESC environment prod imports
STACK="matthiasbigl/$P/prod"
```

## 4. Cloudflare: what Pulumi cannot do for you

Pulumi creates, at promotion 2, the routing on the subdomain, the project rule,
the Worker, the operator's destination address, the `postmaster@` and `abuse@`
forwards and (path (b)) the DMARC record. What stays with a person: the token's
scopes, the plan (§3), the zone id, one click in a verification mail, and the
subaddressing switch (§7: the provider has no safe way to set it).

- [ ] **The deploy token.** A new account-owned token (Cloudflare → Manage
  Account → Account API Tokens → Create), stored as `cloudflareApiToken` in the
  prod ESC environment in place of the old one. No account-id key: Pulumi reads
  the account from the zone (`getZone`). Its scopes for project mail:
  - on `archos.tech` (Zone Resources):
    - Zone · Zone · Read (the zone check and the account id)
    - Zone · Zone Settings · Edit (enabling routing on the subdomain; the
      subaddressing call of §7)
    - Zone · DNS · Edit (routing writes and locks the subdomain's MX and TXT;
      the MX guard reads them; the DMARC record and its guard)
    - Zone · Email Routing Rules · Edit (the project rule and the two forwards)
  - on the account:
    - Account · Workers Scripts · Edit (the Worker)
    - Account · Email Routing Addresses · Edit (the operator's destination address)

  The same token carries the domain cutover's scopes (DNS · Edit and Single
  Redirect · Edit on `archos.tech` and `piloti.at`, [`domain-cutover.md`](domain-cutover.md)).
  On path (a) the four zone scopes are on `piloti.at` instead. The source of
  this list: `deploy/pulumi/src/platform/inbound-mail.ts`, "Cloudflare API
  token scopes". A missing scope fails the preview or the apply with a 403 at
  the resource that needed it, and nothing after it runs.
- [ ] **A read-only token for the gates**, separate from the deploy token:
  Zone · Zone · Read, Zone · Zone Settings · Read, Zone · Email Routing Rules ·
  Read, Zone · DNS · Read on the D1 zone, and Account · Workers Scripts · Read
  and Account · Email Routing Addresses · Read. The smoke tool never writes; a
  403 names the path it could not read.
- [x] **The zone id**, path (b) only: `31df51fbdd7ea2d7ef63bcaab9a09559`
  (Cloudflare → `archos.tech` → Overview → API → Zone ID, read 2026-11-05; the
  same account as `piloti.at`). It is already in the commented §7 lines of
  `Pulumi.prod.yaml`; `loadConfig` refuses anything that is not 32 hex digits.
- [ ] **The operator mailbox (D3)**: decide its address now, on the company's
  own mail (a Google group on `archos.tech` takes the DMARC reports of path (b)
  without further DNS). Pulumi adds it as a destination address at §7. If it
  is already a destination address in the account (added by hand earlier, or
  used by another zone), import it once before the promotion, or the apply
  fails with a duplicate:
  `pulumi import cloudflare:index/emailRoutingAddress:EmailRoutingAddress inbound-mail-operator '<account_id>/<destination address id>'`
  (the id: `GET /accounts/<account_id>/email/routing/addresses`).
- [ ] **Do not** add the `postmaster@`/`abuse@` rules or switch subaddressing on
  in the dashboard. Rules made by hand beside Pulumi's are two rules for one
  pattern (only the first in the list acts), and the dashboard's Email Routing
  page for `archos.tech` may offer only "Get started" / "Onboard domain",
  which on that apex either fails with error 2008 or, in the flow that offers
  to delete the existing MX, takes the company's mail away from Google.

## 5. Secrets

**Done 2026-11-05 (owner):** `inboundMailSigningKeys` is set in both ESC
environments (dev's and prod's, `matthiasbigl/$ENV` as §3 resolves it), each
one entry with key id `mi-2026-11` and its own 32-byte secret (the two differ).
The commands below are for a rotation or a new stack.

The prod stack keeps every secret in its ESC environment, never in
`Pulumi.prod.yaml` (`pulumi config set --secret` would write ciphertext into the
committed file, and stack config wins over ESC). Set the signing key now; it is
unused until the domain is set.

```bash
KEY_ID="mi-$(date +%Y-%m)"            # [A-Za-z0-9._-]{1,64}; the month makes a rotation's successor obvious
SECRET="$(openssl rand -base64 32)"    # 32 random bytes, base64 with padding: what assertSigningKeys and the BFF require
esc env set "matthiasbigl/$ENV" "pulumiConfig.$P:inboundMailSigningKeys" "{\"$KEY_ID\":\"$SECRET\"}" --secret --string
unset SECRET
echo "$KEY_ID"                         # note it for the record of runs; it is not secret
```

`--string` stores the JSON as text, which is what `loadConfig` parses. If your
`esc` has no `--string`, use `pulumi env edit "matthiasbigl/$ENV"` and add under
`values.pulumiConfig` the line `<project>:inboundMailSigningKeys: {fn::secret: '{"mi-…":"…"}'}`.
What the key must be (`assertSigningKeys`, `src/config/inbound-mail.ts`, the same
rule as the BFF's): a JSON object of one or two entries, keyid →
base64 of at least 32 bytes, never the development secret. The preview refuses
anything else with the exact `pulumi config set` shape in its message.

`inboundMailSigningKeyId` stays unset: with one key the Worker signs with it.

## 6. Promotion 1: the image and the scanner

§6 to §8 are the path for a stack brought up step by step. Prod takes one
promotion instead (the section at the top); the checks and the failure notes
below still apply to it.

The scanner must run before the domain is set (`loadConfig` refuses the pair),
and its first start needs fresh signatures.

- [ ] On a branch off `develop`, in `deploy/pulumi/Pulumi.prod.yaml`, block
  "Project mail": uncomment the line under "Promotion 1"
  (`malwareScanEnabled: "true"`). Merge it to `develop`.
- [ ] The develop→prod promotion PR as usual ([`cd.md`](cd.md)): it bumps
  `imageTag` to a green `develop` sha that contains the project-mail code.
- [ ] Before approving, preview it yourself (read-only):
  `pulumi stack select "$STACK" && npm run preview` on the promotion's commit.
  Expect a new `clamav` Deployment and Service, the NetworkPolicy
  `clamav-bff-only`, `MALWARE_SCAN_URL` on `frontend` and `bff-jobs`, and the
  rollouts the image bump brings. Nothing at Cloudflare.
- [ ] **One-way door:** merge the promotion and approve the `Pulumi up (prod)`
  job in the `production` environment (`.github/workflows/deploy.yml`). Running
  `npm run up` from a checkout of `prod` instead is equivalent only if the same
  stack file is committed to `prod` right after: the next promotion applies the
  committed file.

What the deploy runs by itself, on every deploy: the migration Job
(`grid-app-migrate`, `drizzle-kit migrate`; this image brings 0195–0199:
`upload_batch_effects`, `inbound_mail`, `sender_class`, `original_author`,
`receive_faults`), the WorkOS audit-schema Job and the authorization-catalog
Job (`grid-app-authz-catalog`). There is no scheduler container (ADR-0150):
Hatchet runs the rest on the `bff-jobs` pool. The receive, suggest, sender
filing, file and follow jobs are `bff-job` runs (each job's payload stays on
its `bff_job_queue` row; a run's input is ids and the priority), a job that
waits (a dependency fault, a suggestion not ready) is a scheduled run at its
`notBefore`, and project mail's sweeps 1–15 are the `inbound-mail-sweep` cron
task, every minute. The Hatchet platform itself (`background-work` namespace)
comes with the develop image that carries this code: see
[`hatchet.md`](hatchet.md).

Checks after it:

```bash
kubectl -n grid get jobs                                  # the migrate, audit-schema and authz-catalog Jobs: Complete
kubectl -n grid rollout status deploy/clamav --timeout=15m   # ready only once freshclam has signatures under 48 h old
kubectl -n grid logs deploy/clamav -c freshclam --tail=20    # "Database updated" or "up-to-date", no repeated errors
```

If `clamav` stays not ready: freshclam needs HTTPS egress to
`database.clamav.net` and the pod requests 2 GiB on the batch node group; read
its events (`kubectl -n grid describe pod -l app.kubernetes.io/name=clamav`). Promotion 2 waits for it.

## 7. Promotion 2: the domain, paused

- [ ] On a branch off `develop`, in the same block of `Pulumi.prod.yaml`,
  uncomment **either** the (a) line **or** the (b) lines, then the
  `inboundMailOperatorAddress` line and the `inboundMailPaused: "true"` line,
  and fill in the placeholders:
  - (b): `inboundMailZoneId` (§4), and `inboundMailDmarc` with `rua=mailto:`
    the operator mailbox. The recommended record,
    `v=DMARC1; p=none; sp=none; adkim=r; aspf=r; rua=mailto:<operator>`, only
    reports (`p=none`) and covers `inbox.` explicitly (`sp=none`); tighten it
    later in the same key. The mail block is the one writer of
    `_dmarc.archos.tech` until the domain cutover: no stack may set `dnsDmarc`
    on that zone meanwhile.
  - (a): no `inboundMailDmarc`. `piloti.at`'s `_dmarc` is the DNS block's
    `dnsDmarc`, whose policy covers the subdomain too, and `loadConfig`
    refuses both on one zone.

  Merge to `develop`; `stack-files.spec.ts` fails the PR if the scanner line is
  not on, if another stack claims the same zone, if the operator mailbox is
  missing, if the DMARC record does not parse, or if another stack's
  `dnsDmarc` writes the same zone's `_dmarc`.
- [ ] Promotion PR, then `npm run preview` on its commit. Expect exactly, all
  on the mail provider `cloudflare-inbound-mail`:
  - `inbound-mail-routing` (`cloudflare:EmailRoutingDns`, on the subdomain)
  - `inbound-mail-worker` (`cloudflare:WorkersScript`, `inbound-mail-prod`)
  - `inbound-mail-rule` (`cloudflare:EmailRoutingRule`, `project@inbox.<domain>` → the Worker)
  - `inbound-mail-operator` (`cloudflare:EmailRoutingAddress`, the operator mailbox, account level)
  - `inbound-mail-postmaster` and `inbound-mail-abuse` (`cloudflare:EmailRoutingRule`, forward to it)
  - (b) `inbound-mail-dmarc` (`cloudflare:DnsRecord`, TXT `_dmarc.archos.tech`)
  - `INBOUND_MAIL_DOMAIN`, `INBOUND_MAIL_LOCAL_PART`, `INBOUND_MAIL_PAUSED=true`,
    `INBOUND_MAIL_SIGNING_KEYS` on the frontend (a rolling restart).

  Nothing on the apex's MX, and no `EmailRoutingSettings` (its create
  onboards the apex: ADR-0138). The preview **fails** and changes nothing if:
  the key map is malformed (step 5), the zone id is not 32 hex digits or names
  another zone, the token lacks a scope, the subdomain already has MX pointing
  anywhere but `*.mx.cloudflare.net`, or `_dmarc.<apex>` already holds a DMARC
  record this stack did not write (one written by hand, or another stack's
  `dnsDmarc`: two records make receivers apply neither).
- [ ] **One-way door:** merge and approve `Pulumi up (prod)`. If the apply fails
  at `inbound-mail-routing` with error 2008 or a message about the apex, risk
  B2 has happened: nothing was routed, the apex is untouched; stop and decide D1
  again.
- [ ] **The verification click.** Creating `inbound-mail-operator` makes
  Cloudflare mail a verification link to the operator mailbox; open it and
  click. **The first apply fails at the two forward rules**, `inbound-mail-postmaster`
  and `inbound-mail-abuse`: Cloudflare's API refuses a forward to an
  unverified destination with `400`, code `2054`, "Destination address is not
  verified" (seen on dev, 2026-11-05), although its docs say such rules are
  created and kept disabled. Everything else of the apply is in place by then.
  Click the link, then re-run the failed `Pulumi up` job: the second apply
  creates the two rules. The stack output `inboundMailOperator` reads
  `… (NOT verified …)` until Pulumi reads it again (`pulumi refresh`); `g0`
  reads it live.
- [ ] **Subaddressing.** A deploy through `deploy.yml` does this itself after
  `pulumi up` (`scripts/inbound-mail-after-deploy.sh subaddress`: GET, then the
  PATCH below only when it is off; a refusal fails the job). By hand, for a stack
  applied outside CI: one API call with the deploy token (it has Zone
  Settings · Edit), from the shell of §3:

  ```bash
  ZONE=<the D1 zone id>                      # (a): the prod stack's dnsZoneId
  curl -sS -X PATCH "https://api.cloudflare.com/client/v4/zones/$ZONE/email/routing" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
    --data '{"support_subaddress":true}' | jq '{success, errors, support_subaddress: .result.support_subaddress, enabled: .result.enabled}'
  ```

  This is the zone's settings endpoint: its `enabled` field is a no-op
  ("use POST/DELETE /zones/{zone_id}/email/routing/dns", Cloudflare's API
  reference), so it routes nothing and onboards nothing. Never call
  `…/email/routing/enable`: that is the apex's onboarding. Why it is not in
  Pulumi: the provider's only handle, `EmailRoutingSettings`, calls exactly that
  endpoint and never sends the field (ADR-0138).
  - `success: true`, `support_subaddress: true`: run `g0` (§8).
  - Refused (an error that the zone is not set up for Email Routing, or any
    other), path (b): **stop**, do not onboard `archos.tech`. This is risk B2.
    Turn the feature off (section 10, "Turning it off") and decide D1 again;
    nothing at the apex was changed by the call.
  - Refused, path (a): the owner may onboard the apex `piloti.at`, which
    receives no mail today. Its apex then gets Cloudflare's MX, SPF and DKIM
    records and refuses every address with no rule. Record the decision, call
    the PATCH again, and run `g0` with `INBOUND_MAIL_APEX_MX=cloudflare`.
- [ ] **The test office (D2):** WorkOS dashboard (production) → Feature Flags →
  `inbound-mail` → target the test organization only. Its sessions see it at
  their next token refresh, the webhook within 30 s. A manager of the test
  project: Einstellungen › Dokumente → „Adresse erzeugen“, then copy the address.

## 8a. Dev first

Dev runs §5 to §8 before prod, with these values in place of prod's. Its mail
block is at the end of `Pulumi.dev.yaml`, commented, in the same three promotions.

| | dev | prod |
|---|---|---|
| Stack, ESC environment | `STACK=matthiasbigl/$P/dev`; `ENV` read from `Pulumi.dev.yaml` | as §3 |
| Receiving domain | `inbox.dev.piloti.at` | `inbox.archos.tech` |
| `inboundMailZoneId` | `66de14f8d07a729634f5d230418bb907` (piloti.at) | `31df51fbdd7ea2d7ef63bcaab9a09559` (archos.tech) |
| Worker | `inbound-mail-dev` | `inbound-mail-prod` |
| Operator mailbox | `matthias.bigl+mail-dev@archos.tech` (its own destination address) | `matthias.bigl+mail-prod@archos.tech`; DMARC reports to `matthias.bigl+dmarc@archos.tech` |
| `_dmarc` | piloti.at's, written by prod's `dnsDmarc`; no `inboundMailDmarc` on dev | `inboundMailDmarc` on archos.tech |
| `INBOUND_MAIL_APEX_MX` for G0 | `none` | `smtp.google.com` |
| WorkOS | Staging: `inbound-mail` for your own organization | Production: your own organization first, every office after §8 |
| Subaddressing call (§7) | on the piloti.at zone | on the archos.tech zone |

Dev's signing key is its own (§5 with dev's `ENV`), never prod's. Dev passes
G0 to G7 before prod's promotion 2.

## 8. The launch gates, as a test protocol

Set up once, in the shell of §3 (in `deploy/pulumi`, with `P`, `ENV` and `STACK`
set), and close it afterwards:

```bash
export CLOUDFLARE_API_TOKEN=<the read-only token of §4>
export INBOUND_MAIL_ZONE_ID=<the D1 zone id>        # (a): the prod stack's dnsZoneId
export INBOUND_MAIL_ACCOUNT_ID=<the Cloudflare account id>   # dashboard → the account → Overview
export INBOUND_MAIL_DOMAIN=inbox.<domain>
export INBOUND_MAIL_WORKER=inbound-mail-prod         # the stack output inboundMailWorker, without " (paused)"
export INBOUND_MAIL_APP_ORIGIN=$(pulumi stack output appUrl --stack "$STACK")
export INBOUND_MAIL_TEST_ADDRESS=<the test project's address>
export INBOUND_MAIL_KEY_ID=<the keyid of step 5>
export INBOUND_MAIL_SIGNING_KEY=$(pulumi config get inboundMailSigningKeys --stack "$STACK" | jq -r --arg k "$INBOUND_MAIL_KEY_ID" '.[$k]')
export INBOUND_MAIL_APEX_MX=<(a): none, (b): smtp.google.com>
export INBOUND_MAIL_DMARC="$(pulumi config get inboundMailDmarc --stack "$STACK")"   # (a): dnsDmarc instead
bun scripts/inbound-mail-smoke.ts plan                # every gate's steps; sends nothing
```

Exit status of every command: 0 when its automated checks passed, 1 when one
failed, 2 for a missing input. A `MANUAL` line is never a pass: do it and record
it. Record every run (date, commit, result) in `kubernetes.md` §3c, "Record of
runs".

### Phase A: paused

| Gate | Do | Expect | If not |
|---|---|---|---|
| **G0** | `bun scripts/inbound-mail-smoke.ts g0`, then send the mail it prints (to `project+smoke.aaaaaaaaaaaa@inbox.<domain>`) from your own mailbox | Every line PASS: the subdomain's MX are Cloudflare's, the apex's are unchanged, `support_subaddress=true`, the rule `project@inbox.<domain>` → `inbound-mail-prod`, the two forwards, their destination verified, no other rule, exactly one DMARC record at `_dmarc.<apex>` and it is `INBOUND_MAIL_DMARC`. The mail: **no bounce**; hours later your server reports a delay (the paused Worker threw, a temporary failure). Email Routing → Activity log lists it against the rule | MX of the subdomain missing: wait for DNS, re-run. Apex MX changed: someone onboarded the apex; on (b) restore Google's MX at once. `support_subaddress=false`: §7's PATCH. Forward destination not verified: the click of §7. Two DMARC records: someone added one by hand (the preview refuses that on the next deploy); delete the one that is not `inbound-mail-dmarc`. An immediate bounce "Address does not exist": subaddressing does not reach the subdomain's rule, **stop**, risk B2, fallback. A bounce "Unknown address: this message was not delivered.": the Worker's `ADDRESS_*` bindings differ from the address you typed |
| **G4**, first half | `bun scripts/inbound-mail-smoke.ts signed --run --expect-paused`; and one real mail to the test address | `unsigned request refused` and `unknown key refused` PASS (401), `paused: a signed mail is a retry` PASS (503). The real mail is delayed, not bounced | 503 missing: the frontend has not rolled out `INBOUND_MAIL_PAUSED`; `kubectl -n grid rollout status deploy/frontend` |
| **G7** | `bun scripts/inbound-mail-smoke.ts cloudflare` (also run by every deploy, in the job summary) | All PASS, including `Workers invocation logs off` and `Worker bindings` (all seven, the key a secret) | A binding edited in the dashboard: never fix it there; `pulumi up` restores it from state |
| **G8** | the same run's `compatibility date` line | INFO only. After any later `COMPATIBILITY_DATE` bump in `src/platform/inbound-mail.ts`: G1 and G2 again | — |

### Unpause (promotion 3)

Only the test office has the entitlement, so unpausing exposes no customer.

- [ ] Set `inboundMailPaused: "false"` in the block, merge, promote, approve
  (**one-way door**). Within minutes the Worker's `PAUSED` binding is `false`
  (`cloudflare` shows `PAUSED=false`) and the frontend rolls out.

### Phase B: live, test office only

| Gate | Do | Expect | If not |
|---|---|---|---|
| **G4**, second half | wait for G4's real mail | It arrives in the test project when the sending server retries (minutes to an hour) | Check the Activity log and section 10 |
| **G1** | From a mailbox of a domain that signs DKIM (the company's Google Workspace does), send a mail with one PDF to the test address. Once from a member of the test project with write rights, once from someone outside the office | The member's mail is **filed directly**: its text in an E-Mail-Verlauf, the PDF in the suggested folder; the member gets the notice „Ihre E-Mail an „…“ wurde direkt abgelegt“, „Niemand hat sie angesehen: …“ (`inbound_mail.decided`, variant `direct`). The outsider's waits in the E-Mail-Eingang, „Domain bestätigt“ (`*_verified`), with the signed headers in its details | Waits although sent by a writer: open its details; the sender rule (`inbound-mail.md`, "The sender rule") names the reason, usually a domain that does not sign or a Bcc to someone else |
| **G2** | Dashboard: Workers & Pages → Create → a Worker whose code is `export default { async email() { throw new Error("gate"); } }`. Email Routing → Routing rules → Create address: **the test address itself** → Send to a Worker → that Worker (a rule for the full subaddress wins over the base rule). Send a mail to the test address. Then delete that rule, and later the throwaway Worker | The sender's server reports a temporary failure and retries; after the rule is deleted the retry lands in the test project | A permanent bounce: Cloudflare turned a thrown error into a 5xx. Stop: every fault of ours would lose mail (ADR-0138, "Known unknowns") |
| **G3** | `bun scripts/inbound-mail-smoke.ts signed --run`; and through real SMTP the largest mail your provider sends (Google Workspace: one attachment of about 18 MB) | All PASS: 401s, a small mail and 24 MiB held (202), over 26 MiB a 413 bounce, over the edge ceiling Envoy's own 413, a truncated body never accepted. The real mail arrives | A FAIL names the check and the HTTP answer; `[inbound-mail] delivery outcome=…` in the frontend's log says why the BFF refused |
| **G3**, the refusal | Optional: a mail over 26 MiB from a provider that sends one (Microsoft 365 with a raised limit) | Refused by Cloudflare at SMTP time ("message too large") | If no provider is at hand, record "not run: Cloudflare's documented 25 MiB cap, and `signed` covered the BFF" |
| **G5** | Right after G3's large mail: dashboard → Workers & Pages → `inbound-mail-prod` → Metrics, the time of that mail | CPU time for that invocation well under the plan's limit, no `exceededCpu`, no memory error | **Stops the launch**: no fallback drops the digest (ADR-0138) |
| **G6** | `bun scripts/inbound-mail-smoke.ts malware --run`, then open the test project's E-Mail-Eingang | Both probes held (`[smoke] EICAR`, `[smoke] limit-exceeding archive`); the EICAR part „infected“, the archive's „failed“, never clean; neither can be filed; the EICAR mail's original download refused. On the dev stack: freshclam stopped for 49 h (or an old database) gives `failed` (`stale-signatures`) | A `clean` verdict on either: **stop**; read ADR-0157's known gap (a zip member over `MaxFileSize` scans clean) before judging |
| **G9** | Any time, offline: the pilot office (D4) exports a few hundred messages of project mail as `.eml` files or an `.mbox` (Outlook: drag to a folder; or Thunderbird's export), then `bun scripts/inbound-mail-smoke.ts dkim-share <dir-or-mbox>` | A number, not a pass: the aligned DKIM share is the share of their correspondents whose mail will read „Domain bestätigt“ and can be followed | Record it; tell the pilot office what it means before O7 |

Afterwards: dismiss every `[smoke]` mail in the test project, and check that
`cloudflare` passes again (no G2 rule left).

## 9. Launch, per office (owner gate O7)

Per office, only after the Datenschutzberater's sign-off and the customer
notice (Cloudflare as a transit processor: [`docs/compliance/inbound-mail-review-2026-10.md`](../compliance/inbound-mail-review-2026-10.md)),
and only once the Worker's `LANDING_URL` binding names the website (B1):

- [ ] WorkOS → Feature Flags → `inbound-mail` → add the office's organization.
- [ ] Tell the office: section 11 below is what they get.

## 10. Operating it

**What to watch**

| Where | What | Healthy |
|---|---|---|
| PostHog, `inbound_mail_received` | mail held, by `sender_class` (`verified_writer`, `unverified_writer`, `office_member`, `external`) and `sender_trust` | arrives on working days |
| PostHog, `inbound_mail_refused` | refusals by `reason` ([`posthog-events.md`](../observability/posthog-events.md)) | `unknown_address`, `too_large`, `switched_off` are senders' errors (bounces); `paused`, `misconfigured`, `body_truncated`, `bad_digest`, `unavailable`, `rate_limited`, `cap_reached` are ours (retries): any steady count is an incident |
| PostHog, `inbound_mail_decided` | `via` (`sender` = filed directly, `app`, `agent`, `follow`), `left` (parts left waiting for the project's writers) | `via: sender` grows with offices whose domain signs |
| PostHog, `inbound_mail_dropped` | auto-replies and delivery reports | a trickle |
| Frontend log | `[inbound-mail] delivery outcome=… org=… address=… mail=… bytes=… ms=…` per delivery; `[inbound-mail] request signature refused reason=…` | no `bad-signature` (a key or `BFF_URL` mismatch), no `body-truncated`, no `unavailable` |
| WorkOS audit log | `inbound_mail.received`, `.decided`, `.expired`, `.part_read`, `.original_read`; `inbound_mail_address.created`, `.rotated`, `.deleted`; `mail_thread.*` | who read and filed what, per office |
| Langfuse | the suggestion's `filing-fit` generations (`surface: inbound_mail`), the decision score with subject `inbound_mail_suggestion`, `mail-thread-match` | acceptance of the agent's suggestions |
| Cloudflare | Email Routing → Activity log (per message: Handled, Rejected, Error); Workers → `inbound-mail-prod` → Metrics (errors, CPU) | Rejected only for senders failing SPF/DKIM/DMARC; Errors only while paused |
| `bff-jobs` log | `[inbound-mail] mail <id>: the <dependency> did not answer (<n> of <budget>)`, one per wait: the receive job waits a WorkOS, reader, object-store or database fault out over about six hours (budget 11), DNS for DKIM over twelve minutes (budget 2); `mail <id>: the verifier threw` is a mailauth exception on that message, held unverified at once | none outside an outage. `dkim_dns` from one sender domain only is that domain's nameserver, not ours. An object store that answers 4xx is no fault and spends the job's attempts instead ([`inbound-mail.md`](../architecture/inbound-mail.md)) |
| `bff-jobs` log, `inbound-mail-sweep` | `[scheduling] project mail …`, one line per sweep that acted; a run that failed is in Hatchet's dashboard as `inbound-mail-sweep` with `sweep-failed: <class>`, the whole error in the pod's log as `[scheduling] inbound-mail-sweep failed:` | `rereads … deferred <n>` above 0 means the reader is slow: sweep 15 reads five texts within 45 s a run |

Alert when no `inbound_mail_received` arrives for 24 h on working days once
offices use it.

**Direct filing off** (the first lever, when a member's mail is filed that
should not have been, or a sender's filing goes wrong):
`inboundMailDirectFiling: "false"`, promote. Mail is still received. A
verified writer's mail keeps its class, but no sender's filing is queued for
it: it waits in the E-Mail-Eingang for any of the project's writers, as all
mail did before direct filing, saying „Die direkte Ablage ist ausgeschaltet“
(wait reason `paused`), and its sender, who may file it like any writer, is
told it waits. A sender's filing
already queued files nothing. It is never stricter than before: colleagues can
file the mail of a member on holiday or gone. Switched back on, what was held
meanwhile keeps waiting for the writers; it is not filed retroactively, except
a mail whose failed scan or unread text a sweep finishes after that (sweeps 7
and 15 queue its sender's filing again, under the rule as it then stands).
PostHog `inbound_mail_sender_filed` with `reason: direct_filing_off` counts
those mails ([`kubernetes.md`](kubernetes.md#incidents), incident 0).

**Pause** (the incident lever after that): `inboundMailPaused: "true"` in the stack file,
promote. The Worker answers every project mail address with a temporary failure as
soon as Cloudflare has the binding; the BFF answers 503. Senders see nothing at
first, then their server's "delayed" notice after some hours, and a bounce only
when their server gives up (typically after two to five days). Keep a pause
shorter than that. Nothing is lost while paused.

**One office off**: remove its organization from `inbound-mail` in WorkOS.
Within 30 s its addresses bounce as unknown; what is held stays held.

**Turning it off** (the managed off): `inboundMailEnabled: "false"`, promote.
The rule is updated to disabled, so Cloudflare refuses every address at SMTP
time ("Address does not exist"; never Drop, which would accept and discard), the
Worker is deleted after, the frontend loses `INBOUND_MAIL_DOMAIN` and shows
„Diese Installation empfängt keine E-Mails.“ Held mail stays. `postmaster@`
and `abuse@` keep forwarding, and the DMARC record stays: the domain still has
its MX at Cloudflare.

**Full removal**, in this order, each step applied before the next:
1. `inboundMailEnabled: "false"`, promote (above).
2. Comment out `inboundMailDomain`, `inboundMailZoneId`, `inboundMailOperatorAddress`,
   `inboundMailDmarc`, `inboundMailPaused` and `inboundMailEnabled` (`loadConfig`
   refuses `inboundMailDmarc` without the domain); remove the key from ESC
   (`esc env rm "matthiasbigl/$ENV" "pulumiConfig.$P:inboundMailSigningKeys"`); promote. Pulumi
   deletes the project rule, the two forwards and the DMARC record. Kept
   (`retainOnDelete`): Email Routing on the subdomain, and the operator's
   destination address, which is the account's and may serve other zones.
   On path (b), if the domain cutover has not given `archos.tech` a `dnsDmarc`
   yet, the zone is then without DMARC: set it there first if it should stay.
3. Dashboard: remove the subdomain under Email Routing → Settings (its MX and
   TXT go with it); `PATCH …/email/routing` with `{"support_subaddress":false}`
   (the call of §7) if nothing else in the zone uses it; delete the destination
   address if no other rule forwards to it.
4. Remove the token's added scopes; downgrade Workers Paid if nothing else needs it.
5. Data stays until its retention sweeps erase it. Reversing migration 0196
   needs every staged object and kept original erased first
   ([`schema.md`](../database/schema.md#reversing-0196)).

The scanner may stay on; it costs a pod and serves nothing else today.

**Rotate the signing key** (a leak, or yearly): add the successor to the same
ESC value (`{"<old>":"…","mi-<new month>":"<openssl rand -base64 32>"}`, two
entries at most), set `inboundMailSigningKeyId: <new>` in the stack file,
promote; then remove the old entry and promote again. The BFF accepts both in
between. Never edit the Worker's binding in the dashboard.

**Rotate a project's address** (it leaked, or spam): a manager, Einstellungen ›
Dokumente → „Neue Adresse erzeugen …“ (or the operation
`inbound-mail-address-rotate`). The old address bounces at once, every follow on
the project ends, held mail stays. „Ausschalten …“ switches the address off
without a successor.

**"My mail didn't arrive"**, in this order:
1. **Did the sender get a bounce?** Ask for its text.
   - "This message could not be delivered: the address is unknown or no longer
     valid. Help: {site}/e-mail-eingang/ Privacy: {site}/datenschutz/", where
     `{site}` is the website, `LANDING_URL` (`https://<webDomain>`; without one
     the text ends after "valid."): the
     address is mistyped, rotated, switched off, its project deleted, or the
     office lacks `inbound-mail`. Compare with the address the project shows
     now. The help page's "abgewiesen" section says the same to the sender.
   - "Address does not exist": no rule matched (the feature is off, or a typo
     before the `+` or in the domain).
   - "Unknown address: this message was not delivered.": not project-shaped
     (the 12-character token is cut or changed).
   - "Message too large" or similar: over 25 MiB as sent.
   - A rejection naming SPF, DKIM or DMARC: Cloudflare refused it (B3).
   - No bounce and only a delay notice: we are paused or failing; their server retries.
2. **Cloudflare → Email Routing → Activity log**, filtered by the recipient and
   time: Handled (reached the Worker), Rejected (authentication), Error (the
   Worker threw: a retry), nothing at all (it never reached Cloudflare: the
   sender's side).
3. **PostHog** `inbound_mail_refused` / `inbound_mail_received` / `inbound_mail_dropped`
   for the office (`organization_id`) and time; the frontend's
   `[inbound-mail] delivery outcome=` line for the same minute.
4. **In the project**: it may be filed already (the sender's own signed mail is
   filed directly into an E-Mail-Verlauf, with a notice to them), waiting in the
   E-Mail-Eingang, or folded under „Domain nicht bestätigt oder automatisch“.
   Waiting mail from outside the office expires after 14 days; dismissed and
   expired parts can be restored for 7 days (an outsider's expired mail cannot).
5. An auto-reply or a delivery report is dropped on purpose (`inbound_mail_dropped`).

## 11. What the customer sees (for support)

**The address.** Each project of an office with the feature can have one:
`project+<project name>.<12 characters>@inbox.<domain>`. A manager creates it
under Einstellungen › Dokumente („Adresse erzeugen“), and may replace it („Neue
Adresse erzeugen …“: the old one stops at once) or switch it off. Everyone who
may decide the project's mail sees it on the project overview („E-Mail-Adresse
des Projekts“, with „Kopieren“ and „Als Kontakt sichern“) and in the upload
menu („Per E-Mail senden …“). The intended use: put it in Cc when writing to an
authority, the structural engineer or the client, and forward documents to it.

**Size.** Up to 25 MB per mail as sent, so about 18 MB of attachments
(„Bis 25 MB pro E-Mail, Anhänge zusammen bis etwa 18 MB.“). Larger files are
uploaded directly; a larger mail bounces at the sender.

**Filed directly, without a click:** a mail sent by a member who may write in
the project, from their own address, signed by their domain (an aligned DKIM
signature: Google Workspace and Microsoft 365 with DKIM switched on do this),
addressed to the project in its signed To or Cc (their own Bcc copy waits for
them), not an automatic mail, and without a suspicious date or a reused
Message-ID. Its text becomes the next
section of the conversation's E-Mail-Verlauf, its attachments go where the
agent suggests (or become the next Fassung of a document the sender vouched
for); anything that cannot be placed waits in the E-Mail-Eingang for any of
the project's writers, marked „Nicht direkt abgelegt“. The member is told
„Ihre E-Mail an „…“ wurde direkt abgelegt“, „Niemand hat sie angesehen: Ihre
Domain hat sie bestätigt, und Sie dürfen in diesem Projekt ablegen.“

**Held for a person** in the project's E-Mail-Eingang (Dateien → E-Mail-Eingang):
- a member's mail that is not signed by their own domain, is their Bcc copy,
  reads as re-sent or misdated, or is automatic: only that member may file it
  („Haben Sie diese E-Mail gesendet?“), anyone may dismiss it, for 30 days;
- a member's mail who may not write in the project: for the project's writers, 30 days;
- everyone else's: for the project's writers, 14 days, then discarded.
Five days before a mail runs out, the people it waits for are reminded.
Dismissed parts can be restored for 7 days, except mail from an unconfirmed
domain outside the office, which is erased at once; an outsider's mail that
ran out is not restored. A person may „Verlauf folgen“, so
that later replies' text is appended without a click, for 60 days.

**Notices** are in the app and as push, never by e-mail. The sender is never
answered: no receipt, no auto-reply, no notice; nobody outside the office hears
anything.

**Refused at the door:** an unknown, replaced or switched-off address, a project
that was deleted, an office without the feature (a bounce with one neutral
text); a mail over the size limit; a mail whose domain fails its own DMARC
policy or has neither SPF nor DKIM (refused by Cloudflare). Auto-replies and
delivery reports are dropped silently.

**Safety.** Every attachment and the whole mail are scanned for malware in our
own cluster before anyone can file or download them; an infected part can only
be dismissed. Mail text is shown as text: no HTML, no images loaded, links inert.
A mail that carries a member's address but is not signed by their domain is
marked and can only be filed or restored by that member.
