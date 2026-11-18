# Debug a failed rollout in PostHog

A deploy that fails with `timed out waiting to be Ready` (or `updating failed`)
leaves its reason in two places PostHog Logs now holds, with no `kubectl`
needed:

- **Kubernetes events** from the app namespaces (`grid`, `background-work`,
  `cms`): probe failures, `BackOff`, `FailedScheduling`, `FailedMount`, image
  pull errors, OOM kills. Service `k8s-events`.
- **Container stdout/stderr** of every container in those namespaces that has no
  OTLP SDK of its own: the CMS, the website, the Jobs (`migrate` and the rest),
  Hatchet, Gotenberg. Service = the container name, so the CMS is `cms`.

The SDK services (`api`, `chat`, `frontend` and the other OTLP-instrumented
tiers) are not read from stdout: they already send their WARN+ logs, with the
text withheld. Their crash before the SDK starts shows as events (`BackOff`,
`Unhealthy`), not as lines.

## Recipe

Use the PostHog MCP's `query-logs` (or Logs in the PostHog UI with the same
filters). Always add `deployment.environment.name` (`dev` or `prod`).

1. **Which pod is stuck?** The Warning events of the window, newest first:

   ```json
   { "query": {
       "serviceNames": ["k8s-events"],
       "severityLevels": ["warn"],
       "filterGroup": [
         { "key": "deployment.environment.name", "type": "log_resource_attribute", "operator": "exact", "value": "dev" }
       ],
       "dateRange": { "date_from": "-1h" } } }
   ```

   Each row's body is the event's note; its attributes carry
   `k8s.event.reason`, `k8s.object.kind`, `k8s.object.name` and
   `k8s.object.field_path` (which container). To look for one cause, filter
   `{ "key": "k8s.event.reason", "type": "log_attribute", "operator": "exact", "value": "Unhealthy" }`
   (or `BackOff`, `FailedScheduling`, `FailedMount`, `Failed`).

2. **What did it say?** Everything for that pod, events and its own lines
   together, oldest first:

   ```json
   { "query": {
       "filterGroup": [
         { "key": "k8s.pod.name", "type": "log_resource_attribute", "operator": "exact", "value": "cms-7d9f8c6b5-x2x9q" }
       ],
       "orderBy": "earliest",
       "dateRange": { "date_from": "-1h" } } }
   ```

   Not sure of the pod name? Filter `k8s.deployment.name` (container lines) or
   `k8s.object.name` with `starts_with` (events) instead.

## What is kept, and what it costs

The shipper (`otel-logs`) drops debug lines, keeps warn and above in full and
keeps 10% of info lines (`LOG_SHIPPER.infoSamplePercent`). A line has no level
of its own, so the shipper reads one from the text (`LEVEL_PATTERNS` in
`deploy/pulumi/src/platform/log-shipper.ts`); an unrecognised stderr line counts
as warn, so a crash's stack trace survives. Lines longer than 16 KiB are cut.
Normal events are kept as info rows, Warning events as warn rows; deletions
(an event aging out) are dropped.

Estimated volume (not measured, from the workloads and CronJob schedules): about
9,000 events a day, most of them the Normal events of `housekeeping-ghost-jobs`
running every 2 minutes, and 2,000 to 10,000 container lines a day after
sampling, so 10,000 to 20,000 rows and 5 to 15 MB a day per stack.

How it is wired: [`deployment/kubernetes.md`](../deployment/kubernetes.md) §9,
"Container logs and Kubernetes events".
