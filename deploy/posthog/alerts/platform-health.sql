-- Platform health (prod), insight tqqimEor. Reads `posthog.metrics` only,
-- never `events`: PostHog refuses a query over both clusters and switches the
-- alert off (2026-11-14). Production only; Infrastructure incidents covers
-- every stack.
--
-- Every label lookup joins a `metric_series` subquery cut to the hours the
-- rule reads, the environment and the metric names. A bare join reads all
-- of `metric_series` (one row per series and hour, 30 days, every stack) once
-- per reference, and a CTE runs once per reference: the unpruned query read
-- 75 GiB on 2026-11-05 and hit PostHog's 139.7 GiB limit on 2026-11-14.
SELECT
    if(countIf(b > 0) = 0, 'Keine Regel verletzt', arrayStringConcat(groupArrayIf(r, b > 0), ' | ')) AS rule,
    toFloat(countIf(b > 0)) AS breach
FROM (SELECT rule AS r, breach AS b FROM (
SELECT concat('[Telemetrie] ', rule) AS rule, breach FROM (
WITH apps AS (
    -- The Node tiers report their runtime every 30 s; the Python ones may
    -- export nothing while idle. 24 h is how long a silent one stays listed.
    SELECT
        m.service_name AS service,
        max(m.timestamp) AS last_seen
    FROM posthog.metrics AS m
    INNER JOIN (
        SELECT series_fingerprint
        FROM posthog.metric_series
        WHERE time_bucket >= toStartOfHour(now() - INTERVAL 25 HOUR)
            AND service_name IN ('grid-ui', 'grid-bff-jobs', 'grid-purger')
            AND resource_attributes['deployment.environment.name'] = 'prod'
        GROUP BY series_fingerprint
    ) AS sr ON sr.series_fingerprint = m.series_fingerprint
    WHERE m.timestamp > now() - INTERVAL 24 HOUR
        AND m.service_name IN ('grid-ui', 'grid-bff-jobs', 'grid-purger')
    GROUP BY service
),
nodes AS (
    SELECT
        sr.node AS node,
        maxIf(m.timestamp, m.metric_name = 'k8s.node.condition_ready') AS listed,
        maxIf(m.timestamp, m.metric_name = 'k8s.node.cpu.usage') AS read
    FROM posthog.metrics AS m
    INNER JOIN (
        SELECT series_fingerprint, any(resource_attributes['k8s.node.name']) AS node
        FROM posthog.metric_series
        WHERE time_bucket >= toStartOfHour(now() - INTERVAL 2 HOUR)
            AND metric_name IN ('k8s.node.condition_ready', 'k8s.node.cpu.usage')
            AND resource_attributes['deployment.environment.name'] = 'prod'
        GROUP BY series_fingerprint
    ) AS sr ON sr.series_fingerprint = m.series_fingerprint
    WHERE m.timestamp > now() - INTERVAL 1 HOUR
        AND m.metric_name IN ('k8s.node.condition_ready', 'k8s.node.cpu.usage')
        AND sr.node != ''
    GROUP BY node
)
SELECT
    'Production sends no metrics at all (nothing labelled prod in the last 20 min)' AS rule,
    toFloat(if(countIf(last_seen > now() - INTERVAL 20 MINUTE) = 0, 1, 0)) AS breach
FROM apps
UNION ALL
SELECT
    concat('Stopped sending metrics 20+ min ago: ', arrayStringConcat(groupArrayIf(service, last_seen < now() - INTERVAL 20 MINUTE), ', ')),
    toFloat(countIf(last_seen < now() - INTERVAL 20 MINUTE))
FROM apps
UNION ALL
SELECT
    'Cluster state (k8s_cluster on the gateway collector) stopped 20+ min ago',
    toFloat(if(count() > 0 AND max(m.timestamp) < now() - INTERVAL 20 MINUTE, 1, 0))
FROM posthog.metrics AS m
INNER JOIN (
    SELECT series_fingerprint
    FROM posthog.metric_series
    WHERE time_bucket >= toStartOfHour(now() - INTERVAL 25 HOUR)
        AND metric_name = 'k8s.deployment.desired'
        AND resource_attributes['deployment.environment.name'] = 'prod'
    GROUP BY series_fingerprint
) AS sr ON sr.series_fingerprint = m.series_fingerprint
WHERE m.timestamp > now() - INTERVAL 24 HOUR
    AND m.metric_name = 'k8s.deployment.desired'
UNION ALL
-- One hour is enough: a node listed in the last 20 min whose agent sent
-- nothing in those 20 min fires whether the agent stopped 30 min or a day ago.
SELECT
    concat('Node agent silent on a node the cluster still lists: ', arrayStringConcat(groupArrayIf(node, listed > now() - INTERVAL 20 MINUTE AND read < now() - INTERVAL 20 MINUTE), ', ')),
    toFloat(countIf(listed > now() - INTERVAL 20 MINUTE AND read < now() - INTERVAL 20 MINUTE))
FROM nodes
)
UNION ALL
SELECT concat('[Workloads] ', rule) AS rule, breach FROM (
WITH s AS (
    SELECT
        m.series_fingerprint AS fp,
        any(m.metric_name) AS metric,
        any(sr.resource) AS res,
        argMax(m.value, m.timestamp) AS latest,
        min(m.timestamp) AS first_ts,
        min(m.value) AS lo,
        max(m.value) AS hi,
        minIf(m.value, m.timestamp > now() - INTERVAL 15 MINUTE) AS lo15,
        maxIf(m.value, m.timestamp > now() - INTERVAL 15 MINUTE) AS hi15
    FROM posthog.metrics AS m
    INNER JOIN (
        SELECT series_fingerprint, any(resource_attributes) AS resource
        FROM posthog.metric_series
        WHERE time_bucket >= toStartOfHour(now() - INTERVAL 2 HOUR)
            AND resource_attributes['deployment.environment.name'] = 'prod'
            AND metric_name IN (
                'k8s.container.restarts', 'k8s.pod.phase', 'k8s.job.desired_successful_pods',
                'k8s.deployment.desired', 'k8s.deployment.available',
                'k8s.statefulset.desired_pods', 'k8s.statefulset.ready_pods',
                'k8s.daemonset.desired_scheduled_nodes', 'k8s.daemonset.ready_nodes',
                'k8s.node.condition_ready', 'k8s.node.condition_memory_pressure',
                'k8s.node.condition_disk_pressure', 'k8s.node.condition_pid_pressure',
                'k8s.volume.available', 'k8s.volume.capacity',
                'container.memory.working_set', 'k8s.container.memory_limit')
        GROUP BY series_fingerprint
    ) AS sr ON sr.series_fingerprint = m.series_fingerprint
    WHERE m.timestamp > now() - INTERVAL 1 HOUR
        AND m.metric_name IN (
            'k8s.container.restarts', 'k8s.pod.phase', 'k8s.job.desired_successful_pods',
            'k8s.deployment.desired', 'k8s.deployment.available',
            'k8s.statefulset.desired_pods', 'k8s.statefulset.ready_pods',
            'k8s.daemonset.desired_scheduled_nodes', 'k8s.daemonset.ready_nodes',
            'k8s.node.condition_ready', 'k8s.node.condition_memory_pressure',
            'k8s.node.condition_disk_pressure', 'k8s.node.condition_pid_pressure',
            'k8s.volume.available', 'k8s.volume.capacity',
            'container.memory.working_set', 'k8s.container.memory_limit')
    GROUP BY fp
),
pods AS (
    -- A Job's pod is named after the Job, cut to 58 characters, plus five
    -- random ones. A failed Job pod stays listed for hours after a retry
    -- succeeded: two kopia maintenance pods kept this firing for four hours
    -- on 2026-11-05. Failed Jobs are Infrastructure incidents' [Jobs] rule;
    -- a Job pod counts here only when Pending for the whole hour.
    SELECT
        res['k8s.pod.name'] AS name,
        concat(res['k8s.namespace.name'], '/', substring(res['k8s.pod.name'], 1, length(res['k8s.pod.name']) - 5)) IN (
            SELECT concat(res['k8s.namespace.name'], '/', substring(concat(res['k8s.job.name'], '-'), 1, 58))
            FROM s WHERE metric = 'k8s.job.desired_successful_pods'
        ) AS job_pod,
        (NOT job_pod AND lo15 = hi15 AND hi15 IN (1, 4))
            OR (job_pod AND lo = 1 AND hi = 1 AND first_ts < now() - INTERVAL 55 MINUTE) AS stuck
    FROM s WHERE metric = 'k8s.pod.phase'
),
workloads AS (
    SELECT
        concat(res['k8s.deployment.name'], res['k8s.statefulset.name'], res['k8s.daemonset.name']) AS name,
        maxIf(latest, metric IN ('k8s.deployment.desired', 'k8s.statefulset.desired_pods', 'k8s.daemonset.desired_scheduled_nodes')) AS want,
        maxIf(hi15, metric IN ('k8s.deployment.available', 'k8s.statefulset.ready_pods', 'k8s.daemonset.ready_nodes')) AS best15
    FROM s
    WHERE metric IN ('k8s.deployment.desired', 'k8s.deployment.available', 'k8s.statefulset.desired_pods', 'k8s.statefulset.ready_pods', 'k8s.daemonset.desired_scheduled_nodes', 'k8s.daemonset.ready_nodes')
    GROUP BY name
),
volumes AS (
    SELECT
        concat(res['k8s.pod.name'], '/', res['k8s.volume.name']) AS name,
        maxIf(latest, metric = 'k8s.volume.available') AS free,
        maxIf(latest, metric = 'k8s.volume.capacity') AS size
    FROM s
    WHERE metric IN ('k8s.volume.available', 'k8s.volume.capacity') AND res['k8s.volume.type'] = 'persistentVolumeClaim'
    GROUP BY name
),
memory AS (
    SELECT
        concat(res['k8s.pod.name'], '/', res['k8s.container.name']) AS name,
        maxIf(lo15, metric = 'container.memory.working_set') AS used15,
        maxIf(latest, metric = 'k8s.container.memory_limit') AS cap
    FROM s
    WHERE metric IN ('container.memory.working_set', 'k8s.container.memory_limit')
    GROUP BY name
)
SELECT
    concat('Crash-looping (3+ restarts in 1h): ', arrayStringConcat(groupArrayIf(concat(res['k8s.pod.name'], '/', res['k8s.container.name']), hi - lo >= 3), ', ')) AS rule,
    toFloat(countIf(hi - lo >= 3)) AS breach
FROM s WHERE metric = 'k8s.container.restarts'
UNION ALL
SELECT
    concat('Pending or failed for 15 min (a Job pod: Pending for 1 h): ', arrayStringConcat(groupArrayIf(name, stuck), ', ')),
    toFloat(countIf(stuck))
FROM pods
UNION ALL
SELECT
    concat('Below desired replicas for 15 min: ', arrayStringConcat(groupArrayIf(name, want > 0 AND best15 < want), ', ')),
    toFloat(countIf(want > 0 AND best15 < want))
FROM workloads
UNION ALL
SELECT
    concat('Node not ready or under pressure: ', arrayStringConcat(groupArrayIf(concat(res['k8s.node.name'], ' ', metric), (metric = 'k8s.node.condition_ready' AND latest != 1) OR (metric != 'k8s.node.condition_ready' AND latest = 1)), ', ')),
    toFloat(countIf((metric = 'k8s.node.condition_ready' AND latest != 1) OR (metric != 'k8s.node.condition_ready' AND latest = 1)))
FROM s WHERE metric LIKE 'k8s.node.condition%'
UNION ALL
SELECT
    concat('Volume over 85% full: ', arrayStringConcat(groupArrayIf(name, size > 0 AND free / size < 0.15), ', ')),
    toFloat(countIf(size > 0 AND free / size < 0.15))
FROM volumes
UNION ALL
SELECT
    concat('Container above 90% of its memory limit for 15 min (OOM risk): ', arrayStringConcat(groupArrayIf(name, cap > 0 AND used15 / cap > 0.9), ', ')),
    toFloat(countIf(cap > 0 AND used15 / cap > 0.9))
FROM memory
)
UNION ALL
SELECT concat('[Datenbanken] ', rule) AS rule, breach FROM (
WITH s AS (
    SELECT
        m.series_fingerprint AS fp,
        any(m.metric_name) AS metric,
        any(m.service_name) AS service,
        any(sr.labels) AS attrs,
        argMax(m.value, m.timestamp) AS latest,
        min(m.value) AS lo,
        max(m.value) AS hi,
        minIf(m.value, m.timestamp > now() - INTERVAL 15 MINUTE) AS lo15,
        maxIf(m.value, m.timestamp > now() - INTERVAL 15 MINUTE) AS hi15
    FROM posthog.metrics AS m
    INNER JOIN (
        SELECT series_fingerprint, any(attributes) AS labels
        FROM posthog.metric_series
        WHERE time_bucket >= toStartOfHour(now() - INTERVAL 2 HOUR)
            AND resource_attributes['deployment.environment.name'] = 'prod'
            AND metric_name IN ('cnpg_collector_up', 'cnpg_pg_replication_lag', 'cnpg_pgbouncer_pools_cl_waiting', 'up', 'dragonfly_memory_used_bytes', 'dragonfly_memory_used', 'dragonfly_memory_max_bytes', 'dragonfly_memory_max', 'dragonfly_evicted_keys_total', 'dragonfly_evicted_keys')
        GROUP BY series_fingerprint
    ) AS sr ON sr.series_fingerprint = m.series_fingerprint
    WHERE m.timestamp > now() - INTERVAL 1 HOUR
        AND m.metric_name IN ('cnpg_collector_up', 'cnpg_pg_replication_lag', 'cnpg_pgbouncer_pools_cl_waiting', 'up', 'dragonfly_memory_used_bytes', 'dragonfly_memory_used', 'dragonfly_memory_max_bytes', 'dragonfly_memory_max', 'dragonfly_evicted_keys_total', 'dragonfly_evicted_keys')
    GROUP BY fp
),
dragonflies AS (
    SELECT
        service,
        maxIf(latest, metric IN ('dragonfly_memory_used_bytes', 'dragonfly_memory_used')) AS used,
        maxIf(latest, metric IN ('dragonfly_memory_max_bytes', 'dragonfly_memory_max')) AS cap
    FROM s WHERE metric LIKE 'dragonfly_memory_%'
    GROUP BY service
)
SELECT
    concat('Postgres instance not answering its exporter: ', arrayStringConcat(groupArrayIf(attrs['k8s_pod_name'], latest = 0), ', ')) AS rule,
    toFloat(countIf(latest = 0)) AS breach
FROM s WHERE metric = 'cnpg_collector_up'
UNION ALL
SELECT
    concat('Postgres replica 60+ s behind for 15 min: ', arrayStringConcat(groupArrayIf(attrs['k8s_pod_name'], lo15 > 60), ', ')),
    toFloat(countIf(lo15 > 60))
FROM s WHERE metric = 'cnpg_pg_replication_lag'
UNION ALL
SELECT
    concat('PgBouncer clients waiting for a connection for 15 min: ', arrayStringConcat(arrayDistinct(groupArrayIf(attrs['k8s_pod_name'], lo15 > 0)), ', ')),
    toFloat(countIf(lo15 > 0))
FROM s WHERE metric = 'cnpg_pgbouncer_pools_cl_waiting'
UNION ALL
SELECT
    concat('Qdrant peer down for 15 min: ', arrayStringConcat(groupArrayIf(attrs['peer'], hi15 = 0), ', ')),
    toFloat(countIf(hi15 = 0))
FROM s WHERE metric = 'up' AND service = 'qdrant'
UNION ALL
SELECT
    concat('Dragonfly over 90% of its memory limit: ', arrayStringConcat(groupArrayIf(service, cap > 0 AND used / cap > 0.9 AND service != 'dragonfly'), ', ')),
    toFloat(countIf(cap > 0 AND used / cap > 0.9 AND service != 'dragonfly'))
FROM dragonflies
UNION ALL
SELECT
    'Langfuse ingestion queue evicted jobs in the last hour (traces lost)',
    toFloat(sumIf(hi - lo, hi > lo))
FROM s WHERE metric IN ('dragonfly_evicted_keys_total', 'dragonfly_evicted_keys') AND service = 'dragonfly-langfuse'
)
UNION ALL
SELECT concat('[Hintergrundjobs] ', rule) AS rule, breach FROM (
WITH s AS (
    SELECT
        m.series_fingerprint AS fp,
        any(m.metric_name) AS metric,
        any(sr.labels) AS attrs,
        any(sr.resource) AS res,
        argMax(m.value, m.timestamp) AS latest,
        min(m.value) AS lo,
        max(m.value) AS hi,
        minIf(m.value, m.timestamp > now() - INTERVAL 15 MINUTE) AS lo15,
        minIf(m.value, m.timestamp > now() - INTERVAL 30 MINUTE) AS lo30
    FROM posthog.metrics AS m
    INNER JOIN (
        SELECT series_fingerprint, any(resource_attributes) AS resource, any(attributes) AS labels
        FROM posthog.metric_series
        WHERE time_bucket >= toStartOfHour(now() - INTERVAL 2 HOUR)
            AND resource_attributes['deployment.environment.name'] = 'prod'
            AND metric_name IN ('grid.queue.oldest_age_seconds', 'grid.queue.dead_total', 'k8s.hpa.current_replicas', 'k8s.hpa.max_replicas', 'keda_scaled_object_errors_total', 'keda_scaled_object_errors')
        GROUP BY series_fingerprint
    ) AS sr ON sr.series_fingerprint = m.series_fingerprint
    WHERE m.timestamp > now() - INTERVAL 1 HOUR
        AND m.metric_name IN ('grid.queue.oldest_age_seconds', 'grid.queue.dead_total', 'k8s.hpa.current_replicas', 'k8s.hpa.max_replicas', 'keda_scaled_object_errors_total', 'keda_scaled_object_errors')
    GROUP BY fp
),
hpas AS (
    SELECT
        res['k8s.hpa.name'] AS name,
        maxIf(lo30, metric = 'k8s.hpa.current_replicas') AS floor30,
        maxIf(latest, metric = 'k8s.hpa.max_replicas') AS ceiling
    FROM s WHERE metric LIKE 'k8s.hpa.%'
    GROUP BY name
)
SELECT
    concat('Queue backed up (oldest job waiting 30+ min for 15 min): ', arrayStringConcat(arrayDistinct(groupArrayIf(attrs['queue'], lo15 > 1800)), ', ')) AS rule,
    toFloat(countIf(lo15 > 1800)) AS breach
FROM s WHERE metric = 'grid.queue.oldest_age_seconds'
UNION ALL
SELECT
    concat('Jobs died in the last hour: ', arrayStringConcat(arrayDistinct(groupArrayIf(attrs['queue'], hi > lo)), ', ')),
    toFloat(sumIf(hi - lo, hi > lo))
FROM s WHERE metric = 'grid.queue.dead_total'
UNION ALL
SELECT
    concat('KEDA cannot read a trigger (scaler errors in 1h): ', arrayStringConcat(arrayDistinct(groupArrayIf(attrs['scaledObject'], hi > lo)), ', ')),
    toFloat(sumIf(hi - lo, hi > lo))
FROM s WHERE metric IN ('keda_scaled_object_errors_total', 'keda_scaled_object_errors')
UNION ALL
SELECT
    concat('Autoscaler pinned at its ceiling for 30 min: ', arrayStringConcat(groupArrayIf(name, ceiling > 0 AND floor30 >= ceiling), ', ')),
    toFloat(countIf(ceiling > 0 AND floor30 >= ceiling))
FROM hpas
)
UNION ALL
SELECT concat('[Anwendung] ', rule) AS rule, breach FROM (
WITH s AS (
    SELECT
        m.series_fingerprint AS fp,
        any(m.metric_name) AS metric,
        any(m.service_name) AS service,
        any(sr.labels) AS attrs,
        any(sr.resource) AS res,
        min(m.value) AS lo,
        max(m.value) AS hi,
        minIf(m.value, m.timestamp > now() - INTERVAL 15 MINUTE) AS lo15,
        max(m.count) - min(m.count) AS calls
    FROM posthog.metrics AS m
    INNER JOIN (
        SELECT series_fingerprint, any(resource_attributes) AS resource, any(attributes) AS labels
        FROM posthog.metric_series
        WHERE time_bucket >= toStartOfHour(now() - INTERVAL 2 HOUR)
            AND resource_attributes['deployment.environment.name'] = 'prod'
            AND metric_name IN ('http.server.request.duration', 'nodejs.eventloop.delay.p99', 'grid.provider.throttled_total')
        GROUP BY series_fingerprint
    ) AS sr ON sr.series_fingerprint = m.series_fingerprint
    WHERE m.timestamp > now() - INTERVAL 1 HOUR
        AND m.metric_name IN ('http.server.request.duration', 'nodejs.eventloop.delay.p99', 'grid.provider.throttled_total')
    GROUP BY fp
),
http AS (
    SELECT
        sumIf(calls, startsWith(attrs['http.response.status_code'], '5')) AS failed,
        sum(calls) AS total
    FROM s
    WHERE metric = 'http.server.request.duration' AND attrs['grid.route.class'] != 'health'
)
SELECT
    concat('BFF answered 5% or more with 5xx in the last hour (', toString(failed), ' of ', toString(total), ' requests)') AS rule,
    toFloat(if(total >= 200 AND failed / total >= 0.05, failed / total, 0)) AS breach
FROM http
UNION ALL
SELECT
    concat('Node event loop stalled (p99 delay above 0.5 s for 15 min): ', arrayStringConcat(groupArrayIf(concat(service, ' ', res['service.instance.id']), lo15 > 0.5), ', ')),
    toFloat(countIf(lo15 > 0.5))
FROM s WHERE metric = 'nodejs.eventloop.delay.p99'
UNION ALL
SELECT
    concat('Model provider throttling (30+ 429s in the last hour): ', arrayStringConcat(arrayDistinct(groupArrayIf(attrs['model'], hi > lo)), ', ')),
    toFloat(if(sumIf(hi - lo, hi > lo) >= 30, sumIf(hi - lo, hi > lo), 0))
FROM s WHERE metric = 'grid.provider.throttled_total'
)
))
