-- Which platform records a released relation reaches, computed once per query
-- instead of once per row.
--
-- 0211 made a platform record readable when the office is entitled to its
-- country OR `knowledge_reached_by_relation(id)`: a recursive walk BACK from
-- that one record along released relations to an entitled one. The records
-- policy (and `recordReadable` in the BFF) evaluated it for every platform row
-- the office is not entitled to, and the revision tables' policies reach the
-- records again through an EXISTS, so one read of a few rows ran it hundreds of
-- times. An office entitled to little of the corpus paid seconds per query:
-- `chain.integration.spec.ts`'s synthetic country read 2 editions in 4.6 s and
-- timed out at 50 s in CI, where the shared database holds more records.
--
-- `knowledge_reached_ids()` walks FORWARD once, from every record the office
-- is entitled to, and returns the set; an uncorrelated `id IN (SELECT ...)` is
-- a hashed subplan Postgres builds at most once per query, and only when a row
-- is not entitled (the OR short-circuits for the rest). The set is exactly the
-- records `knowledge_reached_by_relation` answers true for: the same edges
-- (an edition and its work at the same depth; a released platform
-- `makes_binding`, `deviates_from` or `interprets` relation one step further),
-- the same bound of 8 relation steps, and a relation read through its
-- from-instrument, one hop away.
--
-- `knowledge_reached_by_relation` stays: a pod of the previous build still
-- names it until the rollout ends.
CREATE OR REPLACE FUNCTION knowledge_reached_ids() RETURNS SETOF text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE reach(id, depth) AS (
    SELECT r.id, 0
    FROM knowledge_records r
    WHERE r.organization_id IS NULL AND r.head_revision_id IS NOT NULL AND knowledge_country_entitled(r.country_id)
    UNION
    SELECT step.id, step.depth FROM reach CROSS JOIN LATERAL (
      -- A work is reached where one of its editions is, and an edition where its work is.
      SELECT e.work_id AS id, reach.depth AS depth
      FROM knowledge_records r JOIN knowledge_edition_revisions e ON e.revision_id = r.head_revision_id
      WHERE r.id = reach.id AND r.type = 'edition' AND r.organization_id IS NULL
      UNION ALL
      SELECT r.id, reach.depth
      FROM knowledge_edition_revisions e JOIN knowledge_records r ON r.head_revision_id = e.revision_id
      WHERE e.work_id = reach.id AND r.type = 'edition' AND r.organization_id IS NULL
      UNION ALL
      -- One step forward along a released platform relation that starts here.
      SELECT x.to_id, reach.depth + 1
      FROM knowledge_relation_revisions x
      JOIN knowledge_records rr ON rr.id = x.record_id AND rr.head_revision_id = x.revision_id AND rr.organization_id IS NULL
      WHERE x.from_id = reach.id AND reach.depth < 8 AND x.relation_type IN ('makes_binding', 'deviates_from', 'interprets')
    ) step
  )
  -- A record a relation leads to (at least one step); a relation itself is not
  -- reached by what points at it, only through its from-instrument.
  SELECT reach.id FROM reach
  WHERE reach.depth > 0
    AND NOT EXISTS (SELECT 1 FROM knowledge_records r WHERE r.id = reach.id AND r.type = 'relation' AND r.organization_id IS NULL)
  UNION
  -- A relation is read through its from-instrument: entitled, or reached with a step to spare.
  SELECT r.id
  FROM knowledge_records r JOIN knowledge_relation_revisions x ON x.revision_id = r.head_revision_id
  WHERE r.type = 'relation' AND r.organization_id IS NULL
    AND x.from_id IN (SELECT reach.id FROM reach WHERE reach.depth <= 7)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION knowledge_reached_ids() FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION knowledge_reached_ids() TO %I, %I', rls_role('rw'), rls_role('platform'));
END $$;
--> statement-breakpoint
-- 0228's layered read of records, the reach read as one set.
SELECT secure_table('knowledge_records',
  'organization_id = current_org() OR (organization_id IS NULL AND type <> ''golden_case'' AND head_revision_id IS NOT NULL '
  'AND (knowledge_country_entitled(country_id) OR id IN (SELECT knowledge_reached_ids())))');
