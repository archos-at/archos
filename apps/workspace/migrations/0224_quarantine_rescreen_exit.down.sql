-- Reverse 0224: a quarantined row leaves only through a release again, as 0122
-- wrote it. No row changes. A row a re-screen already sent on stays where it
-- is, held by its verdict until its reading ends.
CREATE OR REPLACE FUNCTION documents_hold_quarantine() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'uploaded'
     AND NEW.screening_outcome = 'released'
     AND NEW.screening_released_hash IS NOT NULL
     AND NEW.screening_released_hash = NEW.content_hash THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'document % is quarantined: only a release takes it out of quarantine (ADR-0086)', OLD.id
    USING ERRCODE = 'GQH01';
END
$$;
