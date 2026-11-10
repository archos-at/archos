-- Tile 7, "Fehler": the ten error-tracking issues with the most events last week.
-- "neu" = the issue was first seen last week. The Python services send neither $host nor
-- app_host and report environment = production on both stacks, so their rows cover staging too.
WITH
    toStartOfWeek(now(), 1) AS week_end,
    week_end - INTERVAL 7 DAY AS week_start,
    week_start - INTERVAL 7 DAY AS previous_start,
    ['app.piloti.at', 'app.archos.tech'] AS production_hosts,
    ['org_01KWEZPQ1B54E0KN9K838PCS89', 'org_01M34HRAZTEQPTD33H6WM3KY5K', 'org_01KYVEVMY9X582SSN872SBTR03',
     'org_01M3P5VW8791FSCFCBMW9HMC9V', 'org_01M2TTD7J0N620NQ545ZDKSNGR'] AS internal_offices
SELECT
    if(issues.created_at >= week_start, 'neu', 'bekannt') AS `Seit`,
    coalesce(issues.name, seen.type) AS `Fehler`,
    substring(seen.message, 1, 90) AS `Meldung`,
    seen.source AS `Wo`,
    seen.occurrences AS `Ereignisse`,
    seen.occurrences_previous AS `Vorwoche`,
    issues.status AS `Status`
FROM (
    SELECT
        toString(properties.$exception_issue_id) AS issue_id,
        countIf(timestamp >= week_start) AS occurrences,
        countIf(timestamp < week_start) AS occurrences_previous,
        any(arrayElement(JSONExtract(toString(properties.$exception_types), 'Array(String)'), 1)) AS type,
        any(arrayElement(JSONExtract(toString(properties.$exception_values), 'Array(String)'), 1)) AS message,
        any(multiIf(properties.$lib = 'web', 'Browser',
                    properties.$lib = 'posthog-node', 'Server (UI)',
                    concat('Agent: ', toString(properties.service)))) AS source
    FROM events
    WHERE event = '$exception'
      AND timestamp >= previous_start AND timestamp < week_end
      AND (properties.$host IN production_hosts OR properties.app_host IN production_hosts OR properties.$lib = 'posthog-python')
    GROUP BY issue_id
    HAVING occurrences > 0
) AS seen
LEFT JOIN (
    SELECT toString(id) AS id, name, status, created_at FROM system.error_tracking_issues
) AS issues ON issues.id = seen.issue_id
ORDER BY seen.occurrences DESC
LIMIT 10
