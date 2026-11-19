-- Undo 0250. Lossy: every Verweis and every „Hier lassen“ is forgotten, and an
-- open suggestion of a project norm for the Büroablage is deleted with its
-- kind. The norms that went to the Büroablage stay there.
DELETE FROM "proposed_changes" WHERE "kind" = 'office_shelf_norm';
--> statement-breakpoint
ALTER TABLE "proposed_changes" DROP CONSTRAINT IF EXISTS proposed_changes_kind_known;
--> statement-breakpoint
ALTER TABLE "proposed_changes" ADD CONSTRAINT proposed_changes_kind_known
  CHECK ("kind" IN ('file_operation', 'memory', 'project_profile', 'operation'));
--> statement-breakpoint
DROP TABLE IF EXISTS "office_shelf_norm_keeps";
--> statement-breakpoint
DROP TABLE IF EXISTS "office_shelf_references";
