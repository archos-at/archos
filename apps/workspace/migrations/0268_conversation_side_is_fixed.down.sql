-- Undo 0268. Nothing reads these; the application never changed a chat's side.
DROP TRIGGER IF EXISTS message_stays_in_its_conversation ON "messages";
DROP FUNCTION IF EXISTS message_stays_in_its_conversation();
ALTER TABLE "conversations" DROP CONSTRAINT IF EXISTS "conversations_personal_has_no_project";
DROP TRIGGER IF EXISTS conversation_side_is_fixed ON "conversations";
DROP FUNCTION IF EXISTS conversation_side_is_fixed();
