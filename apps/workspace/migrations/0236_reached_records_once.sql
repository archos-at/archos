-- Which countries an office is entitled to, and which platform records a
-- released relation reaches, each computed as one set per subplan instead of
-- once per row.
--
-- 0211 made a platform record readable when the office is entitled to its
-- country (`knowledge_country_entitled(country_id)`) OR
-- `knowledge_reached_by_relation(id)`, a recursive walk BACK from that one
-- record along released relations to an entitled one. The records policy (and
-- `recordReadable` in the BFF) evaluated both for every platform row it looked
-- at, and the revision tables' policies look at the records again through an
-- EXISTS, so one read of a few rows ran them hundreds of times.
-- `chain.integration.spec.ts` timed out at 50 s in CI.
--
-- Measured 2026-11-12 on CI's shape (the platform, time, onboarding and
-- synthetic-country suites first, `track_functions = all`), the chain spec ran
-- `knowledge_country_entitled` 501,581 times (10.6 s) and the walk 19,513
-- times (3.9 s). The first form of this migration made only the reach a set,
-- seeded from every entitled record: 554,735 entitlement calls (9.5 s) plus 285
-- builds of 26 ms (7.6 s), slower than before, and develop went red. With both
-- read as sets and the reach seeded only where a step can leave: 56,980
-- entitlement calls (most of them the oracle's own), and the whole-pack walk
-- took 1.2 s against 4.4 s before.
--
-- `knowledge_entitled_countries()` answers the countries
-- `knowledge_country_entitled(c)` answers true for: the office's home country,
-- the countries it was given, and `EU` while it is a member (0219's rule,
-- called once). `knowledge_reached_ids()` walks FORWARD once from the entitled
-- records a step can leave from (a work, an edition, a relation's
-- from-instrument; the rest of a pack takes no step) and answers exactly the
-- records `knowledge_reached_by_relation` answers true for: the same edges (an
-- edition and its work at the same depth; a released platform
-- `makes_binding`, `deviates_from` or `interprets` relation one step further),
-- the same bound of 8 relation steps, and a relation read through its
-- from-instrument, one hop away. An uncorrelated `x IN (SELECT ...)` is a
-- hashed subplan Postgres builds at most once where it appears; a query names
-- the records more than once (the policy, `recordReadable`, each revision
-- policy's EXISTS), so it may build each set two to four times: still a
-- handful, where the per-row forms ran once per row. A record with no country
-- is entitled to no one: `NULL IN (...)` is NULL, which the OR reads as false.
-- `visibility.integration.spec.ts` holds both sets to the per-row functions.
--
-- `knowledge_country_entitled` and `knowledge_reached_by_relation` stay: the
-- BFF calls the first for `EU` (`corpus-countries.ts`), a pod of the previous
-- build names both until the rollout ends, and they are the oracle.
CREATE OR REPLACE FUNCTION knowledge_entitled_countries() RETURNS SETOF text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.home_country FROM organizations o
  WHERE o.workos_organization_id = current_org() AND o.home_country IS NOT NULL
  UNION
  SELECT c.country_id FROM organization_countries c
  WHERE c.organization_id = current_org() AND c.country_id IS NOT NULL
  UNION
  SELECT 'EU' WHERE knowledge_country_entitled('EU')
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION knowledge_entitled_countries() FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION knowledge_entitled_countries() TO %I, %I', rls_role('rw'), rls_role('platform'));
END $$;
--> statement-breakpoint
-- The reach, walked forward once from the entitled records a step can leave from.
CREATE OR REPLACE FUNCTION knowledge_reached_ids() RETURNS SETOF text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE reach(id, depth) AS (
    SELECT r.id, 0
    FROM knowledge_records r
    WHERE r.organization_id IS NULL AND r.head_revision_id IS NOT NULL
      AND r.country_id IN (SELECT knowledge_entitled_countries())
      AND (r.type IN ('work', 'edition') OR r.id IN (SELECT x.from_id FROM knowledge_relation_revisions x))
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
-- 0228's layered read of records, the entitlement and the reach each read as one set.
SELECT secure_table('knowledge_records',
  'organization_id = current_org() OR (organization_id IS NULL AND type <> ''golden_case'' AND head_revision_id IS NOT NULL '
  'AND (country_id IN (SELECT knowledge_entitled_countries()) OR id IN (SELECT knowledge_reached_ids())))');
