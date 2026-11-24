-- Reverse 0254. ORDER: roll the frontend back first; the newer build extends a
-- follow on every filing, past 180 days from its start.
--
-- Lossy: a running follow already past 180 days keeps its end, and the CHECK
-- comes back NOT VALID for that reason: only new writes are held to "at most
-- 180 days from the start" again. The older build renews within that bound.
ALTER TABLE "mail_thread_follows" DROP CONSTRAINT IF EXISTS "mail_thread_follows_window";
--> statement-breakpoint
ALTER TABLE "mail_thread_follows" ADD CONSTRAINT "mail_thread_follows_window"
  CHECK ("expires_at" > "created_at" AND "expires_at" <= "created_at" + interval '180 days') NOT VALID;
