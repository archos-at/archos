# Project mail to production: the owner's runbook

One document, top to bottom, from "off" to "an office receives project mail".
Every step says what to do, how to see that it worked, and what to do when it did
not. Steps marked **one-way door** change production, money or a vendor account
and are the owner's to run; everything else is read-only or reversible.

Why it is built this way: [ADR-0138](../adr/0138-project-mail-arrives-through-cloudflare-email-routing-and-a-signed-worker.md)
(transport), [ADR-0137](../adr/0137-mail-sent-to-a-project-waits-until-a-person-files-it.md)
(holding and filing), [ADR-0150](../adr/0150-attachments-from-outside-are-scanned-in-cluster-by-clamav.md)
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

## 0. Before you start: what this runbook cannot fix

| # | Open item | Effect | What closes it |
|---|---|---|---|
| B1 | **Closed 2026-11-03: the help and privacy links follow the website's host.** The brand rename had replaced the real host with `https://example.org` (commit `5b1b6005c`). The bounce text is now a template (`rejectText` in `contracts/inbound-mail-contract.json`) that the Worker and the BFF fill with `LANDING_URL`, `https://<webDomain>` from Pulumi (`webOrigin` in `deploy/pulumi/src/config/ingress.ts`), and the UI's „Anleitung“ links take the same origin from the server (`AppConfig.publicSiteUrl`). The domain cutover moves all three with the stack's `webDomain` | Before the fix, a sender who mistyped an address was sent to `example.org`. Now, with `LANDING_URL` unset or malformed, the bounce says the same without links and the dialog shows no „Anleitung“: a refusal never turns into a retry | Nothing. Check once after the first promote: the Worker's `LANDING_URL` binding in Cloudflare (Workers → the inbound-mail Worker → Settings → Variables) is the website's origin |
| B2 | **G0 is unproven.** Cloudflare documents adding a subdomain to Email Routing from the *apex's* Email Routing settings, and onboarding an apex whose MX belong to another provider fails with error 2008 ("Non-Cloudflare MX records exist"). Pulumi enables the subdomain through the API (`email/routing/dns` with the subdomain's name), which is not documented to need the apex; the subaddressing switch exists only in the dashboard | If the subdomain cannot be routed, or subaddressing cannot be switched on, without onboarding the apex, path (b) below is blocked | Step 7 and gate G0 prove it on the real zone. The fallback, a dedicated mail-only domain with an apex catch-all, is a code change (the address grammar, the Worker's shape check, the parser and the Pulumi rule; ADR-0138, "The fallback") |
| B3 | **Cloudflare refuses mail that passes neither SPF nor DKIM, and mail that fails the sender's DMARC policy** (Cloudflare Email Service, "Postmaster" → "Mail authentication requirement", required since 2025-07-03). ADR-0138's table says any sender is accepted and held; at Cloudflare that holds only for senders that authenticate | A small office or authority whose domain publishes neither SPF nor DKIM gets a bounce from Cloudflare, before the product sees the mail | Nothing in the product. Support says so (section 11) |

## 1. Facts as of 2026-11-03

Read with `dig` or DNS over HTTPS on 2026-11-03; `scripts/inbound-mail-smoke.ts g0`
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

In the product today: no stack sets `inboundMailDomain`; prod has
`malwareScanEnabled` unset (off); the WorkOS entitlement `inbound-mail` exists
OFF for every organization in both environments (owner gate O1, 2026-10-27).

## 2. Decisions to make first

**D1, the receiving domain.** An address lives as long as the domain does: a
project's address is printed in letters, saved in contacts and set in Cc by
authorities, and the product has no alias for a former domain, so moving the
domain later stops every address (each project gets a new one; the old ones bounce).

| | (a) `inbox.piloti.at` | (b) `inbox.archos.tech` |
|---|---|---|
| Config | `inboundMailDomain` only: the stack's own zone, no zone id, no new token zone | `inboundMailDomain` and `inboundMailZoneId` (the brand zone's id); the token gains that zone |
| Risk B2 | Low. The apex has no MX, so even a forced apex onboarding would succeed and take no one's mail; the owner may accept that (step 7, path a) | The real test. The apex's MX are Google's: never onboard the apex. If G0 fails here, the fallback is code |
| Lifetime | Ends at the domain cutover: every project address changes then | Survives the cutover |
| Sender's view | The retired domain in every address | The brand in every address |

Recommendation: **(b)**, if step 7 can switch subaddressing on without touching
the apex. If it cannot, decide between (a) with a planned address change at the
cutover and the fallback's code change. Write the choice into the record of runs
in `kubernetes.md` §3c.

**D2, the test office.** One WorkOS organization in production that is yours
(the company's own office), with one project, to receive every probe. Its
manager creates the address; nobody outside the company may hold it.

**D3, the operator mailbox.** The address `postmaster@` and `abuse@` of the
receiving domain forward to (RFC 2142), on the company's own mail, e.g. a Google
group. It must be verified in Cloudflare (step 1).

**D4, the pilot office.** The first customer office (gate O7), and one of its
people who can export a few hundred messages of real project mail for G9.

## 3. Accounts and plans

- [ ] **Cloudflare Workers Paid** on the account that owns the zone (owner gate
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

## 4. Cloudflare: tokens, destination address, subaddressing

- [ ] **The deploy token's scopes.** The prod stack already holds
  `cloudflareApiToken` (in ESC) for its DNS. Cloudflare → My Profile → API Tokens
  → that token → Edit, and add (editing keeps the token's value):
  - Zone · Zone Settings · Edit (enabling routing on the subdomain)
  - Zone · Email Routing Rules · Edit (the one rule)
  - Zone · Zone · Read (the zone check and the account id)
  - Zone · DNS · Edit (routing writes and locks the subdomain's MX and TXT; the MX guard reads them)
  - Account · Workers Scripts · Edit, with the account listed under the
    token's **Account Resources** (a token scoped to zones alone lacks it)
  - Zone Resources: the zone of D1 (for (b), add `archos.tech` beside the existing zone).

  The source of this list: `deploy/pulumi/src/platform/inbound-mail.ts`,
  "Cloudflare API token scopes".
- [ ] **A read-only token for the gates**, separate from the deploy token:
  Zone · Zone · Read, Zone · Zone Settings · Read, Zone · Email Routing Rules ·
  Read, Zone · DNS · Read on the D1 zone, and Account · Workers Scripts · Read.
  The smoke tool never writes; a 403 names the path it could not read.
- [ ] **The operator mailbox (D3) as a destination address.** Dashboard →
  Email Routing (account level) → Destination addresses → Add, then open the
  verification mail and confirm. Destination addresses belong to the account
  and can be verified before anything is routed.
- [ ] **Subaddressing, first attempt.** Dashboard → the D1 zone → Email Routing
  → Settings → Subaddressing: on. If the page offers only "Get started" /
  "Onboard domain" / "Add records and enable" for the apex, **do not click it**:
  on `archos.tech` that onboarding either fails with error 2008 or, in the flow
  that offers to delete the existing MX, takes the company's mail away from
  Google. Leave it, carry on, and come back in step 7.

## 5. Secrets

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
(`grid-app-migrate`, `drizzle-kit migrate`; this image brings 0192–0195:
`upload_batch_effects`, `inbound_mail`, `sender_class`, `original_author`), the
WorkOS audit-schema Job and the authorization-catalog Job (`grid-app-authz-catalog`).

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
  uncomment **either** the (a) line **or** the two (b) lines (and replace the
  zone-id placeholder with the brand zone's id: Cloudflare → `archos.tech` →
  Overview → API), and the `inboundMailPaused: "true"` line. Merge to `develop`;
  `stack-files.spec.ts` fails the PR if the scanner line is not on, or if
  another stack claims the same zone.
- [ ] Promotion PR, then `npm run preview` on its commit. Expect exactly:
  `inbound-mail-routing` (`cloudflare:EmailRoutingDns`, on the subdomain),
  `inbound-mail-worker` (`cloudflare:WorkersScript`, `inbound-mail-prod`),
  `inbound-mail-rule` (`cloudflare:EmailRoutingRule`, `project@inbox.<domain>`
  → the Worker), and `INBOUND_MAIL_DOMAIN`, `INBOUND_MAIL_LOCAL_PART`,
  `INBOUND_MAIL_PAUSED=true`, `INBOUND_MAIL_SIGNING_KEYS` on the frontend (a
  rolling restart). The preview **fails** and changes nothing if: the key map is
  malformed (step 5), the token lacks a scope, the zone id names another zone,
  or the subdomain already has MX pointing anywhere but `*.mx.cloudflare.net`.
- [ ] **One-way door:** merge and approve `Pulumi up (prod)`. If the apply fails
  at `inbound-mail-routing` with error 2008 or a message about the apex, risk
  B2 has happened: nothing was routed, the apex is untouched; stop and decide D1
  again.
- [ ] **Subaddressing, second attempt** (if step 4's failed): dashboard → the
  zone → Email Routing. With the subdomain now routed, Settings may open without
  onboarding the apex. Switch Subaddressing on.
  - Still only an onboarding offer, path (b): **stop**, do not onboard
    `archos.tech`. Turn the feature off (section 8, "Turning it off") and decide
    D1 again.
  - Still only an onboarding offer, path (a): the owner may onboard the apex
    `piloti.at`, which receives no mail today. Its apex then gets Cloudflare's
    MX, SPF and DKIM records and refuses every address with no rule. Record the
    decision and run `g0` with `INBOUND_MAIL_APEX_MX=cloudflare`.
- [ ] **The RFC 2142 rules.** Email Routing → Routing rules → Create address:
  `postmaster@inbox.<domain>` → Send to an email → the D3 mailbox; the same for
  `abuse@inbox.<domain>`. These are the only rules besides Pulumi's.
- [ ] **The test office (D2):** WorkOS dashboard (production) → Feature Flags →
  `inbound-mail` → target the test organization only. Its sessions see it at
  their next token refresh, the webhook within 30 s. A manager of the test
  project: Einstellungen › Dokumente → „Adresse erzeugen“, then copy the address.

## 8. The launch gates, as a test protocol

Set up once, in the shell of §3 (in `deploy/pulumi`, with `P`, `ENV` and `STACK`
set), and close it afterwards:

```bash
export CLOUDFLARE_API_TOKEN=<the read-only token of step 4>
export INBOUND_MAIL_ZONE_ID=<the D1 zone id>        # (a): the prod stack's dnsZoneId
export INBOUND_MAIL_ACCOUNT_ID=<the Cloudflare account id>   # dashboard → the account → Overview
export INBOUND_MAIL_DOMAIN=inbox.<domain>
export INBOUND_MAIL_WORKER=inbound-mail-prod         # the stack output inboundMailWorker, without " (paused)"
export INBOUND_MAIL_APP_ORIGIN=$(pulumi stack output appUrl --stack "$STACK")
export INBOUND_MAIL_TEST_ADDRESS=<the test project's address>
export INBOUND_MAIL_KEY_ID=<the keyid of step 5>
export INBOUND_MAIL_SIGNING_KEY=$(pulumi config get inboundMailSigningKeys --stack "$STACK" | jq -r --arg k "$INBOUND_MAIL_KEY_ID" '.[$k]')
export INBOUND_MAIL_APEX_MX=<(a): none, (b): smtp.google.com>
bun scripts/inbound-mail-smoke.ts plan                # every gate's steps; sends nothing
```

Exit status of every command: 0 when its automated checks passed, 1 when one
failed, 2 for a missing input. A `MANUAL` line is never a pass: do it and record
it. Record every run (date, commit, result) in `kubernetes.md` §3c, "Record of
runs".

### Phase A: paused

| Gate | Do | Expect | If not |
|---|---|---|---|
| **G0** | `bun scripts/inbound-mail-smoke.ts g0`, then send the mail it prints (to `project+smoke.aaaaaaaaaaaa@inbox.<domain>`) from your own mailbox | Every line PASS: the subdomain's MX are Cloudflare's, the apex's are unchanged, `support_subaddress=true`, the rule `project@inbox.<domain>` → `inbound-mail-prod`, the two forwards, no other rule. The mail: **no bounce**; hours later your server reports a delay (the paused Worker threw, a temporary failure). Email Routing → Activity log lists it against the rule | MX of the subdomain missing: wait for DNS, re-run. Apex MX changed: someone onboarded the apex; on (b) restore Google's MX at once. `support_subaddress=false`: step 7. An immediate bounce "Address does not exist": subaddressing does not reach the subdomain's rule, **stop**, risk B2, fallback. A bounce "Unknown address: this message was not delivered.": the Worker's `ADDRESS_*` bindings differ from the address you typed |
| **G4**, first half | `bun scripts/inbound-mail-smoke.ts signed --run --expect-paused`; and one real mail to the test address | `unsigned request refused` and `unknown key refused` PASS (401), `paused: a signed mail is a retry` PASS (503). The real mail is delayed, not bounced | 503 missing: the frontend has not rolled out `INBOUND_MAIL_PAUSED`; `kubectl -n grid rollout status deploy/frontend` |
| **G7** | `bun scripts/inbound-mail-smoke.ts cloudflare` | All PASS, including `Workers observability off` and `Worker bindings` (all six, the key a secret) | A binding edited in the dashboard: never fix it there; `pulumi up` restores it from state |
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
| **G1** | From a mailbox of a domain that signs DKIM (the company's Google Workspace does), send a mail with one PDF to the test address. Once from a member of the test project with write rights, once from someone outside the office | The member's mail is **filed directly**: its text in an E-Mail-Verlauf, the PDF in the suggested folder; the member gets the notice „Ihre E-Mail an „…“ wurde abgelegt“, „Direkt in Ihrem Namen abgelegt, …“ (`inbound_mail.decided`, variant `direct`). The outsider's waits in the E-Mail-Eingang, „Domain bestätigt“ (`*_verified`), with the signed headers in its details | Waits although sent by a writer: open its details; the sender rule (`inbound-mail.md`, "The sender rule") names the reason, usually a domain that does not sign or a Bcc to someone else |
| **G2** | Dashboard: Workers & Pages → Create → a Worker whose code is `export default { async email() { throw new Error("gate"); } }`. Email Routing → Routing rules → Create address: **the test address itself** → Send to a Worker → that Worker (a rule for the full subaddress wins over the base rule). Send a mail to the test address. Then delete that rule, and later the throwaway Worker | The sender's server reports a temporary failure and retries; after the rule is deleted the retry lands in the test project | A permanent bounce: Cloudflare turned a thrown error into a 5xx. Stop: every fault of ours would lose mail (ADR-0138, "Known unknowns") |
| **G3** | `bun scripts/inbound-mail-smoke.ts signed --run`; and through real SMTP the largest mail your provider sends (Google Workspace: one attachment of about 18 MB) | All PASS: 401s, a small mail and 24 MiB held (202), over 26 MiB a 413 bounce, over the edge ceiling Envoy's own 413, a truncated body never accepted. The real mail arrives | A FAIL names the check and the HTTP answer; `[inbound-mail] delivery outcome=…` in the frontend's log says why the BFF refused |
| **G3**, the refusal | Optional: a mail over 26 MiB from a provider that sends one (Microsoft 365 with a raised limit) | Refused by Cloudflare at SMTP time ("message too large") | If no provider is at hand, record "not run: Cloudflare's documented 25 MiB cap, and `signed` covered the BFF" |
| **G5** | Right after G3's large mail: dashboard → Workers & Pages → `inbound-mail-prod` → Metrics, the time of that mail | CPU time for that invocation well under the plan's limit, no `exceededCpu`, no memory error | **Stops the launch**: no fallback drops the digest (ADR-0138) |
| **G6** | `bun scripts/inbound-mail-smoke.ts malware --run`, then open the test project's E-Mail-Eingang | Both probes held (`[smoke] EICAR`, `[smoke] limit-exceeding archive`); the EICAR part „infected“, the archive's „failed“, never clean; neither can be filed; the EICAR mail's original download refused. On the dev stack: freshclam stopped for 49 h (or an old database) gives `failed` (`stale-signatures`) | A `clean` verdict on either: **stop**; read ADR-0150's known gap (a zip member over `MaxFileSize` scans clean) before judging |
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
| PostHog, `inbound_mail_decided` | `via` (`sender` = filed directly, `app`, `agent`, `follow`), `left` (parts left waiting for the sender) | `via: sender` grows with offices whose domain signs |
| PostHog, `inbound_mail_dropped` | auto-replies and delivery reports | a trickle |
| Frontend log | `[inbound-mail] delivery outcome=… org=… address=… mail=… bytes=… ms=…` per delivery; `[inbound-mail] request signature refused reason=…` | no `bad-signature` (a key or `BFF_URL` mismatch), no `body-truncated`, no `unavailable` |
| WorkOS audit log | `inbound_mail.received`, `.decided`, `.expired`, `.part_read`, `.original_read`; `inbound_mail_address.created`, `.rotated`, `.deleted`; `mail_thread.*` | who read and filed what, per office |
| Langfuse | the suggestion's `filing-fit` generations (`surface: inbound_mail`), the decision score with subject `inbound_mail_suggestion`, `mail-thread-match` | acceptance of the agent's suggestions |
| Cloudflare | Email Routing → Activity log (per message: Handled, Rejected, Error); Workers → `inbound-mail-prod` → Metrics (errors, CPU) | Rejected only for senders failing SPF/DKIM/DMARC; Errors only while paused |
| `bff-jobs` log | `[inbound-mail] mail <id>: the <dependency> did not answer (<n> of <budget>)`, one per wait: the receive job waits a WorkOS, reader, object-store or database fault out over about six hours (budget 11), DNS for DKIM over twelve minutes (budget 2); `mail <id>: the verifier threw` is a mailauth exception on that message, held unverified at once | none outside an outage. `dkim_dns` from one sender domain only is that domain's nameserver, not ours. An object store that answers 4xx is no fault and spends the job's attempts instead ([`inbound-mail.md`](../architecture/inbound-mail.md)) |
| Scheduler log | `[job-scheduler] background work sweep, project mail …` | one line per sweep that acted. `rereads … deferred <n>` above 0 means the reader is slow: sweep 15 reads five texts within 45 s a tick |

Alert when no `inbound_mail_received` arrives for 24 h on working days once
offices use it.

**Pause** (the incident lever): `inboundMailPaused: "true"` in the stack file,
promote. The Worker answers every project address with a temporary failure as
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
„Diese Installation empfängt keine E-Mails.“ Held mail stays.

**Full removal**, in this order, each step applied before the next:
1. `inboundMailEnabled: "false"`, promote (above).
2. Comment out `inboundMailDomain`, `inboundMailZoneId`, `inboundMailPaused` and
   `inboundMailEnabled`; remove the key from ESC
   (`esc env rm "matthiasbigl/$ENV" "pulumiConfig.$P:inboundMailSigningKeys"`); promote. Pulumi
   deletes the rule; Email Routing on the subdomain is kept (`retainOnDelete`).
3. Dashboard: delete the `postmaster@` and `abuse@` rules, remove the
   subdomain under Email Routing → Settings (its MX and TXT go with it),
   switch Subaddressing off if nothing else uses it.
4. Remove the token's added scopes; downgrade Workers Paid if nothing else needs it.
5. Data stays until its retention sweeps erase it. Reversing migration 0193
   needs every staged object and kept original erased first
   ([`schema.md`](../database/schema.md#reversing-0193)).

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
addressed to the project (To, Cc, or their own Bcc copy), not an automatic mail,
and without a suspicious date or a reused Message-ID. Its text becomes the next
section of the conversation's E-Mail-Verlauf, its attachments go where the
agent suggests (or become the next Fassung of a document the sender vouched
for); anything that cannot be placed waits for that member. The member is told
„Direkt in Ihrem Namen abgelegt, weil Ihre Domain sie signiert hat und Sie in
diesem Projekt ablegen dürfen.“

**Held for a person** in the project's E-Mail-Eingang (Dateien → E-Mail-Eingang):
- a member's mail that is not signed, or is automatic: only that member may file
  it („Haben Sie diese E-Mail gesendet?“), for 30 days;
- a member's mail who may not write in the project: for the project's writers, 30 days;
- everyone else's: for the project's writers, 14 days, then discarded.
Five days before a mail runs out, the people it waits for are reminded.
Dismissed parts can be restored for 7 days. A person may „Verlauf folgen“, so
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
A mail that claims a colleague's address but is not signed by their domain is
marked and can only be released by that colleague.
