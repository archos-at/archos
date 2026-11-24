-- 0266: a message carries the order in which the server received it
-- (ADR-0194, joining later).
--
-- `created_at` takes the client's clock when the client sends one, so it can
-- run behind. A reader who joined later is cut by turn: what the server
-- received after the last answer they may read is withheld. That order must be
-- the server's, so a follow-up from a slow clock cannot sort before the cut,
-- and strict, so the rows of one batched insert keep their order. A sequence
-- gives both; `now()` would tie within a transaction. No insert sets it; the
-- default does. Existing rows are numbered in `created_at` order, which is all
-- that is known of them.
CREATE SEQUENCE IF NOT EXISTS "messages_received_seq";
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "received_seq" bigint;
--> statement-breakpoint
ALTER SEQUENCE "messages_received_seq" OWNED BY "messages"."received_seq";
--> statement-breakpoint
UPDATE "messages" AS m SET "received_seq" = o.n
FROM (SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS n FROM "messages") AS o
WHERE m."id" = o."id" AND m."received_seq" IS NULL;
--> statement-breakpoint
SELECT setval('messages_received_seq', COALESCE((SELECT max("received_seq") FROM "messages"), 0) + 1, false);
--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "received_seq" SET DEFAULT nextval('messages_received_seq');
--> statement-breakpoint
UPDATE "messages" SET "received_seq" = nextval('messages_received_seq') WHERE "received_seq" IS NULL;
--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "received_seq" SET NOT NULL;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "messages_received_seq" TO grid_app_rw, grid_app_platform;
