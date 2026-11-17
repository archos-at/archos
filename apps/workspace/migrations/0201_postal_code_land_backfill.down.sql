-- Reverse 0201: drop the Land it suggested, and only that one (its reason is
-- its own; a suggestion the intake writes at creation reads differently).
-- The stored prompt view keeps its line until the next profile save rebuilds it.
UPDATE projects
SET
  profile = profile #- '{assumptions,federal_state}',
  profile_version = profile_version + 1,
  profile_updated_at = now()
WHERE profile -> 'assumptions' -> 'federal_state' ->> 'reason' = 'Aus der Postleitzahl der gespeicherten Adresse abgeleitet';
