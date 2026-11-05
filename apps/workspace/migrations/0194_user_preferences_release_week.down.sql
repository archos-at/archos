-- Reverse 0194. Everyone sees the newest weekly summary once more after a re-apply.

ALTER TABLE "user_preferences" DROP CONSTRAINT IF EXISTS "user_preferences_last_seen_release_week_iso";
ALTER TABLE "user_preferences" DROP COLUMN IF EXISTS "last_seen_release_week";
