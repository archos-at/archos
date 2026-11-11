-- Reverse 0217: the two CHECKs again, with the values every build up to 0216
-- writes. ORDER: roll the frontend back first. A row naming an engine added
-- after 0216 makes this fail; roll that engine's build back and delete its
-- source records first, as 0215's down does for `pdf_document`.
ALTER TABLE "knowledge_source_revisions" ADD CONSTRAINT knowledge_source_revisions_protocol_known
  CHECK ("protocol" IN ('rest', 'http_eli', 'web_document', 'ogc'));
--> statement-breakpoint
ALTER TABLE "knowledge_source_revisions" ADD CONSTRAINT knowledge_source_revisions_format_known
  CHECK ("format" IN ('ris_xml', 'akn', 'html_statute', 'geojson', 'pdf_document'));
