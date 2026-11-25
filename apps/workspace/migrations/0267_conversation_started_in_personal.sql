-- 0267: a chat records that it was started in Persönlich (ADR-0193 amendment, 2026-11-24).
--
-- Persönlich lists only chats started there, so it is empty for everyone on
-- launch. Every existing row is false: a chat without a project from the old
-- start page or the agent API was not started in Persönlich, stays in the
-- database and is listed nowhere. Set once, at creation, never changed.
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "started_in_personal" boolean DEFAULT false NOT NULL;
