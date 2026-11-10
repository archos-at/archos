-- Tile 3, "Chat-Nachrichten pro Tag": the last four complete weeks, stacked by customer office.
-- Chart: stacked bars, x = day, y = messages, series = office.
WITH
    toStartOfWeek(now(), 1) AS week_end,
    week_end - INTERVAL 7 DAY AS week_start,
    week_start - INTERVAL 7 DAY AS previous_start,
    ['app.piloti.at', 'app.archos.tech'] AS production_hosts,
    ['org_01KWEZPQ1B54E0KN9K838PCS89', 'org_01M34HRAZTEQPTD33H6WM3KY5K', 'org_01KYVEVMY9X582SSN872SBTR03',
     'org_01M3P5VW8791FSCFCBMW9HMC9V', 'org_01M2TTD7J0N620NQ545ZDKSNGR'] AS internal_offices
SELECT
    activity.day AS day,
    coalesce(names.name, activity.office, 'ohne Büro') AS office,
    activity.messages AS messages
FROM (
    SELECT toDate(timestamp) AS day, properties.organization_id AS office, count() AS messages
    FROM events
    WHERE event = 'chat_message_sent'
      AND timestamp >= week_end - INTERVAL 28 DAY AND timestamp < week_end
      AND properties.$host IN production_hosts
      AND properties.organization_id NOT IN internal_offices
    GROUP BY day, office
) AS activity
LEFT JOIN (SELECT id, name FROM workos_organizations) AS names ON names.id = activity.office
ORDER BY day
