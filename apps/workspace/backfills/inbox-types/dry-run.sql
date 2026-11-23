-- drop after release 2026-W50: ADR-0182 phase 4, deploy 2, step 1. Read-only.
-- The inbox rows of a piloti.* type, renamed or folded into their agent.* twin
-- by apply.sql: 0 once it has run.

SELECT 'inbox_items.type' AS store, count(*) AS rows FROM inbox_items WHERE type LIKE 'piloti.%';
