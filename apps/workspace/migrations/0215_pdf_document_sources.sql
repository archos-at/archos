-- A source whose documents are PDFs (ADR-0174 amendment): the `pdf_document`
-- format, read by ingestion's own text pass (`packages/public-sources`,
-- `knowledge_layer.ingest.pdf_text`). Widens the format CHECK; nothing else
-- changes, and no existing row is touched.
ALTER TABLE "knowledge_source_revisions" DROP CONSTRAINT IF EXISTS knowledge_source_revisions_format_known;
--> statement-breakpoint
ALTER TABLE "knowledge_source_revisions" ADD CONSTRAINT knowledge_source_revisions_format_known
  CHECK ("format" IN ('ris_xml', 'akn', 'html_statute', 'geojson', 'pdf_document'));
