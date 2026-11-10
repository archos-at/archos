# PostHog automation: `deploy/posthog`

Code that runs inside PostHog rather than in our images. PostHog stores it; this
directory is the copy we review, so a change to a destination is a diff here
first and a save in PostHog second. Nothing applies these files automatically:
paste the source into the destination (PostHog → Data pipelines → Destinations,
or the PostHog MCP `cdp-functions-partial-update`), test it with a real event,
then enable it.

Staging (`app.dev.piloti.at`) and production (`app.piloti.at`) share one
PostHog project (269895). Every destination below therefore works out which
deployment a ticket belongs to before it links to or calls one.

## `support/`: product feedback in PostHog Support

The flow is described in
[`docs/architecture/product-feedback.md`](../../docs/architecture/product-feedback.md).

| File | Destination in PostHog | Trigger | What it does |
|---|---|---|---|
| [`slack-alert.hog`](support/slack-alert.hog) | „Piloti feedback → Slack (per deployment)" `01a16483-aaa2-0000-9400-98b42243aa65` | `product_feedback_ticket_opened`, `product_feedback_reply_sent` (the BFF's server events) | Posts a new report to `#support-tickets` per kind, with the claim button pointing at the event's `app_host`; a reporter's reply goes into the alert's thread. Bugs page `@here` on production only. Never the member's words: the team reads them in the ticket |
| [`claim-update.hog`](support/claim-update.hog) | „Piloti feedback: mark Slack alert claimed" `01a16445-c91c-0000-5f64-2f70e9c0e3b3` | `$conversation_ticket_assigned`, `assignee_type = user` | Rewrites every alert of the ticket, found in the channel history by the ticket id: the claim button goes, „✅ <taken_by> <Name>" appears. No text of the report |
| [`reply-poke.hog`](support/reply-poke.hog) | „Piloti feedback: tell Piloti about a team reply" `01a16498-573f-0000-1b68-8fb6438e0cc0` | `$conversation_message_sent`, `author_type = team` | POSTs `{ ticketId }` to `https://<origin>/api/webhooks/posthog-support`; the host comes from the ticket's `origin:<host>` tag and must be in the `allowed_hosts` input |

**What reaches Slack is in the data-flow register.** Slack is a US processor
([`configs/subprocessors/slack.yaml`](../../configs/subprocessors/slack.yaml)):
ticket numbers, the kind, the deployment, the office's name, a closed-list
reason and links, never the text of a report, a reply or a chat. Since
2026-11-06 the two Slack destinations no longer quote the member's words; paste
both files again to bring the live destinations in line. A new destination, a
new `.hog` file or a new host one of them fetches fails
`scripts/check_data_flow_register.py` until a row names it.

Two things the live runtime does differently from the test runner
(`cdp-functions-invocations-create`), both found the hard way:
`postHogUpdateTicket` runs in a test and silently stops a live run, so no
destination writes to a ticket; and a live run logs nothing of a failure
before its first `print`, so every destination prints each step it completes.
Test a change by sending the real trigger event (the capture API with the
project token) and reading the destination's logs, not only by test-invoking it.

Inputs each destination needs: the Slack integration (`slack_workspace`,
integration 91399) and `channel` (`C0CBG0ZC0TB`) for the two Slack ones;
`default_host` (`app.piloti.at`) for the alert; `assignee_names` (PostHog user
id → display name, optional) for the claim update; `allowed_hosts`
(`["app.piloti.at", "app.dev.piloti.at"]`) for the poke.

The two Slack destinations also take `copy` (JSON): every word they post. The
code is English like the rest of the repo and reads `inputs.copy.<key>`; the
German values live in [`support/copy.de.json`](support/copy.de.json), the
way the app keeps its i18n dictionaries. Paste that file into the `copy` input
when it changes. `tests/test_posthog_hog_copy.py` fails German in the `.hog`
code and a key the code reads that the dictionary lacks.

The older workflow „Piloti feedback → Slack" (`01a163d8-dfc6-0000-3e2d-82d9d653bc47`)
posted from PostHog's own `$conversation_message_received`, which cannot say
which deployment a ticket came from, so its claim button always pointed at
production. It also posted every report a second time, to `#posthog-inbox`.
Archived on 2026-10-27, after the per-deployment destination was seen posting
the same reports to `#support-tickets`.

## Slack channels

One channel per question someone acts on. The PostHog Slack app (integration
91399) must be a member of each channel (`/invite @PostHog`), or every post
fails with `not_in_channel`.

| Channel | ID | The question it answers | What posts there |
|---|---|---|---|
| `#alerts-prod` | `C0CCG0Z1EKF` | Is production broken? | The „Platform health (prod)" alert; error-tracking spikes (`01a15d7e-e622-0000-12c9-4226994d613e`) and upstream outages, created and reopened (`01a159e8-d931-0000-1e37-d70888119726`, `01a159e8-dc54-0000-ef13-a9083eabd27c`): each posts the issue's title, which is the exception message |
| `#support-tickets` | `C0CBG0ZC0TB` | Does a member wait for us? | New reports and replies (`support/`), the 24-hour reminder |
| `#answer-quality` | `C0CCKAS3TRC` | Where did Piloti answer badly? | Thumbs-down votes with a reason |
| `#archos-metrics` (`#piloti-metrics` until 2026-10-30) | `C0CDFLKKYRE` | What does it cost, and how is the week going? | The „Costs and budgets (prod)" alert, the Monday report |
| `#posthog-inbox` | `C0CAHK8EYAF` | | Nothing any more: every destination moved to the channels above on 2026-10-27 |

## Alerts

The plan allows five insight alerts, so each alert covers one area. Its
insight computes one row per rule internally, then folds them into **one
row**: `rule` lists every rule that fired, joined with ` | ` („Keine Regel
verletzt" when none did), and `breach` counts them. An alert notifies when it
starts firing, not on every check.

Keep the result to one row. A scheduled check of an `any_row` alert over a
multi-row result errored on every run with only „This alert encountered an
error" (2026-10-27; the same query ran fine in the SQL editor, and
`alert-simulate` refuses `any_row` alerts, so nothing shows the real error).
Fold a new rule in with the same wrapper:
`SELECT … FROM (SELECT rule AS r, breach AS b FROM (<the per-rule rows>))`.
The inner columns are renamed because ClickHouse refuses an outer
`countIf(breach > 0)` over an inner `breach` alias.

| Alert | Insight (Slack destination) | Checked | Rules |
|---|---|---|---|
| Platform health (prod) | `tqqimEor` (`01a17ea5-0076-0000-c725-3cd6187d926a`) | hourly | The five per-area health tables of `docs/observability/metrics.md`, merged, plus „production sends no metrics at all", which the old heartbeat could not see: it only noticed a service that sent and then stopped |
| Support: feedback ticket waiting 24h+ (prod) | `gsIfpLwh` (`01a17ea5-03eb-0000-0596-3dccfc406539`) | hourly | A prod ticket, contact allowed, where the reporter spoke last more than 24 h and less than 7 days ago. Read from `$conversation_message_*` events: PostHog emits no event when a ticket is resolved, so a ticket resolved without a reply stays listed until its 7 days pass |
| Costs and budgets (prod) | `1GfF4oj1` (`01a17ea5-06b2-0000-a138-a2d2cd892bc5`) | hourly | An office at 90 %+ of its monthly budget or blocked by it; today's LLM cost above 25 USD and above twice the 14-day daily average; Claude chat reading under 20 % of its input from the prompt cache over 24 h (it read 0 % for a month until 2026-10-27, `packages/agent/src/agent/common/prompt_caching.py`). Cost equals price on the price list today, so a negative-margin rule would never fire |

## Destinations outside `support/`

| File | Destination in PostHog | Trigger | What it does |
|---|---|---|---|
| none: PostHog's Slack template with its inputs set | „Piloti answers: thumbs-down with a reason → Slack (prod)" `01a17e99-0271-0000-4f5a-8c22030a5fd0` | `answer_feedback_submitted` with `verdict = down`, `reason` set and `$host = app.piloti.at` | Posts to `#answer-quality`: the reason, the office, the page, the conversation and message ids, links to Platform → Answer quality and the person's replays. The vote's comment never reaches PostHog. A thumbs-down without a reason does not post: on its own it says too little to act on |
| [`surveys/chat-message-count.hog`](surveys/chat-message-count.hog) | „Piloti: count chat messages per person (NPS audience)" `01a17ea6-7a0c-0000-b8fe-252e2147be8c` | `chat_message_sent` | Sets the person property `chat_messages_total`, which the NPS survey targets (≥ 15) |

## Surveys and reports

| What | When | Audience |
|---|---|---|
| CSAT „nach Export" | 3 s after `report_exported` | 30 % of people, once per 30 days across surveys |
| NPS „power users" | 5 s after `chat_message_sent` | `chat_messages_total` ≥ 15, once per 90 days |
| „Wochenbericht" (subscription 65637) | Mondays 07:00 UTC | The dashboard „Wochenbericht (prod)" to `#archos-metrics`, with an AI summary on top: [`weekly-report/`](#weekly-report-weekly-report) |

## Weekly report: `weekly-report/`

Dashboard „Wochenbericht (prod)" (`/dashboard/1100370`), seven SQL insights
tagged `weekly-report`. Subscription 65637 posts them to `#archos-metrics`
every Monday: the summary and the first table in the message, the rest in its
thread. Every number is the saved SQL of this directory; only the summary's
sentences are written by a model, from those tables
(`summary_prompt_guide` on the subscription says how).

| File | Insight | Shows |
|---|---|---|
| [`scorecard.sql`](weekly-report/scorecard.sql) | `rvzHraLt` | One row per measure, last week against the week before |
| [`offices.sql`](weekly-report/offices.sql) | `TgGUEd5Z` | Each active customer office: people, chat, exports, documents, votes, cost, share of its monthly budget |
| [`chat-by-day.sql`](weekly-report/chat-by-day.sql) | `LyAsHs9M` | Chat messages per day and office, four weeks (stacked bars) |
| [`answer-quality.sql`](weekly-report/answer-quality.sql) | `VSrTWj6H` | Six weeks of answers, failed share, votes and the reasons given |
| [`cost-by-day.sql`](weekly-report/cost-by-day.sql) | `5CuIFWDG` | LLM cost per day and office, four weeks (stacked bars) |
| [`tickets.sql`](weekly-report/tickets.sql) | `kowfW0f0` | Feedback tickets opened last week and their state today |
| [`errors.sql`](weekly-report/errors.sql) | `B5kRwMbF` | The ten error-tracking issues with the most events, new ones marked |

What every query shares, as the `WITH` block at its top:

- **The week** is the last complete one, Monday to Sunday in the project's
  time zone (`toStartOfWeek(now(), 1)` is its end), so the dashboard reads the
  same on Monday morning and on Thursday.
- **Production is two properties.** A browser event carries `$host` and no
  `app_host`; a server event carries `app_host` and no `$host`. A filter on one
  of them silently drops the other half. The Python services carry neither and
  report `environment = production` on both stacks, so their errors cannot be
  told apart by deployment.
- **Customers** are every office except `internal_offices`, the same ids as the
  project's „internal and test" filter (Settings → Project). A new internal
  office is added in both places. Cost is the exception: it is the platform's
  bill, internal offices included.
- **Cost and budgets come from the ledger's events**, `llm_usage_hourly` and
  `organization_budget_snapshot`, not from the spend views built on them: a file
  here may not carry the product's name (`brand-names` hook), and the views do.
- **An active person** has a browser event on production with an
  `organization_id`. Server events are personless (one distinct id per event),
  so a count of people over them counts events.

To change a tile, edit its file, run `python3 deploy/posthog/weekly-report/compact.py <file>`
for the one-line string, test it with the PostHog MCP's `execute-sql`, then save
it into the insight (`insight-update`, or paste it in the SQL editor).

It replaced the AI-prompt subscription „Piloti Wochenbericht" (58130, paused
on 2026-11-10; a paused subscription still uses one of the plan's five slots, so delete it once nobody
wants it back). That kind lets a model write its own SQL on every run. Its
one delivery, on 2026-11-09, filtered every event on `app_host`: chat
messages, exports and votes read 0 (they were 94, 21 and 6), „active people"
was a count of 2 955 server events, and a daily budget warning was reported as
80 % of a monthly budget. A report whose numbers must be right is saved
insights; a model may summarise them, never query for them.

## Announcements

In-app announcements (a window or a banner, for a new guideline or a model
switch) are PostHog product tours, created in the PostHog UI. How to send one,
target it and read its reach: [`announcements.md`](announcements.md).
