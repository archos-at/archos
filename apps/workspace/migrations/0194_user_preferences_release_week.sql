-- 0194: the last weekly summary of the release notes a person has seen (ADR-0154, amendment).
--
-- The app shows a person the newest weekly summary once, in a small notice, and never again
-- for that week. "Seen" is per person and across devices, so it lives beside their other
-- preferences, keyed by WorkOS user id and already behind the `workos_user_id =
-- current_user_id()` row-level-security policy (0031). A column rather than a key in the
-- `prefs` bag, because the bag is opaque JSON any client may merge into, and this value has a
-- shape the database can hold: an ISO week id, which also sorts as text, so "later" is `>`.
--
-- Nullable, no default, no backfill: NULL is "never recorded", true of everyone today, and the
-- first notice settles it. Expand only: an older build reads the table without the column.

ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "last_seen_release_week" text;

DO $$
BEGIN
  ALTER TABLE "user_preferences"
    ADD CONSTRAINT "user_preferences_last_seen_release_week_iso"
    CHECK ("last_seen_release_week" IS NULL
      OR "last_seen_release_week" ~ '^[0-9]{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
