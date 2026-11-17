---
name: querying-product-analytics
description: Use when querying this product's data in PostHog.
---

# Querying the product's data

Staging and production share project 269895. Select production on every query:

| Data | Production |
|---|---|
| Browser events | `properties.$host IN ('app.archos.tech', 'app.piloti.at')`; the host moved on 2026-11-15 |
| Server events (no `$host`) | `properties.app_host`, same two hosts. Both kinds: `coalesce(properties.app_host, properties.$host)` |
| Python `$exception` | `properties.app_host`, from 2026-11-17; older ones cannot be split |
| Metrics | `deployment.environment.name = 'prod'` |
| `logs` | `resource_attributes['deployment.environment.name'] = 'prod'`, from 2026-11-17. Message text is withheld by design |
| Langfuse export | tag `app_host:app.archos.tech` in `properties.langfuse_tags`, from 2026-11-17. A `langfuse score` has no tag: join on `langfuse_trace_id` |

Staging is `app.dev.archos.tech`, `dev` in metrics and logs.

Customer numbers exclude our own offices by `organization_id`:
`org_01KWEZPQ1B54E0KN9K838PCS89`, `org_01M34HRAZTEQPTD33H6WM3KY5K`,
`org_01KYVEVMY9X582SSN872SBTR03`, `org_01M3P5VW8791FSCFCBMW9HMC9V`,
`org_01M2TTD7J0N620NQ545ZDKSNGR`. `execute-sql` applies no test-account filter.

## Where numbers live

- **Answers:** `answer_finished` (server-sent, every turn: `outcome`, `duration_ms`, `door`). Before it existed, `answer_completed` counts only answers someone watched in the browser.
- **LLM spend:** views `piloti_llm_usage_hourly`, `piloti_org_spend_daily`, `piloti_org_budgets`, `piloti_llm_cost_per_answer`. `$ai_*` events are empty. Days are UTC; money is `cost_usd`.
- **Budget state:** `organization_budget_snapshot` repeats hourly, so take `argMax(…, timestamp)` per office.
- **Model names** from 2026-11-11 may repeat (`a/ba/b`): fold with `if(length(m) % 2 = 0 AND left(m, intDiv(length(m), 2)) = right(m, intDiv(length(m), 2)), left(m, intDiv(length(m), 2)), m)`.
- **Request counts:** the histogram's `_count` series, e.g. `increase({__name__="http.server.request.duration_count", "deployment.environment.name"="prod"}[24h])`. In `posthog.trace_spans`, leave out `/api/realtime`, `/api/stream`, `/api/mcp`: they are held-open streams.
- **Feature flags** live in WorkOS, not PostHog.
