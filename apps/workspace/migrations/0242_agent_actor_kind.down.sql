-- Puts the actor kind back to 'piloti' alone, undoing 0242.
--
-- Rows written as 'agent' (after the BACKFILL release) go back to 'piloti' first,
-- so the narrower CHECKs below hold. The constraints return under the names 0138
-- and 0140 gave them.

UPDATE document_annotations SET "author_kind" = 'piloti' WHERE "author_kind" = 'agent';
--> statement-breakpoint
UPDATE document_annotation_replies SET "author_kind" = 'piloti' WHERE "author_kind" = 'agent';
--> statement-breakpoint
UPDATE proposed_changes SET "proposed_by_kind" = 'piloti' WHERE "proposed_by_kind" = 'agent';
--> statement-breakpoint
ALTER TABLE document_annotations DROP CONSTRAINT IF EXISTS document_annotations_author_known;
--> statement-breakpoint
ALTER TABLE document_annotations ADD CONSTRAINT document_annotations_author_known
  CHECK ("author_kind" IN ('person', 'piloti'));
--> statement-breakpoint
ALTER TABLE document_annotations DROP CONSTRAINT IF EXISTS document_annotations_only_agent_proposes;
--> statement-breakpoint
ALTER TABLE document_annotations DROP CONSTRAINT IF EXISTS document_annotations_only_piloti_proposes;
--> statement-breakpoint
ALTER TABLE document_annotations ADD CONSTRAINT document_annotations_only_piloti_proposes
  CHECK ("status" <> 'proposed' OR "author_kind" = 'piloti');
--> statement-breakpoint
ALTER TABLE document_annotations DROP CONSTRAINT IF EXISTS document_annotations_agent_needs_a_person;
--> statement-breakpoint
ALTER TABLE document_annotations DROP CONSTRAINT IF EXISTS document_annotations_piloti_needs_a_person;
--> statement-breakpoint
ALTER TABLE document_annotations ADD CONSTRAINT document_annotations_piloti_needs_a_person
  CHECK ("author_kind" = 'person' OR "status" IN ('proposed', 'dismissed') OR "accepted_by" IS NOT NULL);
--> statement-breakpoint
ALTER TABLE document_annotation_replies DROP CONSTRAINT IF EXISTS document_annotation_replies_author_known;
--> statement-breakpoint
ALTER TABLE document_annotation_replies ADD CONSTRAINT document_annotation_replies_author_known
  CHECK ("author_kind" IN ('person', 'piloti'));
--> statement-breakpoint
ALTER TABLE proposed_changes DROP CONSTRAINT IF EXISTS proposed_changes_proposer_known;
--> statement-breakpoint
ALTER TABLE proposed_changes ADD CONSTRAINT proposed_changes_proposer_known
  CHECK ("proposed_by_kind" IN ('piloti', 'person'));
