-- Tile 4, "Antwortqualität": the last six complete weeks, newest first.
-- answer_completed is sent by the browser and misses answers nobody watched.
WITH
    toStartOfWeek(now(), 1) AS week_end,
    week_end - INTERVAL 7 DAY AS week_start,
    week_start - INTERVAL 7 DAY AS previous_start,
    ['app.piloti.at', 'app.archos.tech'] AS production_hosts,
    ['org_01KWEZPQ1B54E0KN9K838PCS89', 'org_01M34HRAZTEQPTD33H6WM3KY5K', 'org_01KYVEVMY9X582SSN872SBTR03',
     'org_01M3P5VW8791FSCFCBMW9HMC9V', 'org_01M2TTD7J0N620NQ545ZDKSNGR'] AS internal_offices
SELECT
    concat(formatDateTime(weekly.week, '%d.%m.'), ' – ', formatDateTime(weekly.week + INTERVAL 6 DAY, '%d.%m.')) AS `Woche`,
    weekly.answers AS `Antworten`,
    if(weekly.answers = 0, '–', concat(toString(round(weekly.answers_failed / weekly.answers * 100)), ' %')) AS `mit Fehler oder Abbruch`,
    weekly.thumbs_up AS `Daumen hoch`,
    weekly.thumbs_down AS `Daumen runter`,
    if(weekly.thumbs_up + weekly.thumbs_down = 0, '–',
       concat(toString(round(weekly.thumbs_down / (weekly.thumbs_up + weekly.thumbs_down) * 100)), ' %')) AS `Anteil runter`,
    if(empty(why.reasons), '–', why.reasons) AS `Gründe für Daumen runter`
FROM (
    SELECT
        toStartOfWeek(timestamp, 1) AS week,
        countIf(event = 'answer_completed') AS answers,
        countIf(event = 'answer_completed' AND properties.outcome != 'ok') AS answers_failed,
        countIf(event = 'answer_feedback_submitted' AND properties.verdict = 'up') AS thumbs_up,
        countIf(event = 'answer_feedback_submitted' AND properties.verdict = 'down') AS thumbs_down
    FROM events
    WHERE timestamp >= week_end - INTERVAL 42 DAY AND timestamp < week_end
      AND event IN ('answer_completed', 'answer_feedback_submitted')
      AND properties.$host IN production_hosts
      AND properties.organization_id NOT IN internal_offices
    GROUP BY week
) AS weekly
LEFT JOIN (
    SELECT week, arrayStringConcat(groupArray(concat(reason, ' (', toString(votes), ')')), ', ') AS reasons
    FROM (
        SELECT
            toStartOfWeek(timestamp, 1) AS week,
            multiIf(properties.reason = 'inaccurate', 'ungenau',
                    properties.reason = 'wrong_source', 'falsche Quelle',
                    properties.reason = 'other', 'anderes',
                    properties.reason IS NULL, 'ohne Grund',
                    toString(properties.reason)) AS reason,
            count() AS votes
        FROM events
        WHERE timestamp >= week_end - INTERVAL 42 DAY AND timestamp < week_end
          AND event = 'answer_feedback_submitted' AND properties.verdict = 'down'
          AND properties.$host IN production_hosts
          AND properties.organization_id NOT IN internal_offices
        GROUP BY week, reason
        ORDER BY votes DESC
    )
    GROUP BY week
) AS why ON why.week = weekly.week
ORDER BY weekly.week DESC
