/**
 * What an office reads of the platform's base knowledge (ADR-0165): the norms
 * the platform lists that the office holds no copy of, and the authority
 * directives that apply to a project. Every query runs as the office
 * (`withTenant`) and names the owner and entitlement condition itself, so the
 * layered RLS is the backstop, not the filter: a platform row with a head, of a
 * country the office is entitled to, at its released revision.
 */

import 'server-only'
import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { FEATURE_FLAGS } from '@/lib/authz/feature-flags'
import { isOrgFeatureEnabled } from '@/lib/workos/feature-flags'
import type { ListedEdition, PlatformDirective, PlatformKnowledge } from '../platform'
import { readTerritoryParents } from './territories'
import {
  platformDirectiveApplies,
  type PlatformAddressee,
  type PlatformAuthority,
} from './applicability'

/** Most listings or directives one turn reads. */
const MAX_READ = 200

/** `ÖNORM B 1600:2017` and `önorm  b 1600` name the same work: case, spacing and the edition suffix aside. */
export function designationKey(designation: string): string {
  return designation
    .toLocaleLowerCase('de')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/:\d{4}(-\d{2}(-\d{2})?)?$/, '')
}

interface ListingRow extends Record<string, unknown> {
  designation: string
  title: string
  edition_label: string
  has_text: boolean
}

async function listedFor(organizationId: string): Promise<ListedEdition[]> {
  const rows = await withTenant({ organizationId }, () =>
    getDb().execute<ListingRow>(sql`
      SELECT w.identifiers ->> 'designation' AS designation, w.title, e.label AS edition_label,
        EXISTS (
          SELECT 1 FROM knowledge_records mr
          JOIN knowledge_manifestation_revisions m ON m.revision_id = mr.head_revision_id
          WHERE mr.organization_id IS NULL AND m.edition_id = er.id AND m.corpus_file IS NOT NULL
        ) AS has_text
      FROM knowledge_records wr
      JOIN knowledge_work_revisions w ON w.revision_id = wr.head_revision_id
      JOIN knowledge_edition_revisions e ON e.work_id = wr.id
      JOIN knowledge_records er ON er.id = e.record_id AND er.head_revision_id = e.revision_id
      WHERE wr.organization_id IS NULL AND wr.type = 'work' AND knowledge_country_entitled(wr.country_id)
        AND er.organization_id IS NULL
        AND w.identifiers ->> 'designation' IS NOT NULL
      ORDER BY designation
      LIMIT ${MAX_READ}`)
  )
  return rows.map((row) => ({
    designation: String(row.designation),
    title: String(row.title),
    editionLabel: String(row.edition_label),
    hasText: row.has_text === true,
  }))
}

interface DirectiveRow extends Record<string, unknown> {
  title: string
  designation: string | null
  addressees: PlatformAddressee[]
  edition_label: string | null
}

interface AuthorityRow extends Record<string, unknown> {
  id: string
  name: string
  competence_territory_ids: string[]
}

async function directivesFor(
  organizationId: string,
  territoryId: string | null
): Promise<PlatformDirective[]> {
  return withTenant({ organizationId }, async () => {
    const db = getDb()
    const directives = await db.execute<DirectiveRow>(sql`
      SELECT w.title, w.identifiers ->> 'designation' AS designation, w.addressees,
        (SELECT e.label FROM knowledge_edition_revisions e
           JOIN knowledge_records er ON er.id = e.record_id AND er.head_revision_id = e.revision_id
           WHERE e.work_id = wr.id AND er.organization_id IS NULL
           ORDER BY e.issued_on DESC NULLS LAST LIMIT 1) AS edition_label
      FROM knowledge_records wr
      JOIN knowledge_work_revisions w ON w.revision_id = wr.head_revision_id
      WHERE wr.organization_id IS NULL AND wr.type = 'work' AND knowledge_country_entitled(wr.country_id)
        AND w.kind = 'authority_directive'
      ORDER BY w.title
      LIMIT ${MAX_READ}`)
    if (directives.length === 0) return []
    const [authorities, parents] = await Promise.all([
      db.execute<AuthorityRow>(sql`
        SELECT r.id, a.name, a.competence_territory_ids
        FROM knowledge_records r JOIN knowledge_authority_revisions a ON a.revision_id = r.head_revision_id
        WHERE r.organization_id IS NULL AND r.type = 'authority' AND knowledge_country_entitled(r.country_id)
        LIMIT ${MAX_READ}`),
      territoryId
        ? readTerritoryParents(db, territoryId)
        : Promise.resolve(new Map<string, string[]>()),
    ])
    const authorityById = new Map<string, PlatformAuthority>(
      authorities.map((row) => [
        row.id,
        { id: row.id, name: row.name, competenceTerritoryIds: row.competence_territory_ids },
      ])
    )
    return directives.flatMap((row) => {
      const verdict = platformDirectiveApplies(row.addressees, authorityById, parents, territoryId)
      if (verdict.verdict === 'excluded') return []
      return [
        {
          title: row.title,
          designation: row.designation,
          editionLabel: row.edition_label,
          authorities: row.addressees.map(
            (addressee) => authorityById.get(addressee.authorityId ?? '')?.name ?? addressee.name
          ),
          verdict,
        },
      ]
    })
  })
}

/** The platform as offices read it once its records exist; the stub's answers while the flag is off. */
export const PLATFORM_RECORDS_KNOWLEDGE: PlatformKnowledge = {
  async listedNotHeld(organizationId, held) {
    if (!(await isOrgFeatureEnabled(FEATURE_FLAGS.platformBaseKnowledge, organizationId))) return []
    const holds = new Set(held.map(designationKey))
    return (await listedFor(organizationId)).filter(
      (listed) => !holds.has(designationKey(listed.designation))
    )
  },
  async isReleased(organizationId, revisionId) {
    if (!(await isOrgFeatureEnabled(FEATURE_FLAGS.platformBaseKnowledge, organizationId)))
      return false
    const rows = await withTenant({ organizationId }, () =>
      getDb().execute(sql`
        SELECT 1 FROM knowledge_revisions
        WHERE revision_id = ${revisionId} AND organization_id IS NULL AND knowledge_revision_released(revision_id)
          AND EXISTS (SELECT 1 FROM knowledge_records r WHERE r.id = record_id AND knowledge_country_entitled(r.country_id))`)
    )
    return rows.length > 0
  },
  async directivesFor(organizationId, territoryId) {
    if (!(await isOrgFeatureEnabled(FEATURE_FLAGS.platformBaseKnowledge, organizationId))) return []
    return directivesFor(organizationId, territoryId)
  },
}
