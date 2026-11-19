-- Reverse 0253. Lossless: an index only. The sender memory's read still
-- answers without it, by walking the project's entries.
DROP INDEX IF EXISTS "mail_thread_entries_sender_idx";
