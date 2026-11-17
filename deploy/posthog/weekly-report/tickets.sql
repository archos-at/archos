-- Tile 6, "Neue Feedback-Tickets": tickets opened last week on production, newest first,
-- with their state in PostHog Support today.
WITH
    toStartOfWeek(now(), 1) AS week_end,
    week_end - INTERVAL 7 DAY AS week_start,
    week_start - INTERVAL 7 DAY AS previous_start,
    ['app.piloti.at', 'app.archos.tech'] AS production_hosts,
    ['org_01KWEZPQ1B54E0KN9K838PCS89', 'org_01M34HRAZTEQPTD33H6WM3KY5K', 'org_01KYVEVMY9X582SSN872SBTR03',
     'org_01M3P5VW8791FSCFCBMW9HMC9V', 'org_01M2TTD7J0N620NQ545ZDKSNGR'] AS internal_offices
SELECT
    formatDateTime(opened.opened_at, '%d.%m. %H:%i') AS `Eröffnet`,
    multiIf(opened.kind = 'bug', 'Fehler', opened.kind = 'idea', 'Idee', opened.kind = 'question', 'Frage', opened.kind) AS `Art`,
    coalesce(names.name, opened.office) AS `Büro`,
    tickets.status AS `Status`,
    tickets.message_count AS `Nachrichten`,
    if(tickets.unread_team_count > 0, 'wartet auf uns', '–') AS `Offen bei uns`
FROM (
    SELECT
        toString(properties.ticket_id) AS ticket_id,
        min(timestamp) AS opened_at,
        any(properties.kind) AS kind,
        any(properties.organization_id) AS office
    FROM events
    WHERE event = 'product_feedback_ticket_opened'
      AND timestamp >= week_start AND timestamp < week_end
      AND properties.app_host IN production_hosts
    GROUP BY ticket_id
) AS opened
LEFT JOIN (
    SELECT toString(id) AS id, status, message_count, unread_team_count FROM system.support_tickets
) AS tickets ON tickets.id = opened.ticket_id
LEFT JOIN (SELECT id, name FROM workos_organizations) AS names ON names.id = opened.office
ORDER BY opened.opened_at DESC
