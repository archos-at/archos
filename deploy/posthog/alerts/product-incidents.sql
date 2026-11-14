SELECT
    if(countIf(b > 0) = 0, 'Keine Regel verletzt', arrayStringConcat(groupArrayIf(r, b > 0), ' | ')) AS rule,
    toFloat(countIf(b > 0)) AS breach
FROM (SELECT rule AS r, breach AS b FROM (
SELECT
    concat('[Credits] Provider lehnt Aufrufe wegen fehlender Credits ab (HTTP 402), ', toString(count()), 'x in 1 h: ', arrayStringConcat(groupUniqArray(toString(properties.service)), ', ')) AS rule,
    toFloat(count()) AS breach
FROM events
WHERE event = '$exception' AND timestamp > now() - INTERVAL 1 HOUR AND timestamp <= now()
    AND coalesce(toString(properties.app_host), '') != 'app.dev.piloti.at'
    AND (toString(properties.$exception_values) ILIKE '%402%' OR toString(properties.$exception_values) ILIKE '%insufficient credits%' OR toString(properties.$exception_values) ILIKE '%available credits%')
UNION ALL
SELECT
    concat('[Mandant] MissingTenantContextError ', toString(count()), 'x in 1 h') AS rule,
    toFloat(count()) AS breach
FROM events
WHERE event = '$exception' AND timestamp > now() - INTERVAL 1 HOUR AND timestamp <= now()
    AND toString(properties.$exception_types) ILIKE '%MissingTenantContextError%'
UNION ALL
SELECT
    concat('[Ingest] ', toString(countIf(toString(properties.status) = 'failed')), ' von ', toString(count()), ' Ingest-Läufen in 1 h fehlgeschlagen') AS rule,
    toFloat(if(countIf(toString(properties.status) = 'failed') > 20 OR (count() >= 20 AND countIf(toString(properties.status) = 'failed') > 0.1 * count()), countIf(toString(properties.status) = 'failed'), 0)) AS breach
FROM events
WHERE event = 'document_ingest_finished' AND timestamp > now() - INTERVAL 1 HOUR AND timestamp <= now()
    AND coalesce(toString(properties.app_host), '') != 'app.dev.piloti.at'
UNION ALL
SELECT
    concat('[Ingest] Läufe, die länger als 60 min dauerten (in 1 h beendet): ', toString(count())) AS rule,
    toFloat(count()) AS breach
FROM events
WHERE event = 'document_ingest_finished' AND timestamp > now() - INTERVAL 1 HOUR AND timestamp <= now()
    AND coalesce(toString(properties.app_host), '') != 'app.dev.piloti.at'
    AND toFloat(properties.duration_ms) > 3600000
UNION ALL
SELECT
    concat('[Budget] Büro gesperrt (budget_blocked in 1 h): ', arrayStringConcat(groupUniqArray(coalesce(toString(properties.organization_name), toString(properties.organization_id))), ', ')) AS rule,
    toFloat(count()) AS breach
FROM events
WHERE event = 'budget_blocked' AND timestamp > now() - INTERVAL 1 HOUR AND timestamp <= now()
    AND coalesce(toString(properties.app_host), '') != 'app.dev.piloti.at'
UNION ALL
SELECT
    concat('[Budget] Büro über 80 Prozent des Tagesbudgets: ', arrayStringConcat(groupArrayIf(concat(name, ' (', toString(round(pct)), ' Prozent)'), pct >= 80), ', ')) AS rule,
    toFloat(countIf(pct >= 80)) AS breach
FROM (
    SELECT toString(properties.organization_id) AS org,
        argMax(toString(properties.organization_name), timestamp) AS name,
        argMax(if(toFloat(properties.daily_limit) > 0, toFloat(properties.day_amount) / toFloat(properties.daily_limit) * 100, 0), timestamp) AS pct
    FROM events
    WHERE event = 'organization_budget_snapshot' AND properties.app_host = 'app.piloti.at'
        AND timestamp > now() - INTERVAL 3 HOUR AND timestamp <= now()
    GROUP BY org
)
UNION ALL
SELECT
    concat('[Antworten] ', toString(sent - answered), ' von ', toString(sent), ' Chatfragen (vor 30 bis 90 min gestellt) ohne Antwort') AS rule,
    toFloat(if(sent - answered > 2, sent - answered, 0)) AS breach
FROM (
    SELECT
        countIf(event = 'chat_message_sent' AND timestamp <= now() - INTERVAL 30 MINUTE) AS sent,
        countIf(event = 'answer_completed') AS answered
    FROM events
    WHERE event IN ('chat_message_sent', 'answer_completed')
        AND timestamp > now() - INTERVAL 90 MINUTE AND timestamp <= now()
        AND properties.$host = 'app.piloti.at'
)
UNION ALL
SELECT
    concat('[Projekt-E-Mail] ', host, ': ', toString(n), ' Zustellungen in 1 h von uns abgewiesen (', reason, ', Schritt ', stage, ', ', err, ')') AS rule,
    toFloat(n) AS breach
FROM (
    SELECT
        coalesce(toString(properties.app_host), '?') AS host,
        coalesce(toString(properties.reason), '?') AS reason,
        coalesce(toString(properties.stage), '?') AS stage,
        coalesce(toString(properties.error), '-') AS err,
        count() AS n
    FROM events
    WHERE event = 'inbound_mail_refused' AND timestamp > now() - INTERVAL 1 HOUR AND timestamp <= now()
        AND toString(properties.reason) NOT IN ('unknown_address', 'switched_off', 'too_large')
    GROUP BY host, reason, stage, err
    HAVING n >= 3
)
UNION ALL
SELECT
    concat('[Projekt-E-Mail] ', refused.host, ': seit 6 h nur abgewiesen, keine Zustellung angenommen') AS rule,
    toFloat(1) AS breach
FROM (
    SELECT coalesce(toString(properties.app_host), '?') AS host
    FROM events
    WHERE event = 'inbound_mail_refused' AND timestamp > now() - INTERVAL 6 HOUR AND timestamp <= now()
        AND toString(properties.reason) NOT IN ('unknown_address', 'switched_off', 'too_large')
    GROUP BY host
) AS refused
LEFT ANTI JOIN (
    SELECT coalesce(toString(properties.app_host), '?') AS host
    FROM events
    WHERE event IN ('inbound_mail_received', 'inbound_mail_dropped') AND timestamp > now() - INTERVAL 6 HOUR AND timestamp <= now()
    GROUP BY host
) AS took ON refused.host = took.host
))
