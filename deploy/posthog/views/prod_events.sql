-- Production's events, every kind: browser, server, agent and the Langfuse export.
-- Staging shares the project; this is the one place that tells them apart.
-- Production changed host on 2026-11-15 (app.piloti.at to app.archos.tech).
SELECT
    e.uuid AS uuid,
    e.event AS event,
    e.timestamp AS timestamp,
    -- distinct_id is the person (the app identifies everyone by their user id).
    -- No person_id: PostHog resolves it through a join, and the outer time filter
    -- then reads every row.
    e.distinct_id AS distinct_id,
    e.`$session_id` AS session_id,
    e.properties AS properties,
    coalesce(
        e.properties.app_host,
        e.properties.$host,
        -- Langfuse observations name their stack in a tag, from 2026-11-17. A regex,
        -- not arrayFirst: a lambda here stops the outer time filter narrowing the scan.
        nullIf(extract(coalesce(e.properties.langfuse_tags, ''), 'app_host:([a-z0-9.-]+)'), '')
    ) AS app_host,
    coalesce(e.properties.organization_id, e.`$group_0`) AS organization_id
FROM events AS e
WHERE app_host IN ('app.archos.tech', 'app.piloti.at')
