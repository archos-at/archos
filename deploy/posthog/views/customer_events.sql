-- prod_events without our own offices: the base of every customer number.
-- The project's test-account filter holds the same organisation ids.
SELECT *
FROM prod_events AS p
WHERE p.organization_id IS NULL
    OR p.organization_id NOT IN (
        'org_01KWEZPQ1B54E0KN9K838PCS89',
        'org_01M34HRAZTEQPTD33H6WM3KY5K',
        'org_01KYVEVMY9X582SSN872SBTR03',
        'org_01M3P5VW8791FSCFCBMW9HMC9V',
        'org_01M2TTD7J0N620NQ545ZDKSNGR'
    )
