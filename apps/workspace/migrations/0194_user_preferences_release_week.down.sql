-- Reverse 0194. After a re-apply everyone sees the newest weekly summary once more, and an
-- opt-out is forgotten.

ALTER TABLE "user_preferences" DROP CONSTRAINT IF EXISTS "user_preferences_last_seen_release_week_iso";
ALTER TABLE "user_preferences" DROP COLUMN IF EXISTS "release_summary_notice";
ALTER TABLE "user_preferences" DROP COLUMN IF EXISTS "last_seen_release_week";
