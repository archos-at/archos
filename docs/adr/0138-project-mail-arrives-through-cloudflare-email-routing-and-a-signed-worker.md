---
status: proposed
date: 2026-10-27
amended: 2026-11-03 (the address moves to a subdomain, one literal rule and subaddressing)
decision-makers: product owner, Grid engineering
consulted: the security and shippability red teams of the project-mail design
informed: whoever operates the stack, Cloudflare or the edge
---

# Project mail arrives through Cloudflare Email Routing and a signed Worker; the BFF authenticates the sender

## Context and Problem Statement

ADR-0137 gives every project an address, `p+<slug>.<token>@inbox.<domain>`
(`p+bauplatz-12.k3x7q2m9p4ab@inbox.example.org`), and holds what arrives for a
person to file. Something has to receive SMTP for that domain, decide which
addresses exist, and hand each message to the BFF without letting anyone else
post a mail into an office's review queue.

The agent runs no mail server and should not start: an MX that accepts mail from
the internet is a spam, abuse and deliverability operation of its own. The
product domain's DNS is already at Cloudflare (`kubernetes.md` §3b). The
transport has to keep three properties under a public address: a request the
BFF acts on comes from us, the bytes are the bytes that arrived, and a refusal
bounces only when the mail really cannot be delivered.

The unmerged PR #831 drafted this as its "ADR-0075" (never merged; the number
is taken by another record). This record replaces that draft.

## Decision Drivers

* **Buy the MX.** Receiving SMTP, spam handling at the edge and retries belong
  to a provider.
* **Leave the company's own mail alone.** The product domain's apex MX belongs
  to Google Workspace, which delivers the company's addresses.
* **The webhook is a door into every office's review queue**, so its requests
  are authenticated by a key we hold, and the envelope (who sent, to which
  address) is bound to that authentication.
* **No buffering of unauthenticated bodies** in front of the BFF: a 26 MiB body
  in Envoy or Next's proxy, before anyone checked the signature, is a memory
  exhaustion of the edge for the whole product.
* **Bounce only what is permanent.** A bounce loses the mail; a temporary
  failure makes the sending server retry for days. Every fault of ours must be
  a retry.
* **Decide in the BFF**, where it is tested and audited: which address exists,
  which office has the feature, who the sender is.
* **We never originate mail**: no receipt, no auto-reply, no decline notice.

## Considered Options

* **Receiver:** Cloudflare Email Routing with an Email Worker / a transactional
  mail provider's inbound webhook (Postmark, SendGrid, Mailgun) / our own MTA
  (Postfix, Haraka) in the cluster.
* **Worker-to-BFF authentication:** RFC 9421 HTTP Message Signatures with an
  RFC 9530 Content-Digest / Standard Webhooks (an HMAC over the body with an id
  and a timestamp) / the shared internal token.
* **Sender authentication:** in the BFF from the raw message with mailauth /
  trust the receiver's verdict.

## Decision Outcome

Chosen: **Cloudflare Email Routing with one dependency-free Email Worker, RFC
9421 signatures over a Content-Digest, and DKIM and DMARC verified in the BFF
with mailauth 8.**

### The path

```text
sender MTA ──SMTP──▶ Cloudflare Email Routing (MX of inbox.example.org)
                      │ subaddressing: p+<anything>@ falls back to the rule for p@
                      │ ONE literal rule p@inbox.example.org ──▶ Email Worker (inbound-mail-worker.js)
                      │                 shape check of the recipient, else setReject
                      │                 buffer message.raw, Content-Digest, RFC 9421 sign
                      ▼
               POST https://app.<domain>/api/internal/signed/inbound-mail
                      │ Envoy: own HTTPRoute, no edge rate limit,
                      │        Content-Length ≤ 27 MiB matched on the header
                      ▼
               BFF route (outside the Next proxy) ──▶ staging ──▶ receive job
```

- **Email Routing on a subdomain, with one literal rule.** Project mail is
  received on `inbox.<domain>` (`inboundMailDomain`), never the apex. The
  rule `p@inbox.<domain>` (`inboundMailLocalPart`, default `p`) points at the
  Worker, and the zone's subaddressing makes every `p+<detail>@inbox.<domain>`
  fall back to it. The project lives in the subaddress: `p+<slug>.<token>`.
  Details below ("The address").
- **The Worker decides one thing**: whether the recipient is project-shaped
  (`contracts/inbound-address.json`: its `ADDRESS_DOMAIN`, its
  `ADDRESS_LOCAL_PART` before the first `+`, and 12 characters of lowercase
  base32 after the last dot of the subaddress). Anything else is refused at Cloudflare with
  `UNKNOWN_ADDRESS_TEXT`, without a request. Whether a project-shaped address
  exists is answered only by the BFF. The Worker is one module uploaded
  verbatim, type-checked against `@cloudflare/workers-types`, and exports only
  its handler and plain constants (a module Worker's named exports are read as
  entrypoints).
- **It buffers the message** (≤ 25 MiB, Cloudflare's inbound cap) because the
  digest is known only after the last byte and a fixed-length body is what
  carries a real `Content-Length`. The **Workers Paid** plan is needed for CPU
  time, not memory: both plans give an isolate 128 MB, but Free allows 10 ms of
  CPU per invocation and Paid 30 s by default, up to 5 min
  ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
  read 2026-10-27). Copying up to 25 MiB into an ArrayBuffer and a SHA-256 over
  it run well past 10 ms for a large mail. On Free the handler then fails,
  which the verdict contract makes a temporary error, so the sender retries for
  days and the mail never arrives; a small mail may fit in 10 ms. Gate G5
  measures the CPU of a 25 MiB mail, and a failure stops the launch.
- **`redirect: "manual"`**: a followed redirect would turn the POST into a GET
  and send the signed headers elsewhere. `BFF_TIMEOUT_MS` is 90 s.

### The address: one literal rule and subaddressing on a subdomain

A project address is `<local part>+<slug>.<token>@<domain>`, or
`<local part>+<token>@<domain>` for a name with nothing Latin in it
(`p+bauplatz-12.k3x7q2m9p4ab@inbox.example.org`). The grammar both sides run is
`contracts/inbound-address.json`: strip `<>` and the quotes of a quoted local
part, ASCII-lowercase; the host must equal the receiving domain (not the parent
domain, not a subdomain of it, not a look-alike that starts with it); the local
part must contain a `+` and the text before the FIRST `+` must equal the
configured local part; the token is what follows the LAST dot of the rest, or
the whole rest. A second `+` therefore lands in the token position and the
recipient is no project address.

Why this shape (the first version used `<slug>.<token>@example.org` and the
zone's catch-all, which cannot ship):

- **The apex MX belongs to Google Workspace**, which delivers the company's
  own addresses, and Email Routing needs exclusive control of the MX of the
  domain it routes ("Email Routing requires exclusive control of the root
  domain MX records"; enabling it beside another provider's MX fails with
  error 2008, developers.cloudflare.com/email-service/reference/troubleshooting/,
  read 2026-11-03). So project mail moves to a subdomain whose MX nothing else
  uses. Email Routing supports subdomains of the same zone, on every plan
  (developers.cloudflare.com/email-service/configuration/subdomains/, last
  updated 2026-10-15).
- **The catch-all is apex-only** ("Catch-all rules are only available for the
  apex domain", the same page; the API's catch-all is one object per zone), so
  a subdomain has literal rules only.
- **A literal rule per project does not scale**: 200 routing rules per domain,
  and the BFF would need a Cloudflare credential to mint an address.
  BFF-managed per-address rules are rejected for the same reasons.
- **One literal rule plus subaddressing does.** With subaddressing on, "if you
  send an email to `user+detail@example.com` it will be matched by the
  `user@example.com` routing rule … preserved in `message.to`"
  (developers.cloudflare.com/email-service/configuration/email-routing-addresses/#subaddressing,
  read 2026-11-03; RFC 5233). Minting an address stays a database insert.

**Subaddressing is not in Pulumi.** `@pulumi/cloudflare` 6.23.1 exposes
`supportSubaddress` only on `EmailRoutingSettings`, whose create calls the
zone's Email Routing *enable* endpoint (which onboards the APEX, and fails
beside Google Workspace's MX) without sending the field, whose update is a
no-op, and whose delete disables Email Routing for the whole zone
(terraform-provider-cloudflare `internal/services/email_routing_settings`,
read 2026-11-03). `EmailRoutingDns` reports it but cannot set it. So it is a
manual step, once per zone: dashboard → Email Routing → Settings →
Subaddressing. The smoke tool's `cloudflare` command reads `support_subaddress`
(gate G0).

**The one thing to verify before go-live** is that subaddressing applies to a
subdomain's literal rule: Cloudflare documents subaddressing and subdomain
rules each, not their combination, and its dashboard adds a subdomain from the
apex's Email Routing settings. Gate G0, with the stack still paused: switch
subaddressing on, `cloudflare` passes, and one plain mail to
`p+smoke.aaaaaaaaaaaa@inbox.<domain>` gets a TEMPORARY failure (the Worker
answered, paused) rather than "Address does not exist" (no rule matched), with
the rule shown as matched in the activity log. The same run proves that
`email/routing/dns` enables routing on the subdomain while the apex's MX stay
with Google Workspace.

**The fallback**, if G0 fails: a dedicated mail domain (a zone of its own,
`inboundMailZoneId`) whose apex is the receiving domain, with an apex catch-all
to the Worker. Its addresses would drop the `+`, so it is a code change (the
contract, the Worker's shape check, the parser and the Pulumi rule), not a
configuration switch; the first version of this record is that design.

**No transition for the old form.** `<slug>.<token>@<domain>` never reached
production (no committed stack sets `inboundMailDomain`, 2026-11-03), so only
the new form parses; a recipient without a `+` is not a project address.

### RFC 9421 over a Content-Digest, with no fallback

The Worker signs `("@method" "@target-uri" "content-digest" "content-length"
"x-envelope-to" "x-envelope-from")` with `hmac-sha256`, `created`, `expires =
created + 300` and its `keyid`, label `sig`, over an RFC 9530 `Content-Digest`
of the exact bytes. The envelope addresses travel percent-encoded (every byte
outside printable ASCII, and `%`; `<>` for the null sender), so the BFF reads
back exactly what Cloudflare saw.

- The BFF verifies with `http-message-signatures` (the oracle,
  `requireInternalSignature` in `apps/workspace/bff/internal-auth.ts`); the
  Worker signs by hand on WebCrypto. Both are held to the same vectors,
  `contracts/inbound-mail-signature.json`.
- `@target-uri` is checked against the pinned origin of `WORKOS_REDIRECT_URI`,
  so the Worker's `BFF_URL` must be exactly that origin.
- **No nonce store**: a replay is the same bytes, hence the same delivery key,
  hence a 200 duplicate.
- **No fallback that drops the digest.** If buffering proves too costly at G5,
  the launch stops and this record is revisited.
- Keys: `INBOUND_MAIL_SIGNING_KEYS`, a JSON map of one or two keyid →
  base64 secrets of at least 32 bytes. Rotation adds the successor, moves the
  Worker to it, then removes the old one; the BFF accepts both meanwhile.

Standard Webhooks was not taken because it binds the body and a timestamp but
not request headers, and the envelope is headers. The shared internal token
would make every holder of it (every backend pod) able to post mail.

### The signed-route family lives outside the proxy

`/api/internal/signed/*` is excluded from the Next proxy matcher, so a body is
never buffered against `proxyClientMaxBodySize`; the route streams it. At the
edge it is its own HTTPRoute (`grid-app-signed`, `SIGNED_INTERNAL_ROUTE` in
`deploy/pulumi/src/constants.ts`) with:

- **no edge rate limit**: every tenant's mail arrives from Cloudflare's shared
  egress, so a per-client bucket would let other Cloudflare traffic defer an
  office's mail. The BFF limits after the signature instead;
- **a body ceiling of 27 MiB as a header match on `Content-Length`** (an RE2
  pattern for 0..28311552), with everything else, chunked or length-less
  requests included, sent to a direct 413 (`grid-signed-body-limit`). Envoy's
  `BackendTrafficPolicy.requestBuffer` was rejected: it buffers each body in
  Envoy, whose memory limit is 512 MiB, so about fifteen concurrent
  unauthenticated 27 MiB posts would kill the edge for every product route.
  The HTTP codec frames by Content-Length, so the header bounds the body
  without buffering it;
- a 120 s upstream budget.

### The BFF: gate order, staging before parsing

`lib/inbound-mail/receive.ts` runs, in this order, before a byte of the body is
read: the signature (by the route factory), the pause switch, the envelope
headers, the token (under the platform bypass, ids only; an unknown token is
charged to a bucket of its own), the office's `inbound-mail` flag (read from
WorkOS, so a failed lookup is a retry, never an "off"), the signed length, then
the rate limits, narrowest first so a refusal never spends a wider bucket
(per address 120/h, per organization 600/h, per signing key 3,000/h), and the byte caps on staged raw bytes (1 GiB per address, 5 GiB per
organization). Then it inserts the row naming the bucket and key (ADR-0043),
streams the body to `raw.eml` counting and hashing, requires the byte count to
**equal** the signed length (a short body is 503 `body-truncated`, a tampered
one 401) and the digest to match, and queues the receive job in the same
transaction that marks the mail `received`. It answers 202. Parsing runs in the
job.

The delivery key is a hash of the headers an author writes (From, To, Cc,
Subject, Date, Message-ID) and the body, never of the raw bytes: a relay
prepends its own lines on a retry, and the retry is still the same mail.

### The answer is a contract

The Worker bounces **only** a 4xx carrying `x-inbound-verdict: reject`
(`contracts/inbound-mail-contract.json`); every other answer makes it throw, which
Cloudflare turns into a temporary SMTP failure the sender retries.

| Situation | BFF answers | Sender sees |
|---|---|---|
| Recipient not project-shaped | (the Worker's `setReject`) | 5xx |
| Unknown or revoked token, deleted project, office has `inbound-mail` off | 404 + reject, one text | 5xx |
| Larger than 26 MiB | 413 + reject | 5xx |
| Bad or expired signature, paused, flag lookup failed, store down, body truncated | 401 / 503 | retried for days |
| Over a rate limit or byte cap | 429 | retried |
| Auto-reply, delivery report, loop | 202, dropped by the job | accepted |
| Anything else: any sender, any DKIM result, a closed project | 202, held | accepted |

One bounce text for every permanent refusal, ASCII, revealing no reason:
"This message could not be delivered: the address is unknown or no longer
valid. Help: https://example.org/e-mail-eingang/ Privacy: https://example.org/datenschutz/".
An office switched off reads exactly like an unknown address. A closed project
holds its mail, because Gewährleistung correspondence arrives late and a
project can be reopened.

### Sender authentication in the BFF, SPF never read

Cloudflare Email Routing hands the Worker no SPF, DKIM or DMARC verdict and no
connecting IP. The receive job authenticates from the raw message with
**mailauth 8** `authenticate()`, called without an `ip`, so its SPF result is
always `temperror` and is **never read**. The stored evidence line
(`authentication_results`) is built by us from the DKIM and DMARC results
alone, and a CHECK refuses any stored line containing `spf=`. A verified sender
is an aligned DKIM pass (DMARC relaxed alignment unless the domain's record says
strict) plus hygiene rules; what the verdict means for a person is ADR-0137's.
The signed header list of the passing signature is stored (`signed_headers`),
because thread pre-selection and following require the thread headers to be
inside it.

### What is never done

- Mail is never sent: no receipt, no auto-reply, no notice to a sender.
- The Worker never logs a message or an address (Workers observability is off
  in Pulumi, no Logpush); Cloudflare keeps Email Routing's activity log.
- A status alone never bounces: a rotated key (401), a `BFF_URL` pointing at the
  wrong host (404) and the edge's own 413 are retries.

### Switches, outermost first

1. `grid-oib:inboundMailDomain` (on) and `inboundMailEnabled` (`false` is the
   managed off: the rule is updated in place to disabled, so no rule matches
   and Cloudflare refuses the addresses, never Drop, which loses mail silently;
   the Worker is deleted after).
2. `inboundMailPaused`: the Worker answers a temporary failure before reading,
   and the BFF answers 503 (`INBOUND_MAIL_PAUSED`). The first promote is
   paused.
3. The WorkOS entitlement `inbound-mail`, per office, off for all.
4. Per project: the address switched off or rotated.

`loadConfig` refuses an inbound domain without `malwareScanEnabled`: every
part of a mail is scanned before it can be filed (ADR-0139). The operator's
runbook, with the owner gates and the launch gates G0–G9:
[`kubernetes.md` §3c](../deployment/kubernetes.md#3c-project-mail-cloudflare-email-routing-adr-0138).

### Consequences

* Good, because no mail server runs in the cluster, and spam to random names
  never reaches it.
* Good, because a request the BFF acts on carries a signature over the method,
  the URL, the exact bytes and the envelope, and a replay is a duplicate.
* Good, because no unauthenticated body is buffered at the edge or in the proxy.
* Good, because every fault of ours is a retry, so a misconfiguration delays
  mail rather than losing it.
* Good, because the company's own mail keeps its provider: only the
  subdomain's MX point at Cloudflare.
* Bad, because Cloudflare becomes a transit processor of project mail (a
  sub-processor row and a customer notice, gate O7).
* Bad, because the address depends on subaddressing, a zone setting outside
  Pulumi, whose effect on a subdomain's rule is proved only by gate G0.
* Bad, because Workers Paid is a running cost, needed for the CPU time (Free
  allows 10 ms per invocation, which a large mail's copy and SHA-256 exceed;
  Workers limits, read 2026-10-27), and the CPU of buffering 25 MiB in a
  Worker is unproven until G5.
* Bad, because two behaviours we rely on are undocumented by Cloudflare: a
  thrown error is a temporary SMTP failure (G2, re-proved after every
  `compatibilityDate` bump, G8), and the email handler's wall-clock cap.
* Bad, because without SPF and the connecting IP, a mail whose domain does not
  sign is simply "not confirmed", however legitimate its relay.

### Confirmation

- `deploy/pulumi/src/platform/inbound-mail-worker.spec.ts`: the constants held
  to `contracts/inbound-mail-contract.json`, the signer against
  `contracts/inbound-mail-signature.json` byte for byte, the verdict mapping, the
  pause, `redirect: "manual"`, and a spec that fails once `COMPATIBILITY_DATE`
  is a year old.
- `apps/workspace/bff/inbound-mail/contract.spec.ts` and the route spec: the
  same contract from the BFF's side; a DKIM-failed mail answers 202 and is held.
- `apps/workspace/bff/internal-auth` specs: the same vectors verified with
  `http-message-signatures`; every malformed key map fails closed.
- `deploy/pulumi/src/app/httproutes.spec.ts`: the signed route's header match,
  no rate limit, validated against the upstream CRD models.
- `deploy/pulumi/src/config.spec.ts`: the domain refused without the scanner,
  the zone rule, the local part's shape, the key map's shape.
- `deploy/pulumi/src/platform/inbound-mail.spec.ts`: routing on the subdomain,
  the one literal rule `p@<domain>` → the Worker, no catch-all and no
  `EmailRoutingSettings`, the address bindings.
- `contracts/inbound-address.json`, run by `address.spec.ts` and
  `inbound-mail-worker.spec.ts`: the grammar above, case by case.
- `lib/inbound-mail/sender-auth.spec.ts` and the hostile corpus
  (`__fixtures__/hostile.ts`): verdicts, flags, and no stored line with `spf=`.
- Launch gates G0–G9 (`deploy/pulumi/scripts/inbound-mail-smoke.ts`) against a
  real stack before the unpause; G0 is the subaddressing proof.

## Pros and Cons of the Options

### Receiver

- Cloudflare Email Routing (chosen): already the DNS provider, free routing,
  a Worker is code we version and test. Bad: the catch-all is apex-only (hence
  one literal rule and subaddressing on a subdomain), and Email Routing gives
  the Worker no authentication verdict and no IP.
- A transactional provider's inbound webhook: a parsed JSON post with SPF and
  DKIM verdicts. Bad: a new sub-processor that stores mail, a parsed form we
  would trust instead of the raw bytes, and no binding of the envelope to our
  key.
- Our own MTA: full control and the connecting IP for SPF. Bad: an internet
  MX, spam and abuse handling, and deliverability are an operation of their
  own, the opposite of "buy, don't build".

### Worker-to-BFF authentication

- RFC 9421 with Content-Digest (chosen): the standard for signing HTTP
  requests, binds headers and body, a maintained verifier library.
- Standard Webhooks: simpler, but signs the body only; the envelope headers
  would be unauthenticated.
- The internal token: no binding to the bytes, and held by every service that
  talks to the BFF.

### Sender authentication

- mailauth in the BFF (chosen): the receive job holds the raw bytes, mailauth
  is the maintained implementation (DKIM, DMARC, ARC), and the verdict is ours
  to test.
- The receiver's verdict: Email Routing does not hand one over.

## More Information

- Dependencies and licences: `mailauth` (MIT), `postal-mime` (MIT-0),
  `file-type` (MIT), `http-message-signatures` (ISC) and `structured-headers`
  (MIT) (`docs/compliance/external-dependencies.md`).
- The flow inside the BFF and after: [`inbound-mail.md`](../architecture/inbound-mail.md).
- Revisit when: G0 fails (take the fallback above); G5 fails (buffering in a
  Worker is too costly); Cloudflare documents an authentication verdict for
  Email Workers; the provider gains a way to set subaddressing without
  onboarding the apex; ARC from a fixed sealer allowlist (FU10) becomes worth
  trusting.
