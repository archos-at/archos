-- Personal notes are told apart by a stored key, not by an index expression
-- (ADR-0180).
--
-- 0229 made a note unique per person by
-- `btrim(regexp_replace(lower(content), '[^a-z0-9]+', ' ', 'g'))`, the twin of
-- `normalizeContent` in TypeScript. That fold keeps ASCII letters only: a note
-- with none („Привет“, „ÄÖÜ“) folded to '' and was the same note as every
-- other such note, so the second write answered 201 with the first one's id
-- and kept nothing. The key is now computed in ONE place,
-- `personalContentKey` (`bff/personal-memory/content-key.ts`: NFKC, lower
-- case, every run that is no letter and no digit in any script to one space,
-- trimmed), stored with the note, and the unique index is on that column.
--
-- The table is unreleased (0229 and 0231 shipped in the same unreleased
-- build), so the backfill below only has to be close: Postgres has no
-- `\p{L}`, and `[[:alnum:]]` follows the database's ctype (Unicode under a
-- UTF-8 locale, ASCII under C). A row whose key comes out empty is keyed by
-- its trimmed lower-case text instead, and a row whose key another row of the
-- same person already holds gets its id appended: no note is lost, and the
-- service never computes such a key, so a later identical note simply becomes
-- a second row rather than a refusal.
-- Added NOT NULL with an empty default so the statement is one an older build
-- survives; the two UPDATEs below give every row its key in the same
-- transaction, and the default is dropped at the end so a write must name one.
ALTER TABLE "personal_memory" ADD COLUMN IF NOT EXISTS "content_key" text NOT NULL DEFAULT '';
--> statement-breakpoint
UPDATE "personal_memory"
SET "content_key" = coalesce(
  nullif(btrim(regexp_replace(lower(normalize("content", NFKC)), '[^[:alnum:]]+', ' ', 'g')), ''),
  lower(btrim("content"))
)
WHERE "content_key" = '';
--> statement-breakpoint
UPDATE "personal_memory" AS later
SET "content_key" = later."content_key" || ' ' || later."id"::text
WHERE EXISTS (
  SELECT 1 FROM "personal_memory" AS earlier
  WHERE earlier."organization_id" = later."organization_id"
    AND earlier."user_id" = later."user_id"
    AND earlier."content_key" = later."content_key"
    AND (earlier."created_at", earlier."id") < (later."created_at", later."id")
);
--> statement-breakpoint
--> statement-breakpoint
-- The service refuses a note with no letter and no digit (400); this holds it
-- for every other writer.
DO $$ BEGIN
  ALTER TABLE "personal_memory"
    ADD CONSTRAINT personal_memory_content_key_present CHECK (btrim("content_key") <> '');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_personal_memory_owner_content_key"
  ON "personal_memory" ("organization_id", "user_id", "content_key");
--> statement-breakpoint
DROP INDEX IF EXISTS "uniq_personal_memory_owner_content";
--> statement-breakpoint
ALTER TABLE "personal_memory" ALTER COLUMN "content_key" DROP DEFAULT;
