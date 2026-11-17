---
name: querying-product-analytics
description: Use when querying this product's data in PostHog.
---

# Querying the product's data

Staging and production share PostHog project 269895.

- **Events:** query `prod_events`, or `customer_events` for customer numbers (our own offices left out), in place of `events`. Their `properties` is JSON text: `JSONExtractString(properties, 'key')`.
- **Metrics:** `deployment.environment.name="prod"`. **Logs:** `resource_attributes['deployment.environment.name'] = 'prod'`, from 2026-11-17; the message text is withheld by design.
- **Answers:** `answer_finished` counts every turn. `answer_completed` counts only answers someone watched in the browser.
- **LLM spend** is in the `piloti_*` views; `$ai_*` events are empty.
- **Request counts** come from a histogram's `_count` series: `increase({__name__="http.server.request.duration_count", "deployment.environment.name"="prod"}[24h])`.
- **Feature flags** live in WorkOS.
