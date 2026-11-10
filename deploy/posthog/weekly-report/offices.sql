-- Tile 2, "Büros": one row per customer office active last week.
-- Scope as in scorecard.sql. The budget share is this month's, from the latest
-- organization_budget_snapshot; cost is the week's llm_usage_hourly.
WITH
    toStartOfWeek(now(), 1) AS week_end,
    week_end - INTERVAL 7 DAY AS week_start,
    week_start - INTERVAL 7 DAY AS previous_start,
    ['app.piloti.at', 'app.archos.tech'] AS production_hosts,
    ['org_01KWEZPQ1B54E0KN9K838PCS89', 'org_01M34HRAZTEQPTD33H6WM3KY5K', 'org_01KYVEVMY9X582SSN872SBTR03',
     'org_01M3P5VW8791FSCFCBMW9HMC9V', 'org_01M2TTD7J0N620NQ545ZDKSNGR'] AS internal_offices
SELECT
    coalesce(names.name, usage.office) AS `Büro`,
    usage.people AS `Aktive Personen`,
    usage.chat AS `Chat-Nachrichten`,
    multiIf(usage.chat = usage.chat_previous, '±0',
            usage.chat_previous = 0, 'neu',
            concat(if(usage.chat >= usage.chat_previous, '+', '−'),
                   toString(round(abs(usage.chat - usage.chat_previous) / usage.chat_previous * 100)), ' %')) AS `Chat zur Vorwoche`,
    usage.exports AS `Exporte`,
    usage.documents AS `Dokumente`,
    usage.thumbs_up AS `Daumen hoch`,
    usage.thumbs_down AS `Daumen runter`,
    concat(toString(round(ifNull(spend.cost, 0), 2)), ' USD') AS `LLM-Kosten`,
    if(budgets.month_pct IS NULL, '–', concat(toString(round(budgets.month_pct)), ' %')) AS `Monatsbudget genutzt`
FROM (
    SELECT
        properties.organization_id AS office,
        uniqIf(person_id, timestamp >= week_start AND properties.$host IN production_hosts) AS people,
        countIf(timestamp >= week_start AND event = 'chat_message_sent') AS chat,
        countIf(timestamp < week_start AND event = 'chat_message_sent') AS chat_previous,
        countIf(timestamp >= week_start AND event = 'report_exported') AS exports,
        countIf(timestamp >= week_start AND event = 'document_ingest_finished' AND properties.status = 'completed') AS documents,
        countIf(timestamp >= week_start AND event = 'answer_feedback_submitted' AND properties.verdict = 'up') AS thumbs_up,
        countIf(timestamp >= week_start AND event = 'answer_feedback_submitted' AND properties.verdict = 'down') AS thumbs_down
    FROM events
    WHERE timestamp >= previous_start AND timestamp < week_end
      AND (properties.$host IN production_hosts OR properties.app_host IN production_hosts)
      AND event != '$exception'
      AND properties.organization_id IS NOT NULL
      AND properties.organization_id NOT IN internal_offices
    GROUP BY office
) AS usage
LEFT JOIN (
    SELECT properties.organization_id AS organization_id, sum(toFloat(properties.cost_usd)) AS cost
    FROM events
    WHERE event = 'llm_usage_hourly'
      AND timestamp >= week_start AND timestamp < week_end
      AND properties.app_host IN production_hosts
    GROUP BY organization_id
) AS spend ON spend.organization_id = usage.office
LEFT JOIN (
    SELECT properties.organization_id AS organization_id, argMax(toFloat(properties.month_pct), timestamp) AS month_pct
    FROM events
    WHERE event = 'organization_budget_snapshot'
      AND timestamp >= now() - INTERVAL 7 DAY
      AND properties.app_host IN production_hosts
    GROUP BY organization_id
) AS budgets ON budgets.organization_id = usage.office
LEFT JOIN (SELECT id, name FROM workos_organizations) AS names ON names.id = usage.office
WHERE usage.people > 0 OR usage.chat > 0 OR usage.documents > 0
ORDER BY usage.chat DESC, usage.people DESC
