-- Reverse 0239. ORDER: roll the frontend back first; this build's carry Job
-- writes `carried` and `carried_from`.
--
-- LOSSY: where each carried request came from (`carried_from`) goes. Its rows
-- stay: a verdict, an approval or a release move with `decision_source =
-- 'carried'` is kept, and the restored CHECKs are NOT VALID so they hold only
-- new rows. The released records are untouched.
DROP TRIGGER IF EXISTS knowledge_change_requests_carried_from_fixed ON "knowledge_change_requests";
--> statement-breakpoint
DROP FUNCTION IF EXISTS knowledge_carried_from_fixed();
--> statement-breakpoint
DROP TRIGGER IF EXISTS knowledge_review_decisions_carried ON "knowledge_review_decisions";
--> statement-breakpoint
DROP TRIGGER IF EXISTS knowledge_release_moves_carried ON "knowledge_release_moves";
--> statement-breakpoint
DROP TRIGGER IF EXISTS knowledge_approvals_carried ON "knowledge_approvals";
--> statement-breakpoint
DROP FUNCTION IF EXISTS knowledge_carried_only_on_a_carry();
--> statement-breakpoint
ALTER TABLE "knowledge_review_decisions" DROP CONSTRAINT IF EXISTS knowledge_review_decisions_source_known;
--> statement-breakpoint
ALTER TABLE "knowledge_review_decisions" ADD CONSTRAINT knowledge_review_decisions_source_known
  CHECK ("decision_source" IN ('app', 'elicitation', 'agent')) NOT VALID;
--> statement-breakpoint
ALTER TABLE "knowledge_release_moves" DROP CONSTRAINT IF EXISTS knowledge_release_moves_source_known;
--> statement-breakpoint
ALTER TABLE "knowledge_release_moves" ADD CONSTRAINT knowledge_release_moves_source_known
  CHECK ("decision_source" IN ('app', 'elicitation')) NOT VALID;
--> statement-breakpoint
ALTER TABLE "knowledge_approvals" DROP CONSTRAINT IF EXISTS knowledge_approvals_source_known;
--> statement-breakpoint
ALTER TABLE "knowledge_approvals" ADD CONSTRAINT knowledge_approvals_source_known
  CHECK ("decision_source" IN ('app', 'elicitation')) NOT VALID;
--> statement-breakpoint
DROP INDEX IF EXISTS "knowledge_change_requests_carried_idx";
--> statement-breakpoint
ALTER TABLE "knowledge_change_requests" DROP CONSTRAINT IF EXISTS knowledge_change_requests_carried_from_shape;
--> statement-breakpoint
ALTER TABLE "knowledge_change_requests" DROP COLUMN IF EXISTS "carried_from";
