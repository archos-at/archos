-- Tile 1, "Woche auf einen Blick": one row per measure, last complete week
-- (Monday to Sunday, project time zone) against the week before.
--
-- Scope, the same in every query of this directory:
--   production = browser events with $host, server events with app_host
--                (a browser event carries no app_host and a server event no $host);
--   customers  = every office except the internal ones listed below
--                (the project's "internal and test" filter, Settings -> Project).
-- LLM cost is the platform's whole production bill, internal offices included, read from
-- the usage ledger's own event (llm_usage_hourly, docs/observability/org-spend-in-posthog.md).
-- Errors count as in errors.sql: the Python services' on both stacks, see there.
WITH
    toStartOfWeek(now(), 1) AS week_end,
    week_end - INTERVAL 7 DAY AS week_start,
    week_start - INTERVAL 7 DAY AS previous_start,
    ['app.piloti.at', 'app.archos.tech'] AS production_hosts,
    ['org_01KWEZPQ1B54E0KN9K838PCS89', 'org_01M34HRAZTEQPTD33H6WM3KY5K', 'org_01KYVEVMY9X582SSN872SBTR03',
     'org_01M3P5VW8791FSCFCBMW9HMC9V', 'org_01M2TTD7J0N620NQ545ZDKSNGR'] AS internal_offices
SELECT
    tupleElement(measure, 2) AS `Kennzahl`,
    multiIf(tupleElement(measure, 5) = 'usd', concat(toString(round(tupleElement(measure, 3), 2)), ' USD'),
            tupleElement(measure, 5) = 'share', concat(toString(round(tupleElement(measure, 3) * 100)), ' %'),
            toString(toInt(tupleElement(measure, 3)))) AS `Letzte Woche`,
    multiIf(tupleElement(measure, 5) = 'usd', concat(toString(round(tupleElement(measure, 4), 2)), ' USD'),
            tupleElement(measure, 5) = 'share', concat(toString(round(tupleElement(measure, 4) * 100)), ' %'),
            toString(toInt(tupleElement(measure, 4)))) AS `Vorwoche`,
    multiIf(tupleElement(measure, 5) = 'share',
                concat(if(tupleElement(measure, 3) >= tupleElement(measure, 4), '+', '−'),
                       toString(round(abs(tupleElement(measure, 3) - tupleElement(measure, 4)) * 100)), ' Punkte'),
            tupleElement(measure, 3) = tupleElement(measure, 4), '±0',
            tupleElement(measure, 4) = 0, 'neu',
            concat(if(tupleElement(measure, 3) >= tupleElement(measure, 4), '+', '−'),
                   toString(round(abs(tupleElement(measure, 3) - tupleElement(measure, 4)) / tupleElement(measure, 4) * 100)), ' %')
    ) AS `Veränderung`
FROM (
    SELECT arrayJoin([
        (1, 'Aktive Personen', toFloat(people), toFloat(people_previous), 'count'),
        (2, 'Aktive Büros', toFloat(offices), toFloat(offices_previous), 'count'),
        (3, 'Chat-Nachrichten', toFloat(chat), toFloat(chat_previous), 'count'),
        (4, 'Exportierte Berichte', toFloat(exports), toFloat(exports_previous), 'count'),
        (5, 'Verarbeitete Dokumente', toFloat(documents), toFloat(documents_previous), 'count'),
        (6, 'Dokumente mit Fehler', if(documents + documents_failed = 0, 0, documents_failed / (documents + documents_failed)),
            if(documents_previous + documents_failed_previous = 0, 0, documents_failed_previous / (documents_previous + documents_failed_previous)), 'share'),
        (7, 'Daumen hoch', toFloat(thumbs_up), toFloat(thumbs_up_previous), 'count'),
        (8, 'Daumen runter', toFloat(thumbs_down), toFloat(thumbs_down_previous), 'count'),
        (9, 'Anteil Daumen runter', if(thumbs_up + thumbs_down = 0, 0, thumbs_down / (thumbs_up + thumbs_down)),
            if(thumbs_up_previous + thumbs_down_previous = 0, 0, thumbs_down_previous / (thumbs_up_previous + thumbs_down_previous)), 'share'),
        (10, 'Antworten mit Fehler oder Abbruch', if(answers = 0, 0, answers_failed / answers),
            if(answers_previous = 0, 0, answers_failed_previous / answers_previous), 'share'),
        (11, 'Neue Feedback-Tickets', toFloat(tickets), toFloat(tickets_previous), 'count'),
        (12, 'LLM-Kosten', cost, cost_previous, 'usd'),
        (13, 'Fehler (Ereignisse)', toFloat(errors), toFloat(errors_previous), 'count')
    ]) AS measure
    FROM (
        SELECT
            uniqIf(person_id, current AND browser) AS people,
            uniqIf(person_id, NOT current AND browser) AS people_previous,
            uniqIf(office, current AND browser) AS offices,
            uniqIf(office, NOT current AND browser) AS offices_previous,
            countIf(current AND event = 'chat_message_sent') AS chat,
            countIf(NOT current AND event = 'chat_message_sent') AS chat_previous,
            countIf(current AND event = 'report_exported') AS exports,
            countIf(NOT current AND event = 'report_exported') AS exports_previous,
            countIf(current AND event = 'document_ingest_finished' AND status = 'completed') AS documents,
            countIf(NOT current AND event = 'document_ingest_finished' AND status = 'completed') AS documents_previous,
            countIf(current AND event = 'document_ingest_finished' AND status = 'failed') AS documents_failed,
            countIf(NOT current AND event = 'document_ingest_finished' AND status = 'failed') AS documents_failed_previous,
            countIf(current AND event = 'answer_feedback_submitted' AND verdict = 'up') AS thumbs_up,
            countIf(NOT current AND event = 'answer_feedback_submitted' AND verdict = 'up') AS thumbs_up_previous,
            countIf(current AND event = 'answer_feedback_submitted' AND verdict = 'down') AS thumbs_down,
            countIf(NOT current AND event = 'answer_feedback_submitted' AND verdict = 'down') AS thumbs_down_previous,
            countIf(current AND event = 'answer_completed') AS answers,
            countIf(NOT current AND event = 'answer_completed') AS answers_previous,
            countIf(current AND event = 'answer_completed' AND outcome != 'ok') AS answers_failed,
            countIf(NOT current AND event = 'answer_completed' AND outcome != 'ok') AS answers_failed_previous,
            countIf(current AND event = 'product_feedback_ticket_opened') AS tickets,
            countIf(NOT current AND event = 'product_feedback_ticket_opened') AS tickets_previous,
            countIf(current AND event = '$exception') AS errors,
            countIf(NOT current AND event = '$exception') AS errors_previous
        FROM (
            SELECT
                event,
                person_id,
                timestamp >= week_start AS current,
                properties.$host IN production_hosts AND event != '$exception' AND properties.organization_id IS NOT NULL AS browser,
                properties.organization_id AS office,
                properties.status AS status,
                properties.verdict AS verdict,
                properties.outcome AS outcome
            FROM events
            WHERE timestamp >= previous_start AND timestamp < week_end
              AND (properties.$host IN production_hosts OR properties.app_host IN production_hosts
                   OR (event = '$exception' AND properties.$lib = 'posthog-python'))
              AND (event = '$exception' OR properties.organization_id IS NULL OR properties.organization_id NOT IN internal_offices)
        )
    ) AS usage
    CROSS JOIN (
        SELECT
            sumIf(toFloat(properties.cost_usd), timestamp >= week_start) AS cost,
            sumIf(toFloat(properties.cost_usd), timestamp < week_start) AS cost_previous
        FROM events
        WHERE event = 'llm_usage_hourly'
          AND timestamp >= previous_start AND timestamp < week_end
          AND properties.app_host IN production_hosts
    ) AS spend
)
ORDER BY tupleElement(measure, 1)
