-- 0266: a message carries the order in which the server received it
-- (ADR-0194, joining later).
--
-- `created_at` takes the client's clock when the client sends one, so it can
-- run behind. A reader who joined later is cut by turn: what the server
-- received after the last answer they may read is withheld. That order must be
-- the server's, so a follow-up from a slow clock cannot sort before the cut,
-- and strict, so the rows of one batched insert keep their order. A sequence
-- gives both; `now()` would tie within a transaction. No insert sets it; the
-- default does. Adding it with the default fills the existing rows in physical
-- order, so they are numbered again in `created_at` order, which is all that is
-- known of them, and the sequence moves past them.
CREATE SEQUENCE IF NOT EXISTS "messages_received_seq";
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "received_seq" bigint NOT NULL DEFAULT nextval('messages_received_seq');
--> statement-breakpoint
ALTER SEQUENCE "messages_received_seq" OWNED BY "messages"."received_seq";
--> statement-breakpoint
UPDATE "messages" AS m SET "received_seq" = o.n
FROM (SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS n FROM "messages") AS o
WHERE m."id" = o."id";
--> statement-breakpoint
SELECT setval('messages_received_seq', COALESCE((SELECT max("received_seq") FROM "messages"), 0) + 1, false);
--> statement-breakpoint
DO $$ BEGIN
  EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE messages_received_seq TO %I, %I', rls_role('rw'), rls_role('platform'));
END $$;
