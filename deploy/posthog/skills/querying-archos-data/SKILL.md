---
name: querying-archos-data
description: Use before any query of this product's data in PostHog project 269895 (usage, chat answers, LLM spend, errors, logs, metrics, replays). Says how to select production, where each number lives, and the traps that make a query read zero or double.
---

# Querying the product's data

Staging and production share this project, both run `APP_ENV=production`, and
production changed host on 2026-11-15. A query that does not select production
deliberately counts staging (which has several times production's traffic) or
reads zero since the move. Select production first, on every query, by the row
for the data you read.

## Production, per kind of data

| Data | Production is | Notes |
|---|---|---|
| Browser events (`$pageview`, `chat_message_sent`, `answer_completed`, `$rageclick`, web `$exception`) | `properties.$host IN ('app.archos.tech', 'app.piloti.at')` | `app.piloti.at` until 2026-11-14, `app.archos.tech` from 2026-11-15. Keep both for any window that crosses the move. `archos.tech`, `piloti.at`, `www.archos.tech` are the marketing website, not the app |
| Server events (BFF: `llm_usage_hourly`, `organization_budget_snapshot`, `agent_operation_called`, `document_ingest_*`, `budget_*`) | `properties.app_host IN ('app.archos.tech', 'app.piloti.at')` | Server events have no `$host`. Both kinds at once: `coalesce(properties.app_host, properties.$host)`. None before 2026-10-20 |
| Python events (`$exception` with `$lib = 'posthog-python'`) | `properties.app_host`, once the deploy that adds it (2026-11-17 or later) is out; check `countIf(properties.app_host IS NOT NULL)` | Older ones carry neither host and say `environment = 'production'` on both stacks: they cannot be split. Say so in the answer |
| Staging | `app.dev.archos.tech`, before 2026-11-05 `app.dev.piloti.at` | |
| Metrics (`query-metrics`, `posthog.metrics`) | `deployment.environment.name = 'prod'` | `dev` for staging |
| Logs (`logs` table) | `resource_attributes['deployment.environment.name'] = 'prod'` | Only from the collector deploy that adds it (2026-11-17 or later); older logs cannot be split. Severity is lowercase text (`warn`, `error`); WARN and above is `severity_number >= 13`. The message text is withheld by design: read `service_name`, the code location and the exception type |
| Langfuse export (`langfuse observation`, `langfuse score`) | not separable | `langfuse_environment = 'production'` on both stacks; `default` is the MCP gateway's own traces. No organization. `langfuse_latency` is milliseconds and needs `toFloat()` |

The repo's queries name the hosts once at the top:
`WITH ['app.piloti.at', 'app.archos.tech'] AS production_hosts` …
`WHERE has(production_hosts, coalesce(properties.app_host, properties.$host))`.

## Customer offices

Our own offices are excluded from customer numbers by `organization_id`:
`org_01KWEZPQ1B54E0KN9K838PCS89`, `org_01M34HRAZTEQPTD33H6WM3KY5K`,
`org_01KYVEVMY9X582SSN872SBTR03`, `org_01M3P5VW8791FSCFCBMW9HMC9V`,
`org_01M2TTD7J0N620NQ545ZDKSNGR`. The project's test-account filter holds the
same list, but only typed `query-*` tools apply it, and only with
`filterTestAccounts: true`. `execute-sql` applies nothing: write the filter.
An office is the group `organization` (`$group_0`) and the property
`organization_id`; its name is in `organization_budget_snapshot.organization_name`
or the views below.

## Where each number lives

| Question | Read | Trap |
|---|---|---|
| Questions asked | `chat_message_sent` | Browser-sent, carries `effort` (`medium`, `high`, `xhigh`) |
| Answers and failures | `answer_completed.outcome` (`ok`, `error`, `aborted`) | Browser-sent: an answer nobody watched sends none, so `chat_message_sent` minus `answer_completed` is "no report", not "failed" |
| Thumbs | `answer_feedback_submitted`: `verdict` (`up`, `down`), `reason` (`inaccurate`, `wrong_source`, `too_slow`, `other`) | `reason` is optional, null on most down votes |
| LLM spend | views `piloti_llm_usage_hourly` (by model, purpose, person), `piloti_org_spend_daily` (per office and UTC day), `piloti_org_budgets` (limits, who is blocked) | Never `$ai_*` events or PostHog's LLM-cost tools: they hold nothing here. Days are UTC (`day_utc`), as budgets are enforced. `amount` is in the office's own unit (credits, or tokens on its own key); for money use `cost_usd` (what the provider charged) |
| Cost per answer, per ingest | views `piloti_llm_cost_per_answer`, `piloti_llm_cost_per_ingest` | |
| Budget state now | `piloti_org_budgets`, or `argMax(…, timestamp)` per office over `organization_budget_snapshot` | The snapshot repeats hourly: summing it multiplies |
| Model mix | `piloti_llm_usage_hourly.model` | From 2026-11-11 some rows name the model twice (`openai/gpt-6.1-terraopenai/gpt-6.1-terra`). Fold with `if(length(m) % 2 = 0 AND left(m, intDiv(length(m), 2)) = right(m, intDiv(length(m), 2)), left(m, intDiv(length(m), 2)), m)` |
| Uploads and ingest | `document_uploaded` → `document_ingest_started` → `document_ingest_finished` (`status`) | Join on `document_id`; `started` has no `upload_id`. `finished` is sent by whichever BFF process noticed, so its `service` is not the worker |
| Agent and MCP use | `agent_operation_called`: `operation`, `session_source` (`ui`, `mcp`, `script`), `status`, `duration_ms` | `agent_operation_missing` carries a `category`, never the operation name: the agent's request is free text |
| Errors by runtime | `$exception` by `properties.$lib`: `web` browser, `posthog-node` BFF, `posthog-python` agent and workers | |
| Request latency | `posthog.trace_spans` (the Next.js tier only; the agent's spans are in Langfuse) | Leave out `/api/realtime`, `/api/stream` and `/api/mcp`: they are held-open streams, and their minutes swamp any percentile |
| Feature flags | not here | Flags live in WorkOS. `system.feature_flags` entries are unused |

## Traps

- **Dates.** The project zone is Europe/Vienna. `toDate(timestamp, 'Europe/Vienna')`
  is refused; write `toDate(toTimeZone(timestamp, 'Europe/Vienna'))`. Spend and
  budgets count UTC days.
- **Pages.** No path-cleaning rule is configured, so `$pathname` carries project
  ids. Group with
  `replaceRegexpAll(properties.$pathname, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', ':id')`.
- **Value lists are samples.** `read-data-schema` `event_property_values` can omit
  common values (it once left out the main production host). Confirm with a
  `GROUP BY` before you filter on a value, or before you say one is absent.
- **Metrics.** Pod and container series are labelled `k8s.pod.name` and
  `k8s.container.name`, not `service.name`. `aggregation: count` on a histogram
  counts series, not requests; count requests with PromQL, quoting the dotted
  name: `sum by ("http.response.status_code") (increase({__name__="http.server.request.duration"}[24h]))`.
  Queue depth is `grid.queue.depth` and `hatchet_tenant_queue_size`; chart both with `max`.
- **Small numbers.** Production has a handful of offices and tens of answers a
  week. Give counts beside every rate, and a longer window before calling a trend.

## Dashboards to start from

`Wochenbericht (prod)` 1100370, `Spend — alle Organisationen` 1038205,
`Spend — eine Organisation` 1038206 (SQL variable `piloti_deployment`),
`Spend — unit economics` 1085793, `Antwortqualität (prod)` 1061063,
`Büros: Gesundheit (prod)` 1061062, `Platform health (prod)` 1040252. The
project's primary dashboard (942030) is PostHog's starter template.

The source of this skill is `deploy/posthog/skills/querying-archos-data/SKILL.md`
in the product's repository; the event catalogue is `docs/observability/posthog-events.md`.
