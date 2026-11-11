-- 0224: a quarantined document may be sent through the content gate again
-- (ADR-0086, „Erneut prüfen").
--
-- ## Why
--
-- Migration 0122 lets a `quarantined` row leave only through a reviewer's
-- release. The re-screen (`markForRescreening`) returns a held row to
-- `uploaded` and releases nothing, so the trigger refused it with `GQH01` and
-- the action failed for exactly the files it exists for.
--
-- ## What
--
-- `documents_hold_quarantine()` (the name since 0190) accepts a second way out:
-- to `uploaded`, when the write lifts nothing. That means the row still says
-- `screening_outcome = 'quarantined'` afterwards, and `content_hash`,
-- `screened_hash` and `screening_released_hash` are what they were.
--
-- The hold is not the status. A reader sees a person's upload only when its
-- verdict is a passing one about the bytes the row holds (`passedScreening` in
-- `bff/documents/visibility.ts`), and `quarantined` is not a passing verdict
-- at any status. So the row stays hidden from everyone but its uploader and
-- its reviewers while it is read again, until a job writes a new verdict: a
-- pass shows it, a match quarantines it again.
--
-- The outcome is required, not merely left unchanged, on purpose. No CHECK
-- ties the status to the outcome, so a quarantined row could in principle
-- carry an earlier `clean` or `released` beside matching hashes. Leaving that
-- row's columns alone and moving it to `uploaded` would show the file. The
-- writer sets the outcome to `quarantined` for such a row, which only holds
-- more.
--
-- ## Existing rows
--
-- None is read or rewritten. The function is replaced in place and the trigger
-- keeps pointing at it; a row in any status behaves as before except that a
-- quarantined one now accepts the write described above. Every other write
-- that takes a row out of quarantine is refused as before.
CREATE OR REPLACE FUNCTION documents_hold_quarantine() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'uploaded'
     AND NEW.screening_outcome = 'released'
     AND NEW.screening_released_hash IS NOT NULL
     AND NEW.screening_released_hash = NEW.content_hash THEN
    RETURN NEW;
  END IF;
  -- A re-screen: back to `uploaded` with the holding verdict still on the row
  -- and the bytes and their digests untouched.
  IF NEW.status = 'uploaded'
     AND NEW.screening_outcome IS NOT DISTINCT FROM 'quarantined'
     AND NEW.content_hash IS NOT DISTINCT FROM OLD.content_hash
     AND NEW.screened_hash IS NOT DISTINCT FROM OLD.screened_hash
     AND NEW.screening_released_hash IS NOT DISTINCT FROM OLD.screening_released_hash THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'document % is quarantined: only a release or a re-screen that lifts nothing takes it out of quarantine (ADR-0086)', OLD.id
    USING ERRCODE = 'GQH01';
END
$$;
