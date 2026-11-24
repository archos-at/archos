-- 0253: find a sender's earlier mails in a project by their address (ADR-0137,
-- sender memory).
--
-- The single-mail view of the E-Mail-Eingang offers the folders where this
-- project's attachments from the same sender address went (`findSenderFolders`
-- in `bff/inbound-mail/sender-memory-repository.ts`). The held mail's own row
-- forgets its sender when it settles, so the address that lasts is the
-- Verlauf entry's. `mail_thread_entries` had no index on it: the read would
-- walk every entry of the project, and an archive import makes those tens of
-- thousands.
--
-- `(project_id, lower(sender_address), received_at DESC)` over inbound entries
-- is exactly what the read asks for: one sender's newest entries in one
-- project, at most 200, in index order, nothing sorted. Archive entries are
-- left out: the import files each mail into a folder of its own, which is no
-- answer to "where do this sender's attachments go".
--
-- Not CONCURRENTLY: the runner wraps each migration in a transaction (see
-- 0039). An entry is written once per filed mail, so the build's hold on
-- writes is a moment.
--
-- No RLS line: an index adds no table to the boundary.
CREATE INDEX IF NOT EXISTS "mail_thread_entries_sender_idx"
  ON "mail_thread_entries" ("project_id", lower("sender_address"), "received_at" DESC)
  WHERE "source" = 'inbound';
