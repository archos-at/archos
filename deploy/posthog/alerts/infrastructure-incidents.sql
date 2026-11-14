-- Reads `posthog.metrics` only, never `events`: PostHog refuses a query over
-- both clusters and switches the alert off (2026-11-14). Event rules live in
-- product-incidents.sql.
SELECT
    if(countIf(b > 0) = 0, 'Keine Regel verletzt', arrayStringConcat(groupArrayIf(r, b > 0), ' | ')) AS rule,
    toFloat(countIf(b > 0)) AS breach
FROM (SELECT rule AS r, breach AS b FROM (
SELECT
    concat('[Objektspeicher] ', env, ': ', arrayStringConcat(arrayFilter(x -> x != '', [
        if(total > 0 AND used / total > 0.85, concat('Datenträger ', toString(round(used / total * 100)), ' % belegt'), ''),
        if(length(readonly) > 0, concat('ohne beschreibbares Volume (Platz knapp): ', arrayStringConcat(readonly, ', ')), '')
    ]), '; ')) AS rule,
    toFloat(if((total > 0 AND used / total > 0.85) OR length(readonly) > 0, 1, 0)) AS breach
FROM (
    -- Every stack, dev included. A SeaweedFS disk past its free-space floor turns
    -- volumes read-only, and every write into such a bucket answers a bare 500:
    -- dev's 10 GiB disk filled on 2026-11-12 and project mail and uploads failed
    -- for two days before anyone looked (docs/contributing/gotchas.md).
    SELECT
        coalesce(sr.resource_attributes['deployment.environment.name'], '?') AS env,
        maxIf(m.value, m.metric_name = 'SeaweedFS_volumeServer_resource' AND sr.attributes['type'] = 'used') AS used,
        maxIf(m.value, m.metric_name = 'SeaweedFS_volumeServer_resource' AND sr.attributes['type'] = 'all') AS total,
        arrayDistinct(groupArrayIf(sr.attributes['collection'], m.metric_name = 'SeaweedFS_volumeServer_read_only_volumes'
            AND sr.attributes['type'] = 'isDiskSpaceLow' AND m.value > 0 AND sr.attributes['collection'] != '')) AS readonly
    FROM posthog.metrics AS m
    INNER JOIN posthog.metric_series AS sr ON sr.series_fingerprint = m.series_fingerprint
    WHERE m.timestamp > now() - INTERVAL 15 MINUTE
        AND m.metric_name IN ('SeaweedFS_volumeServer_resource', 'SeaweedFS_volumeServer_read_only_volumes')
    GROUP BY env
)
UNION ALL
SELECT
    concat('[Jobs] ', env, ': fehlgeschlagen ohne Erfolg (26 h): ', arrayStringConcat(groupUniqArray(10)(name), ', ')) AS rule,
    toFloat(count()) AS breach
FROM (
    -- Every stack. A Kubernetes Job (a CronJob's run) that failed and never
    -- succeeded in the last 26 h. qdrant-snapshot failed every day on dev and
    -- prod, its retries took the snapshots again, and prod's SeaweedFS filled
    -- to 91 % before anything said so (2026-11-14).
    SELECT
        coalesce(sr.resource_attributes['deployment.environment.name'], '?') AS env,
        replaceRegexpOne(sr.resource_attributes['k8s.job.name'], '-[0-9]{6,}$', '') AS name,
        sr.resource_attributes['k8s.job.name'] AS job,
        argMaxIf(m.value, m.timestamp, m.metric_name = 'k8s.job.failed_pods') AS failed,
        argMaxIf(m.value, m.timestamp, m.metric_name = 'k8s.job.successful_pods') AS ok
    FROM posthog.metrics AS m
    INNER JOIN posthog.metric_series AS sr ON sr.series_fingerprint = m.series_fingerprint
    WHERE m.timestamp > now() - INTERVAL 26 HOUR
        AND m.metric_name IN ('k8s.job.failed_pods', 'k8s.job.successful_pods')
    GROUP BY env, name, job
    HAVING failed > 0 AND ok = 0
)
GROUP BY env
))
