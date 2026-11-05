-- 0194: the last weekly summary of the release notes a person has seen, and whether they want
-- to be shown the next one (ADR-0156, amendment).
--
-- The app shows a person the newest weekly summary once, in a small notice, and never again
-- for that week. "Seen" is per person and across devices, so it lives beside their other
-- preferences, keyed by WorkOS user id and already behind the `workos_user_id =
-- current_user_id()` row-level-security policy (0031). A column rather than a key in the
-- `prefs` bag, because the bag is opaque JSON any client may merge into, and this value has a
-- shape the database can hold: an ISO week id, which also sorts as text, so "later" is `>`.
--
-- Nullable, no default, no backfill: NULL is "never recorded", true of everyone today, and the
-- first notice settles it.
--
-- `release_summary_notice` is the person's own switch for that notice: "Nicht mehr anzeigen" on
-- the notice turns it off, the profile page turns it back on. On by default, so a row that
-- exists today, or one a preference write creates, keeps the notice. Expand only: an older build
-- reads the table without either column.

ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "last_seen_release_week" text;
ALTER TABLE "user_preferences" ADD COLUMN IF NOT EXISTS "release_summary_notice" boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  ALTER TABLE "user_preferences"
    ADD CONSTRAINT "user_preferences_last_seen_release_week_iso"
    CHECK ("last_seen_release_week" IS NULL
      OR "last_seen_release_week" ~ '^[0-9]{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
