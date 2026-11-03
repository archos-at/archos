# Project mail: the E-Mail-Eingang and the E-Mail-Verläufe

Every project of an office that has the feature gets an address,
`project+<slug>.<token>@inbox.example.org` (ADR-0138: one routing rule, `project@`, on a
receiving subdomain, and Cloudflare's subaddressing). A mail a project writer
sends from their own address, signed by their domain, is **filed directly, as
them**; every other mail waits in the project's **E-Mail-Eingang** until a
person files each part of it, its text and each attachment (who may, depends on
who the mail claims to be from: [the sender rule](#the-sender-rule)). A filed text becomes a
section of the conversation's one document, the **E-Mail-Verlauf**, and the
message's original `.eml` is kept beside it as evidence. A person may follow a
Verlauf, so that later replies' text is appended without a click.

Why it is built this way: [ADR-0137](../adr/0137-mail-sent-to-a-project-waits-until-a-person-files-it.md)
(review, threads, originals, following, and its amendment of 2026-11-03: the sender rule) and
[ADR-0138](../adr/0138-project-mail-arrives-through-cloudflare-email-routing-and-a-signed-worker.md)
(transport). The scanner: [ADR-0150](../adr/0150-attachments-from-outside-are-scanned-in-cluster-by-clamav.md).
The Outlook archive renders into the same Verläufe: [`mail-import.md`](mail-import.md).
The tables: [`schema.md`](../database/schema.md#project-mail-migration-0193-adr-0137) (and migration 0194, the sender class).
Operating it: [`kubernetes.md` §3c](../deployment/kubernetes.md#3c-project-mail-cloudflare-email-routing-adr-0138).

## The flow, from the edge to filing

```mermaid
flowchart LR
  subgraph Cloudflare
    MX[Email Routing<br/>MX of inbox.domain<br/>one rule project@, subaddressing] --> W[Email Worker<br/>shape check, RFC 9421 sign]
  end
  subgraph Edge
    E[Envoy route app-signed<br/>Content-Length at most 27 MiB]
  end
  subgraph BFF
    R[POST /api/internal/signed/inbound-mail<br/>receive.ts] --> S[(staging<br/>_inbound-mail/mail/raw.eml)]
    R --> Q1[[inbound_mail_receive<br/>system]]
    Q1 --> H[(waiting mail + parts)]
    Q1 --> Q2[[inbound_mail_suggest<br/>system, metadata only]]
    Q1 -->|D31 conditions 1-6| Q4[[inbound_mail_follow<br/>as the follower]]
    Q1 -->|verified_writer| Q5[[inbound_mail_sender_file<br/>as the sender]]
    Q5 -->|via sender| D
    P((person)) -->|inbound-mail-file| D[decision rows<br/>+ claim]
    D --> Q3[[inbound_mail_file<br/>as the decider]]
    Q4 -->|conditions 1-9| D2[follow decision] --> Q3
    Q3 --> U[upload path<br/>quiet batch]
    U --> V[E-Mail-Verlauf<br/>Fassung N+1]
    U --> A[attachment documents]
    Q3 --> O[(_mail-originals/entry.eml)]
  end
  W --> E --> R
  Q1 -.-> PY[agent_host POST /v1/mail/read]
  Q1 -.-> AV[ClamAV]
  Q3 -.-> AV
```

Legend: rounded boxes `[[…]]` are BFF jobs on `bff_job_queue`, cylinders are
objects in the organization's bucket or rows, dashed arrows are calls that make
no model call. Nothing left of „decision rows“ can file: the webhook, the
receive job, the suggest job and the sweeps import no filing code
(`review-first.spec.ts`); the receive job queues the sender's filing by its
kind's name only.

## The sender rule

ADR-0137's amendment of 2026-11-03. The receive job classifies the sender once,
when it holds the mail (`inbound_mails.sender_class`, migration 0194, frozen by
`inbound_mails_sender_verdict_guard` after the `received → waiting` write;
`lib/inbound-mail/sender-class.ts`, `receive-sender.ts`):

| Class | When | What happens | Window |
|---|---|---|---|
| `verified_writer` | a DKIM pass by the From domain itself (strict alignment: `d=` equals the From domain; a parent's or a subdomain's pass is `relaxed_alignment` and waits as `unverified_writer`), the From is a member who holds `project:documents:write` (any of `DOCUMENT_WRITE_PERMISSIONS`, a closed project none; a WorkOS failure reads as no), a signed To or Cc naming the project (never a Bcc copy: `bcc_own` is told from a recipient's replay of the member's mail by time alone), no `stale_date`, `date_out_of_range`, `message_id_reused` or `already_filed`, not automatic | filed directly as that member by `inbound_mail_sender_file`; whatever it cannot file waits for them | 30 days |
| `unverified_writer` | the From is such a member, but the signature failed or is absent, or the mail is not addressed to the project (their Bcc copy included), or carries one of those flags, or the mail is automatic | held; only that member files or restores it, with `acknowledgeSender` („Ja, ich habe sie gesendet“); anyone else gets `sender_only` and may dismiss it | 30 days |
| `office_member` | the From is a member without write rights here | held for the project's writers | 30 days |
| `external` | the From is nobody in the office | held for the project's writers; discarded when it runs out, no restore window | 14 days (`INBOUND_MAIL_EXTERNAL_WAIT_DAYS`) |

**The sender's filing** (`lib/inbound-mail/sender-file-job.ts`, a sliced job
as the system that resolves the sender itself, strictly): it waits for the
agent's suggestion while that job is still queued (30 s, at most ten times),
re-checks the sender (a member, the entitlement, `requireMailReviewer`, the
project open), builds the member's own view of the mail and files what that
view offers checked, as „Ablegen“ unchanged would (`sender-filing.ts`): an
attachment offered checked with no risk flag and a name, as the next Fassung of
its earlier document when the sender vouches for it, else into the agent's
suggested folder, and with neither it waits; the text, offered checked with no
content finding, into the pre-selected Verlauf, else a new one named after the
subject in the suggested text folder, else the first correspondence folder the
sender may write, else the root (`CORRESPONDENCE_FOLDER` in `review-defaults.ts`,
shared with the UI's draft); a text without a subject waits. Every check of a
person's decision applies (`planMailDecision`, `requireDecisionRights`); a part
the review refuses by id waits and the rest goes. The decisions are written
`via = 'sender'`, `decided_by` = the sender, other parts left waiting
(`keepOthers`), with `inbound_mail_file` in the same transaction, which uploads
in the sender's session. Whatever still waits is announced as any held mail
(`inbound_mail.waiting`); so is the whole mail on the job's last failed attempt.
A verified writer's mail queues no follow job: its sender files the text.

**What the database holds** (migration 0194; `scripts/rls-test-db.sh`, the 0194
section): the class needs its evidence (`inbound_mails_verified_writer_evidence`),
is written only by the hold and never changes (`…_sender_verdict_frozen`,
`…_held_once`); a `via = 'sender'` decision only on a verified writer's mail,
by its sender, with a clean raw message and an unflagged part
(`inbound_mail_decisions_sender_files_own_verified_mail`), filing only, no
acknowledgement (`…_sender_files_clean`), and a part flagged since is not
claimed on it (`inbound_mail_parts_sender_files_clean`); a file or restore of an
`unverified_writer` mail only by its member, a file saying they sent it
(`…_claimed_sender_releases`); an outsider's expired part is never restored
(`…_external_expiry_final`). The triggers bind every role, the BYPASSRLS
platform role included.

## Receiving: the webhook

`POST /api/internal/signed/inbound-mail` (`apps/workspace/bff/inbound-mail/receive.ts`)
is an `internalApiRoute` guarded by an RFC 9421 signature
(`INBOUND_MAIL_SIGNING_KEYS`) and excluded from the Next proxy, so it
streams the body. In order, before a byte of the body is read:

1. the signature (method, URL, Content-Digest, Content-Length, both envelope
   headers), by the route factory;
2. the pause switch (`INBOUND_MAIL_PAUSED=true`): 503;
3. the envelope headers, percent-decoded; a malformed escape is a 400 without
   a verdict (the Worker's bug, retried);
4. the token, resolved under the platform bypass (ids only); unknown, revoked or
   a deleted project: 404 with the reject verdict, charged to the
   `inbound-mail-unknown-address` bucket (300/h per signing key);
5. the organization's scope, then its `inbound-mail` flag read from WorkOS; off
   is the same 404 and text, a failed lookup a 503;
6. the signed length against 26 MiB: 413 with the verdict;
7. the rate limits per address (120/h), organization (600/h) and signing key
   (3,000/h), charged in that order, narrowest first: a bucket is spent even
   when it refuses, so a refused mail never spends a wider one; then the byte
   caps on staged raw bytes (1 GiB per address, 5 GiB per organization): 429;

then:

8. a `receiving` row naming the bucket and the exact key (ADR-0043);
9. the body streamed to `raw.eml`, counted and hashed;
10. the byte count must equal the signed length (else 503 `body-truncated`) and
    the bytes must hash to the signed digest (else 401 `bad-digest`);
11. the delivery key (`deliveryKey` in `mime.ts`: the authored headers, every
    DKIM-Signature's `b=` value and the body, so a relay's prepended lines do
    not make a redelivery new, and a copy whose signature a relay stripped or
    broke never shadows the signed one); a mail the address already holds
    answers 200 and its second copy is erased. A header block that cannot be
    read gets a key of its own delivery, so it is never a duplicate;
12. `received` and the receive job (`inbound_mail_receive`, job id = mail id) in
    one transaction;
13. 202.

The Worker bounces only a 4xx carrying `x-inbound-verdict: reject`; everything
else is a retry for the sending server (`contracts/inbound-mail-contract.json`).
One log line per delivery, ids and codes only; a refusal is a PostHog
`inbound_mail_refused` with its `reason`.

## Reading and holding: the receive job

`lib/inbound-mail/receive-job.ts`, run as the system
(`SYSTEM_ACTORS.inboundMail`), bulk priority. Each run asks again:

1. load the row and read `raw.eml`;
2. **scan the whole raw message** (`ScanMail yes`) and store the verdict; a
   mail is never `waiting` unscanned (CHECK `inbound_mails_waiting_is_scanned`).
   A text whose raw message is not `clean` cannot be filed, by a person or a
   follow: filing the text keeps that message as the entry's original. The
   review offers that text unchecked and disabled, and says why beside it
   (`message.rawScan` in the dictionaries: still being checked, check failed
   and repeated, or malware);
3. drop auto-replies, delivery reports and loops (`dropped`, raw erased); mark
   list and bulk mail `automatic`. Then **the original of a forward**
   (`receive-original.ts`, migration 0195): `original-message.ts` reads an
   attached original (`message/rfc822`, an `.eml`) or an inline forward's
   header block, and its author, date, subject, Message-ID and source go on
   the row (`original_*`), project addresses redacted. A second forward of an
   original the project holds is dropped as `duplicate_original`, silently and
   audited like the other drops, never bounced: while the first is open the
   partial unique index `uniq_inbound_mails_open_original` refuses it, and once
   the first was filed its entry's `author_message_id` does. A dismissed or
   expired first mail blocks nothing after it settles. An inline forward has no
   Message-ID and is never a duplicate: its header block is the forwarder's
   text;
4. **authenticate the sender** (`sender-auth.ts`, mailauth 8 without an IP, so
   SPF is never read): trust, reason, signer domain, signed headers, flags;
5. read the MIME tree (`mime.ts`, postal-mime 4 and `file-type`) against the
   office's accepted types; find the member by exact address, or an outsider's
   display name that is a member's (`claims_member_name`);
6. the **Namensprüfung** on each attachment's name and the base subject: a
   match is the part's flag `name_stop`, never a drop;
7. **scan each attachment**;
8. **the Python reader**, `POST /v1/mail/read` (no model): own text, quoted
   blocks, calendar invitations; then the content check on the own text after
   the signature was removed (`content_findings`). The text is what a reader
   sees, nothing more (`agent_host/mail/body_text.py`, shared with the Outlook
   import): from HTML it drops `script`, `style`, `head`, `title`, `template`,
   comments, elements hidden by inline CSS (`display:none`,
   `visibility:hidden`, `mso-hide:all`, a zero `font-size` or `opacity`, a zero
   `height` or `max-height` with `overflow:hidden`; `font-size` and
   `visibility` are inherited, so a child that sets them back is read), the
   `hidden` attribute, `aria-hidden="true"` and tracking pixels; from every
   form, zero-width characters, the soft hyphen and the bidi controls. A
   `display:none` instruction never reaches the index or the person deciding.
   The renderer drops the same characters from names, subjects and file names
   (`INVISIBLE` in `lib/mail-thread/render.ts`). A colour equal to the
   background is not detected;
9. **redact every other project's address** in the subject, participants, text,
   quotes and invitations; the receiving project's own address is kept here,
   so the person deciding sees which address was written to. Filing redacts it
   too (`filedForm` in `file-job.ts`): a Verlauf can be shared or exported, so
   no section names an address that mail could be sent to, and a participant
   without a display name, printed by its local part, has its address redacted
   as well;
10. **match the project's threads** and look the Message-ID up
    (`message_id_reused`, `already_filed`); ids and strengths only
    (`thread_match`);
11. **classify the sender** ([the sender rule](#the-sender-rule)): whether the
    From's member may write in the project, asked of WorkOS; stage the
    attachments and `read.json`, insert the parts, `waiting`, with the class
    and its window (14 days for an outsider, else 30);
12. a `verified_writer` mail queues `inbound_mail_sender_file` (by name);
    any other, when conditions 1–6 of D31 hold (`judgeFollow`),
    `inbound_mail_follow`;
13. announce: nothing yet for a verified writer's mail (the sender's filing
    tells what it leaves); for any other `inbound_mail.waiting`, and the member
    it names hears why it waits (`inbound_mail.held`,
    `inbound_mail.held_for_writers`); publish the project change to the agent
    door, audit `inbound_mail.received` (with `senderClass`), PostHog
    `inbound_mail_received` (`sender_class`), and queue the agent's suggestion
    unless the sender is unconfirmed, impersonating, or the mail is automatic.

On the last attempt the mail is held anyway, flagged `unreadable`, with a text
part whose original can be downloaded once its scan is clean: mail is never lost
to a parser bug.

### What a mail is, and its states

| Object | Table | States |
|---|---|---|
| The address | `inbound_mail_addresses` | active; revoked (`rotated`, `switched_off`) |
| A delivery | `inbound_mails` | `receiving` → `received` → `waiting` → `settled`, or `dropped` |
| A part | `inbound_mail_parts` (`message` or `attachment`) | `waiting` → `filing` → `filed`; `waiting` again with `last_failure`; `dismissed` / `expired` → `waiting` (restore, 7 days) |
| A decision | `inbound_mail_decisions` (append-only) | `file`, `dismiss`, `restore`; `via` `app`, `agent`, `agent_proposal`, `follow`, `sender` |

Staged objects: `org/<org>/project/<project>/_inbound-mail/<mailId>/raw.eml`,
`…/read.json` and `…/<position>` per attachment. A filed message's original:
`org/<org>/project/<project>/_mail-originals/<entryId>.eml`. Both segments are
reserved in `lib/s3.ts`, and erasure is by the exact keys on rows; only the
project purge deletes by prefix.

### Sender trust

| Label | When |
|---|---|
| `member_verified` | the From address is a member's (exact, ASCII-lowercased) and its domain signed (aligned DKIM pass plus hygiene) |
| `member_unverified` | a member's address, not signed |
| `external_verified` | an outsider, signed |
| `external_unverified` | an outsider, not signed |
| `not_checked` | an archive entry (`mail_thread_entries` only) |

Verified means one DKIM signature that passes, aligns with the single From
domain, covers the whole body (no `l=`), is not in testing mode (`t=y`), has not
expired, signs From, Subject, Message-ID and Date, is not rsa-sha1, with a key of
at least 1024 bits; and the header block holds exactly one ASCII From and no
duplicated singleton field. mailauth reports a body-hash mismatch and an expired
signature as `neutral`; `sender-auth.ts` names them `dkim_fail` and
`dkim_expired`. The stored `authentication_results` line is ours, from DKIM and
DMARC only; a CHECK refuses one containing `spf=`.

Flags: `not_addressed_to_project` (no signed To or Cc names the token on the
inbound domain; a look-alike domain such as `example.org.evil.example` does not
count), `relaxed_alignment` (verified, but the admitting signature's `d=` is a
parent or a subdomain of the From domain, not the domain itself: the label stays,
a direct filing needs strict alignment), `bcc_own` (a `member_verified` mail with a signed Date within 24 h of
receipt: the member's own Bcc copy, or a recipient re-sending it, which is why it never files directly), `stale_date` (signed Date more than 7 days
before receipt), `date_out_of_range` (the Date outside `[received − 30 days,
received + 15 minutes]`; the receipt time is used), `message_id_reused`,
`already_filed` (the same Message-ID and own text already an entry, an archive
entry included), `claims_member_name`.

What the person is asked (`lib/inbound-mail/sender-risk.ts`, computed on the
server and carried on the views as `riskLevel`): `none`; `caution`
(`acknowledgeSender` needed: a member address not signed, a failed or rejected
signature, a verified mail not addressed to the project outside the Bcc case,
a stale date); `impersonation` (a rejected signature, or `claims_member_name`):
no suggestion, nothing pre-selected, never in a bulk decision.

## Deciding

`POST /api/projects/[id]/inbound-mails/file` (`lib/inbound-mail/service.ts`,
`decision.ts`) decides 1–20 mails. It checks every rule synchronously:
`requireFolderWrite` on each target, the accepted type, a clean scan (of each
attachment, and for the text of the whole raw message), the
acknowledgements (only with one mail), the name check of a new Verlauf's name
and folder path, the name free or `revisionOf`, `ifMatch`. Then, in one
transaction, it appends the decision rows, claims the listed parts (`waiting →
filing`, compare-and-set, 5-minute claim), dismisses every other waiting part of
those mails, and queues `inbound_mail_file`. It answers 202. Refusals are 409s
with `details.reason` from `INBOUND_MAIL_REFUSALS` (`inbound-mail-wire.ts`).

`via` is read from the call, never the body (`decisionActor`): an agent's card the
person accepted (`actingProposalId`, set by the proposal applier), an outside
agent acting as the person, or the app; `sender` only from the sender's filing
job. A mail that claims another member (`unverified_writer`) is refused with
`sender_only` for anyone but that member (`onlySenderReleases` on the views);
its member files it with `acknowledgeSender`, which every `unverified_writer`
mail needs (`senderNeedsAcknowledgement`). The E-Mail-Eingang says why a mail
waits under its sender (`waitReason`: `signature`, `no_write_rights`,
`outside_office`; `SenderWaitLine`).

Defaults, completeness and thread groups are the server's
(`review-defaults.ts`, `thread-groups.ts`, `forwarded.ts`): a part is
`preselected` or not, a mail's `incompleteReason` is null when it can be filed
as suggested alone or in bulk, and a group of waiting mails that would append to
one thread is filed in sent order with the Fassung each becomes.

## Filing

`lib/inbound-mail/file-job.ts`, handler as the decider, interactive. A run acts
only on decisions its own person made, and the follow job's run only on the
decision it just wrote (`decisionIds` in the payload): a part another person
decided on the same mail is left to that person's run, so nothing is ever
uploaded in one person's session on another's choice of folder, name or
release. Per mail:
finish a stopped original move; each attachment (claim renewed, bytes read and
SHA-256 checked, re-scanned when the verdict is older than 24 h, folder resolved
as the person, the upload path with the person's chosen type and `mail_origin`);
then the text (`lib/mail-thread/append.ts`); then any attachment filed after
its text is linked to the entry's `pending` row; then settle once every part is
filed (staged objects erased by key, the row scrubbed to ids) and tell. A
failure a retry would repeat becomes the part's `last_failure` and the part
waits again; `inbound_mail.filing_failed` tells the decider.

Each run opens one quiet upload batch per kind (`quiet-batch.ts`), with the
effects of `batch-effects.ts`:

| Upload | Completion | Re-judgement | Intake | Revision notice | Document check |
|---|---|---|---|---|---|
| Inbound attachments | no | no | yes | all | yes |
| Inbound Verlauf append (person or follow) | no | no | no | marks only | no |
| Archive Verlauf render | yes | no | no | marks only | no |

### The E-Mail-Verlauf

`lib/mail-thread/append.ts` under the thread's render lease
(`acquireRenderLease`, 5 minutes; a busy thread answers "not yet" in 15 s
without spending an attempt):

1. a new `mail_threads` row, or the existing one;
2. the entry (`mail_thread_entries`, `source = 'inbound'`, `received_at`,
   `masked_spans` when the person chose „Unkenntlich ablegen“), its Message-IDs
   and one `mail_thread_entry_attachments` row per attachment (D36);
3. `render.ts` over every entry: one `##` section per message, ordered by the
   clamped send time, headings that never change;
4. the upload, same name, `documentType: 'correspondence'`, in the quiet append
   batch: the next Fassung; `first_version_id` set on every entry that had none;
5. the original moved: copied to `_mail-originals/<entryId>.eml`, read back,
   SHA-256 checked, recorded on the entry, and only then the staged raw erased
   (`lib/mail-thread/originals.ts`; `original_move_pending_at` makes it
   retry-safe, sweep 13 finishes it).

`mail-thread-get` lists each entry's attachments by position: a filed one by
its name when the reader may open its document, and one that was not filed
(waiting, dismissed, infected, name-stopped, never staged) by its reason only,
never its name, since that name became no document (RT-S13).

A binned, deleted or archived Verlauf document is `last_failure:
thread_document_gone`. A thread at 200 entries or 2 MiB refuses an append
(`thread_full`).

**A forwarded message is cited by its author.** When the mail carried an
original (0195), the entry keeps its author (`author_*`), its heading names the
author at the time they wrote it with „Domain nicht bestätigt“ (the forwarder's
signature covers the forward, not what it quotes, RT-S2), and the line
„Weitergeleitet von“ names the sender by the usual rule. An attachment's
`mail_origin` does the same: `from_*` and `sent_at` are the author's,
`forwarded_by_name`, `forwarded_by_domain` and `forwarded_at` the forwarder's
(`ingest-facts.ts`, `agent_host/models/mail_facts.py`, printed by
`agent/knowledge/mail_facts.py`). The document's „kam mit der E-Mail“ line in
the UI (`mail-origins.ts`, `MailOriginView`) still names the sender, whose
trust it shows.

The knowledge layer reads a Verlauf like any Markdown document, one chunk
section per message (`source_format: mail`, lane `project_mail`, label
„E-Mail“), with `document_date` the newest message's send time; a filed
attachment carries `mail_origin` with the sender's trust, so `list_files` and
`read_passage` say „kam mit der E-Mail vom … von …“, with „Domain nicht
bestätigt“ where it applies
([`document-ingestion.md`](../technical-reference/document-ingestion.md)).

### Detach

`POST …/mail-threads/[threadId]/entries/[entryId]/detach`
(`lib/mail-thread/detach.ts`) moves a mis-filed message into another thread or
a new one, as the person, under both render leases. The thread it leaves is
uploaded first, as Fassung N+1 without the section (the one exception to the
superset invariant: earlier Fassungen keep it), then the thread it joins; only
then does the entry's row move (its Message-IDs by `ON UPDATE CASCADE`).
Every follow of the thread it left ends (`detached`).

## Following a Verlauf

```mermaid
sequenceDiagram
  participant P as Person
  participant F as follows.ts
  participant RJ as receive job
  participant FJ as follow job
  participant DB as Postgres
  P->>F: POST …/mail-threads/[threadId]/follow { days? }
  F->>DB: mail_thread_follows (60 days, at most 180)
  Note over RJ: a reply arrives
  RJ->>RJ: judgeFollow: conditions 1–6
  RJ->>DB: queue inbound_mail_follow (only when they hold)
  FJ->>FJ: judgeFollow again (same function)
  FJ->>FJ: as the follower: entitlement, document live and screened,<br/>project:documents:write, folder write (7, 9)
  FJ->>DB: writeFollowDecision: caps of the last 24 h (8),<br/>decision via=follow, text claimed
  FJ->>FJ: runInboundMailFiling (the filing job's step)
  FJ-->>P: inbound_mail.appended (collapsed per Verlauf and day)
```

The nine conditions are listed in ADR-0137. The follower is the earliest running
follow made before the mail arrived, whichever follow the receive job named.
Condition 8 counts the follow's own appends against its `daily_cap` (default
20) and the project's `via = 'follow'` decisions against 100, over the last 24
hours, under a project advisory lock. A failing condition writes nothing: the
mail waits as without a follow. A follower who lost the project or the folder
ends the follow (`access_lost`); a deleted, archived or binned document ends it
(`document_gone`); a held document only makes the mail wait. Closing a
project ends every follow on it (`project_closed`), so a run that still meets
a closed project (closed between its find and its check) leaves the mail
waiting. One log line per run: `[inbound-mail] follow of mail <id>: <kind>[:<reason>]`.

Ending: `DELETE …/follow` (own: `unfollowed`; `?userId` with `project:manage`:
`revoked_by_manager`), closing the project (`project_closed`,
`endFollowsOnProjectClose` in the close itself, as the person who closed it,
each audited), sweep 12 (`expired`,
`document_gone`, and `project_closed` for a follow the close missed), address
rotation or switch-off (`address_rotated`), detach (`detached`). Every system end goes
through `endFollowBySystem` (`lib/mail-thread/follows.ts`), which audits
`mail_thread.follow_ended`, sends a personless `mail_thread_followed`, settles
the renewal notice and publishes the change.

## Retention: the sweeps

`lib/inbound-mail/sweep.ts`, one more part of
`POST /api/internal/maintenance/reconcile-background-work`, which the scheduler
posts every tick (30 s); at most 50 rows per sweep per tick. Each sweep finds
what is due across organizations under the platform bypass (ids only), then acts
on each row in its tenant, compare-and-set on what it saw; deletes run as the
platform role. A sweep that erases an object takes the row first, under the
find's whole condition with the legal hold included, and erases only then:
erasing first would lose what a hold or a restore placed in between kept. One sweep's failure is counted and the next runs. The scheduler
logs one line per sweep that acted, e.g.
`[job-scheduler] background work sweep, project mail expired: checked 3, errors 0, expired 2, parts 5`.

In the order they run:

| # | Name | What | Window | Legal hold |
|---|---|---|---|---|
| 1 | `staleReceptions` | `receiving` untouched: object erased by key, row deleted | 15 min | project hold: skipped |
| 2 | `orphanedReceptions` | `received` with no job: queued again (a dead job is counted `dead`) | 5 min | — |
| 5 | `lapsedClaims` | `filing` past its claim: waits again (`unavailable`), the decider told | the claim (5 min) | — |
| 13 | `stalledMoves` | an original's move that stopped: finished (copy proven, then raw erased); entry gone: raw erased | 15 min | the move erases nothing unproven; the entry-gone branch skips a held project |
| 11 | `audits` | decisions with `audited_at IS NULL`: sent to the trail, marked | 1 min | — |
| 3 | `expired` | `waiting` past `expires_at`: waiting parts `expired` (restorable 7 days; an outsider's never), audited; the member it came from told (`inbound_mail.expired`) | 30 days; an outsider's 14 | — (no erasure) |
| 4 | `expiring` | five days left: `inbound_mail.expiring`, once per mail | day 25; an outsider's day 9 | — |
| 6 | `endedParts` | dismissed and expired parts past 7 days (a dismissed part of `external_unverified` mail, and an expired part of `external` mail, at once): the part's key taken first, under the find's whole condition (still ended, past restoring, no hold), then the bytes erased, so a restore or hold that landed since erases nothing; a failed erasure puts the key back; a mail nothing of which waits is settled and scrubbed | 7 days | project or custodian hold: erasure deferred (`erasure_deferred_at`), the mail still settles |
| 7 | `rescans` | failed scans of waiting parts and held raw messages, hourly, up to 24 attempts | 1 h | — |
| 10 | `releasedErasures` | erasures a hold deferred, once no hold covers them: the row's keys and deferral taken first, under the find's whole condition (still deferred, the same keys, no hold), then the objects erased, so a hold placed since erases nothing; the keys the store kept, and the deferral, come back for the next tick | — | only rows no hold covers |
| 8 | `keptMails` | settled mails 30 days after settling with no filed part's document alive, dropped mails 30 days after receipt; nothing left to erase, nothing unaudited: deleted | 30 days | project or custodian hold: skipped; trigger `GLH01` backstop |
| 12 | `follows` | running follows past `expires_at` end `expired`, those whose document is gone end `document_gone`, those in a closed project end `project_closed`; five days before the end `mail_thread.follow_expiring`, once | 60 days, day 55 | — |
| 9 | `threads` | threads whose document is deleted (a binned one keeps its row), over an hour old, no lease, no running follow, nothing unaudited, not waiting for a first archive render: the thread's render lease taken under that whole condition (the hold included), then every original erased by key, then the thread deleted (cascade: entries, attachment rows, Message-IDs, ended follows, their audited decisions and the parts those filed) | 1 h | project hold: skipped; triggers backstop |
| 14 | `caps` | addresses at 80% or 100% of their own or their organization's staged-bytes cap: `inbound_mail.cap_reached` to the managers once per rise; settled below 80% or when revoked | — | — |

Order matters: 11 before 8 and 9 (they wait for the trail, RT-S8); 12 before 9
(9 never deletes a running follow). `sweep.spec.ts` holds the order.

**Legal hold.** Every erasing or deleting set asks
`legal_hold_blocks('project', project_id, organization_id)` in its WHERE;
a mail's bytes also ask `legal_hold_blocks('user', sender_user_id, …)`
(a custodian hold on the member it came from). `legal_hold_blocks('project', …)`
is also true when a hold on any document, folder, conversation or user touches
the project (migration 0115), so **one held document pauses that project's
mail erasure**. Under a hold, ending still happens (expire, settle, scrub); only
erasure and deletion wait. The `BEFORE DELETE` triggers on `inbound_mails`,
`mail_thread_entries` and `mail_thread_entry_attachments` (`GLH01`) are the
backstop, never the filter.

## The eleven notices

`lib/inbound-mail/announce.ts`, in-app and push only (`email: never`). Payload
`{ subject: <project name>, variant?, related? }`: no sender, subject or file
name reaches a row or a push. Mail from an unconfirmed domain or automatic mail
adds the variant `unconfirmed`.

| Type | Told to | Row | Link | Push | Settled |
|---|---|---|---|---|---|
| `inbound_mail.waiting` | the member sender (`member_verified`, addressed to the project or their Bcc copy, holding project read), else the project's managers | collapsed per project, actionable | `/files/mail` | requests, normal | nothing waits |
| `inbound_mail.expiring` | the same, once per mail (sweep 4) | collapsed per project, actionable | `/files/mail` | requests, normal | nothing it told about waits |
| `inbound_mail.decided` | the member the From names (verified or not), when the run filed the mail's last part; variant `direct` when it was filed as them without a click (told although they are its decider) | per mail | `/files?folder=…` when every file went to one folder the member may open, else `/files` | results, low | — |
| `inbound_mail.rejected` | the member the From names, when a dismissal ended their mail | per mail | `/files` | results, low | — |
| `inbound_mail.held` | the writer an `unverified_writer` mail claims: „Haben Sie diese E-Mail gesendet?“ | per mail, actionable | `/files/mail/<mailId>` | requests, normal | the mail is decided or expires (`settleHeld`) |
| `inbound_mail.held_for_writers` | the member without write rights whose mail waits | per mail | `/files` | results, low | the same |
| `inbound_mail.expired` | the member the From names, when sweep 3 expired their mail | per mail | `/files` | results, low | — |
| `inbound_mail.filing_failed` | the decider; variant the `last_failure` | per mail, actionable | `/files/mail/<mailId>` | requests, normal | filed again or dismissed |
| `inbound_mail.cap_reached` | the project's managers; variant `nearly_full` or `full` | per address, actionable | `/files/mail` | requests, normal | below 80%, or a new address |
| `inbound_mail.appended` | the follower | per Verlauf and day | the Verlauf document | results, low | — |
| `mail_thread.follow_expiring` | the follower, once (sweep 12) | per follow, actionable | the Verlauf document | requests, low | renewed or ended |

The collapsed rows carry the anchor of their newest emission, so they are
settled by what the project still holds (`settleProjectNotices`), never by one
mail's anchor ([`adding-a-shareable-resource-type.md`](adding-a-shareable-resource-type.md)).
The member a mail's From names hears why it waits and what became of it,
whether or not their domain signed it: a forged mail causes a notice to the
member it impersonates, by design (ADR-0137's amendment), and the row carries
nothing the forger wrote. Nobody outside the office hears anything. The Postfach row's
„Wie vorgeschlagen ablegen“ action of the design is not built yet.

## The agent's suggestion

`lib/inbound-mail/suggest-job.ts` (`inbound_mail_suggest`, system, bulk, job id
uuid5 of the mail). Skipped, with no model call, when `FILING_SUGGESTIONS`
is off, the mail no longer waits, the sender is `external_unverified`, an
impersonation or automatic mail, the project is closed, nothing is left to
place, or the project's unasked budget says no (`unaskedSpendAllowed`, fail
closed). Placed: waiting attachments with a name, not infected, not
name-stopped, of an accepted type, at most 60; the text only when the mail
matched no thread. Input: those names, the subject masked by the content check,
the sender's domain, the folders every project member may read, and the
office's conventions kept by at least two of its other projects. Never the text
or the bytes. The model call is `judgeMailFiling` → `POST /v1/filing-fit`
(`basis: mail`). The suggestion is stored on the parts that still wait without
touching `updated_at`, which is part of `ifMatch`: a suggestion arriving while
a person reads must not make their decision stale.

## Exposure

All operations live in `apps/workspace/bff/agent-api/catalog/mail.ts`, domain
`mail` ([`agent-surface.md`](agent-surface.md)).

| Operation | Outside agents | The agent |
|---|---|---|
| `inbound-mail-address-get`, `-create`, `-delete`, `-rotate` | yes | yes |
| `inbound-mail-list`, `-get` (metadata only) | yes | yes |
| `inbound-mail-text-get` (masked), `inbound-mail-part-content-get` | yes | no |
| `inbound-mail-file` (also the member's release of mail that claims them: `acknowledgeSender`), `inbound-mail-dismiss` | yes, `requiresPersonConfirmation` | as a card; clean, unflagged parts only (a card carries no `acknowledgeSender`, so it never releases a claimed mail) |
| `inbound-mail-restore` | yes | yes |
| `inbound-mail-original-get`, `mail-thread-entry-original-get` | withheld (`evidence`) | withheld |
| `mail-thread-list`, `-get`, `mail-thread-entry-detach` | yes | yes (detach as a card) |
| `mail-thread-follow` | `control`-sensitive: only under the office's opt-in and the step-up scope | no |
| `mail-thread-unfollow` | yes | no |

## Security checks, and what each one failing would give

| Check | Where | On failure | If only this check failed |
|---|---|---|---|
| Recipient shape | Worker | `setReject` | nothing: the BFF re-parses |
| RFC 9421 signature, 300 s window | route factory | 401, retry | a leaked key injects mail into review queues; limits, scans, our DKIM verdict and a person's decision still stand |
| Exact length and digest; outside the proxy; 27 MiB at Envoy | webhook, edge | 503 / 401 / 413 | tampered or truncated bytes |
| Token, flag | webhook | 404 + reject | a 60-bit guess, or mail held for an office that has not opted in (it stays in that tenant) |
| Rate limits and byte caps | webhook | 429 | one address floods its own queue; the others keep working |
| DKIM/DMARC and hygiene | receive job | a label | a forged mail claims a domain; no pre-selection, no follow, „nicht bestätigt“ in the Verlauf |
| Name check, risk flags | receive job, `decision.ts` | flag, acknowledgement | an explicit, audited override only |
| ClamAV on attachments and the whole raw message | receive job, decision, follow job, filing job, downloads | an attachment `infected`: dismiss only; `failed`: re-scan. The raw message not `clean`: its text cannot be filed (`scan_not_clean`) and a follow never appends it (`scan_not_clean`), it can only be dismissed until a re-scan comes back clean | malware reaches a person, or an infected `.eml` is kept as a Verlauf's original |
| Redaction of other projects' addresses | receive job | — | another tenant's token learned (the original stays unredacted and gated) |
| `project:documents:write`, candidates for the viewer | service | 404 | a non-writer reads held mail, or a writer learns restricted names |
| Per-target folder write, type, scan, acknowledgements, `ifMatch` | `decision.ts` | 409 / 403 | a filing the decider was not entitled to |
| `decision_id` FK to a `file`, person-shaped decider, clean card, follower FK, `filed_is_clean`, `waiting_is_scanned`, and 0194's sender rule (frozen class, `via = 'sender'` only for the verified sender's own clean mail, a claimed mail released only by its member) | Postgres | statement refused | a part filed without a `file` decision, a decision by a `system:*` actor, a card carrying an acknowledgement, a follow decision without its follower, or a part filed or waiting without a clean scan. The database cannot tell a code path that writes a real person's id from that person: that is the static ratchet's and the filing job's (it runs in the decider's session) |
| `requiresPersonConfirmation` | door | refused with a link | an injected outside agent cannot file |
| Filing as the decider (or follower) | job | `last_failure` | nothing past an ordinary upload by that person |
| Static ratchet | `review-first.spec.ts` | CI | — |

HTML is never rendered: the approval view shows the reader's extracted text,
as text, links inert, and the list of attachments (name, type, size, and the
scan when it is not clean); the wire carries no HTML at all
(`InboundMailTextView`). `inbound-mail-detail.spec.ts` pins it with a mail
whose text, quote header and invitation hold `<script>`, `<style>`,
`<iframe>` and a tracking `<img>`: none becomes an element. Previews before
filing only for clean images and PDFs, drawn client-side in the sandboxed
viewer; Office files show their tile until filed (no Gotenberg on a stranger's
file).

**The size a mail may have.** 25 MiB as sent, headers and base64 included
(`INBOUND_MAIL_MAX_MESSAGE_BYTES` in `lib/inbound-mail/inbound-mail-vocabulary.ts`,
the most Cloudflare Email Routing hands the Worker), so about 18 MiB of
attachments (`INBOUND_MAIL_MAX_ATTACHMENT_BYTES`). The webhook's 26 MiB and
Envoy's 27 MiB sit above it. Every place that shows the address states both
numbers from those constants, with a link to Dateien for anything larger.

## Observability

- PostHog: `inbound_mail_received`, `_refused`, `_dropped`, `_decided`,
  `_address_rotated`, `mail_thread_followed`, `mail_thread_original_downloaded`
  ([`posthog-events.md`](../observability/posthog-events.md)). Ids, codes and
  counts only.
- Langfuse: the suggestion's `filing-fit` generation (`surface: inbound_mail`),
  the decision score (`DECISION_SCORE_NAME`) (subject `inbound_mail_suggestion`) and `mail-thread-match`
  ([`langfuse.md`](../observability/langfuse.md)). `/v1/mail/read` makes no
  model call.
- Audit (`lib/audit/schemas.mjs`): `inbound_mail.received`, `.expired`,
  `.part_read`, `.original_read`, `.decided`; `inbound_mail_address.created`,
  `.rotated`, `.deleted`; `mail_thread.follow_started`, `.follow_ended`,
  `.entry_detached`, `.original_read`.
- Operator alerts: `bad-signature`, `body-truncated`, `unavailable`,
  `cap_reached`, and no `received` for 24 h (`kubernetes.md` §3c).

## Where it lives

| What | Code |
|---|---|
| Transport (address, sender authentication, MIME, automatic mail, the Worker contract) | `apps/workspace/bff/inbound-mail/{address,sender-auth,mime,automatic-mail,contract}.ts`; hostile corpus `__fixtures__/hostile.ts` |
| Webhook, staging, receive job | `apps/workspace/app/api/internal/signed/inbound-mail/route.ts`; `lib/inbound-mail/{receive,staging,receive-job,screening,read-client,malware-scan}.ts`; a forward's original `lib/inbound-mail/{original-message,receive-original,receive-original-repository}.ts` |
| Review service, decisions, candidates, wire | `lib/inbound-mail/{service,decision,candidates,access,address-service,inbound-mail-wire,sender-risk,review-defaults,thread-groups,forwarded}.ts` |
| Filing | `lib/inbound-mail/{file-job,filing-repository,quiet-batch,batch-effects}.ts` |
| The sender rule | `lib/inbound-mail/{sender-class,receive-sender,sender-filing,sender-file-job}.ts` |
| Threads | `lib/mail-thread/{mail-threading,render,append,originals,detach,archive,mail-origins,ingest-facts}.ts` |
| Following | `lib/mail-thread/{follows,follow-repository,follow-eligibility}.ts`; `lib/inbound-mail/{follow-candidate,follow-job}.ts` |
| Sweeps and notices | `lib/inbound-mail/{sweep,sweep-repository,announce,notice-repository}.ts` |
| Suggestion | `lib/inbound-mail/{suggest,suggest-job,suggest-scores}.ts`; `lib/filing/judge.ts`; `apps/agent-host/src/agent_host/routes/filing_fit.py` |
| The Python reader | `apps/agent-host/src/agent_host/mail/`, route `routes/mail.py` |
| The UI | `apps/workspace/ui/features/inbound-mail/`; the E-Mails tab `features/documents/components/mail-thread/` ([`docs/ux/inbound-mail.md`](../ux/inbound-mail.md)) |
| The edge | `deploy/pulumi/src/platform/{inbound-mail,inbound-mail-worker,email-routing}.*`; `shared/inbound-*.json` |
