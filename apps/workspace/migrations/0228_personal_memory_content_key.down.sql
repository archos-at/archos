-- Reverse 0228. ORDER: roll the frontend back first; the newer build writes
-- `personal_memory.content_key` and finds a duplicate by it.
--
-- LOSSY: the 0225 index folds every note with no ASCII letter or digit to the
-- same text, so of the notes that collide under it only the most recently
-- updated one per person is kept; the others are deleted before the index can
-- be built again.
DELETE FROM "personal_memory" AS older
WHERE EXISTS (
  SELECT 1 FROM "personal_memory" AS newer
  WHERE newer."organization_id" = older."organization_id"
    AND newer."user_id" = older."user_id"
    AND btrim(regexp_replace(lower(newer."content"), '[^a-z0-9]+', ' ', 'g'))
      = btrim(regexp_replace(lower(older."content"), '[^a-z0-9]+', ' ', 'g'))
    AND (newer."updated_at", newer."id") > (older."updated_at", older."id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_personal_memory_owner_content"
  ON "personal_memory" (
    "organization_id",
    "user_id",
    (btrim(regexp_replace(lower("content"), '[^a-z0-9]+', ' ', 'g')))
  );
--> statement-breakpoint
DROP INDEX IF EXISTS "uniq_personal_memory_owner_content_key";
--> statement-breakpoint
ALTER TABLE "personal_memory" DROP COLUMN IF EXISTS "content_key";
