-- Tile 5, "LLM-Kosten pro Tag": the last four complete weeks in USD, stacked by office.
-- Every production office, internal ones included: this is the platform's bill,
-- from the usage ledger's llm_usage_hourly event.
-- Chart: stacked bars, x = day, y = cost_usd, series = office.
WITH
    toStartOfWeek(now(), 1) AS week_end,
    week_end - INTERVAL 7 DAY AS week_start,
    week_start - INTERVAL 7 DAY AS previous_start,
    ['app.piloti.at', 'app.archos.tech'] AS production_hosts,
    ['org_01KWEZPQ1B54E0KN9K838PCS89', 'org_01M34HRAZTEQPTD33H6WM3KY5K', 'org_01KYVEVMY9X582SSN872SBTR03',
     'org_01M3P5VW8791FSCFCBMW9HMC9V', 'org_01M2TTD7J0N620NQ545ZDKSNGR'] AS internal_offices
SELECT
    spend.day AS day,
    coalesce(names.name, spend.office, 'ohne Büro') AS office,
    round(spend.cost, 2) AS cost_usd
FROM (
    SELECT toDate(timestamp) AS day, properties.organization_id AS office, sum(toFloat(properties.cost_usd)) AS cost
    FROM events
    WHERE event = 'llm_usage_hourly'
      AND timestamp >= week_end - INTERVAL 28 DAY AND timestamp < week_end
      AND properties.app_host IN production_hosts
    GROUP BY day, office
) AS spend
LEFT JOIN (SELECT id, name FROM workos_organizations) AS names ON names.id = spend.office
ORDER BY day
