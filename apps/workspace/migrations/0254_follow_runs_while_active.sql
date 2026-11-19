-- 0254: a follow runs while its conversation is active (ADR-0137, owner
-- decision of 2026-11-19).
--
-- Every mail filed into a Verlauf, by hand or by a follow, moves each running
-- follow of it to 60 days after that filing (`extendFollowsOnFiling` in
-- `bff/mail-thread/follows.ts`). A busy conversation therefore keeps its
-- follows past 180 days from their start, which 0196's
-- `mail_thread_follows_window` refused. The window keeps its other half: a
-- follow ends after it starts.
--
-- NOT VALID, as 0252's: it only widens, every row already holds under it, and
-- the deploy does not scan the table to prove it. No new table, so no
-- `secure_table` and no GRANT.
ALTER TABLE "mail_thread_follows" DROP CONSTRAINT IF EXISTS "mail_thread_follows_window";
--> statement-breakpoint
ALTER TABLE "mail_thread_follows" ADD CONSTRAINT "mail_thread_follows_window"
  CHECK ("expires_at" > "created_at") NOT VALID;
