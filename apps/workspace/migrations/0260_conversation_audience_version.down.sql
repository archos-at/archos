-- Undo 0260. ORDER: roll the frontend back first; the newer build reads the column.
DROP TRIGGER IF EXISTS resource_shares_conversation_audience ON "resource_shares";
--> statement-breakpoint
DROP FUNCTION IF EXISTS resource_shares_conversation_audience();
--> statement-breakpoint
DROP FUNCTION IF EXISTS conversation_audience_bump_for_share(text, text, boolean);
--> statement-breakpoint
DROP TRIGGER IF EXISTS conversations_audience_version ON "conversations";
--> statement-breakpoint
DROP FUNCTION IF EXISTS conversation_audience_version_bump();
--> statement-breakpoint
DROP FUNCTION IF EXISTS conversation_exists(text);
--> statement-breakpoint
ALTER TABLE "conversations" DROP COLUMN IF EXISTS "audience_version";
