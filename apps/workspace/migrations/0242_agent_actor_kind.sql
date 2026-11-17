-- 0242: the actor kind `piloti` gains its new name `agent` (ADR-0149 map, ADR-0182 phase 4).
--
--   document_annotations.author_kind         piloti -> agent   (0138)
--   document_annotation_replies.author_kind  piloti -> agent   (0138)
--   proposed_changes.proposed_by_kind        piloti -> agent   (0140)
--
-- This is the EXPAND step only. Every CHECK that allows 'piloti' is widened to
-- allow 'agent' beside it, and no row is rewritten. The writers keep writing
-- 'piloti' until the BACKFILL and SWITCH release, because the migrate Job runs
-- before the new pods roll out and the BFF, the agent host and the purger deploy
-- separately: for minutes an old pod reads what a new pod wrote. A row that
-- holds 'agent' before every reader accepts it is a row an old pod cannot read.
--
-- ## The two constraints that name the value move to brand-free names
--
--   document_annotations_only_piloti_proposes   -> document_annotations_only_agent_proposes
--   document_annotations_piloti_needs_a_person  -> document_annotations_agent_needs_a_person
--
-- The second does not name the value in its expression; it moves with the first
-- so that no constraint on the table keeps the old name after this release.
--
-- ## Idempotent
--
-- Each constraint is dropped under its old and its new name, then added under the
-- new name. A second run drops and adds the same definitions and changes nothing.

ALTER TABLE document_annotations DROP CONSTRAINT IF EXISTS document_annotations_author_known;
--> statement-breakpoint
ALTER TABLE document_annotations ADD CONSTRAINT document_annotations_author_known
  CHECK ("author_kind" IN ('person', 'agent', 'piloti'));
--> statement-breakpoint
ALTER TABLE document_annotations DROP CONSTRAINT IF EXISTS document_annotations_only_piloti_proposes;
--> statement-breakpoint
ALTER TABLE document_annotations DROP CONSTRAINT IF EXISTS document_annotations_only_agent_proposes;
--> statement-breakpoint
ALTER TABLE document_annotations ADD CONSTRAINT document_annotations_only_agent_proposes
  CHECK ("status" <> 'proposed' OR "author_kind" IN ('agent', 'piloti'));
--> statement-breakpoint
ALTER TABLE document_annotations DROP CONSTRAINT IF EXISTS document_annotations_piloti_needs_a_person;
--> statement-breakpoint
ALTER TABLE document_annotations DROP CONSTRAINT IF EXISTS document_annotations_agent_needs_a_person;
--> statement-breakpoint
ALTER TABLE document_annotations ADD CONSTRAINT document_annotations_agent_needs_a_person
  CHECK ("author_kind" = 'person' OR "status" IN ('proposed', 'dismissed') OR "accepted_by" IS NOT NULL);
--> statement-breakpoint
ALTER TABLE document_annotation_replies DROP CONSTRAINT IF EXISTS document_annotation_replies_author_known;
--> statement-breakpoint
ALTER TABLE document_annotation_replies ADD CONSTRAINT document_annotation_replies_author_known
  CHECK ("author_kind" IN ('person', 'agent', 'piloti'));
--> statement-breakpoint
ALTER TABLE proposed_changes DROP CONSTRAINT IF EXISTS proposed_changes_proposer_known;
--> statement-breakpoint
ALTER TABLE proposed_changes ADD CONSTRAINT proposed_changes_proposer_known
  CHECK ("proposed_by_kind" IN ('piloti', 'person', 'agent'));
