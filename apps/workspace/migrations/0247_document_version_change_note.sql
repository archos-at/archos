-- 0247: a Fassung the agent made from a person's request carries its Änderungsvermerk, the short note of
-- what changed against the Fassung before it. Written when the Fassung is filed, shown with it.

ALTER TABLE "document_versions" ADD COLUMN IF NOT EXISTS "change_note" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'document_versions_change_note_length'
  ) THEN
    ALTER TABLE "document_versions"
      ADD CONSTRAINT "document_versions_change_note_length" CHECK (char_length("change_note") <= 500);
  END IF;
END $$;
