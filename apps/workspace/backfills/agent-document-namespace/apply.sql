-- drop after release 2026-W51: ADR-0182 phase 4, deploy 2, step 3 (app database).
-- An agent document's filename moves from piloti/<id>/<name> to generated/<id>/<name>, with
-- the two tables that copy it, in one transaction. Idempotent.

BEGIN;

UPDATE documents
   SET filename = 'generated/' || substr(filename, 8)
 WHERE filename LIKE 'piloti/%' AND authored_by_producer = 'agent_document';

UPDATE permit_records
   SET file_name = 'generated/' || substr(file_name, 8)
 WHERE file_name LIKE 'piloti/%';

UPDATE document_quarantine_decisions
   SET filename = 'generated/' || substr(filename, 8)
 WHERE filename LIKE 'piloti/%';

COMMIT;
