import 'server-only'
import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import type { DirectoryWork, ListedEdition, PlatformDirective, PlatformKnowledge } from '../platform'
import { calendarDayIn } from '@/lib/format'
import { officeTimeZone } from '@/lib/organizations/time-zone'
import { competentAuthorities } from '@/lib/site-resolution/competence'
import type { SiteAuthority } from '@/lib/site-resolution/wire'
import { designationKey, directiveVerdict, workKeyOf, type PlatformAddressee } from '../platform'
import { recordReadable } from '../store/visibility'
import { isoDateOf, readTerritoryChain } from '../time/repository'

const MAX_READ = 200

const asciiKey = (designation: string) => workKeyOf(designation.replace(/[A-Z]/g, (letter) => letter.toLowerCase()))

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
      WHERE wr.organization_id IS NULL AND wr.type = 'work' AND ${recordReadable('wr', organizationId)}
        AND er.organization_id IS NULL AND ${recordReadable('er', organizationId)}
        AND w.identifiers ->> 'designation' IS NOT NULL
      ORDER BY designation
      LIMIT ${MAX_READ}`),
  )
  return rows.map((row) => ({
    designation: String(row.designation),
    title: String(row.title),
    editionLabel: String(row.edition_label),
    hasText: row.has_text === true,
  }))
}

interface DirectoryRow extends Record<string, unknown> {
  designation: string
  title: string
  label: string
  issued_on: unknown
  in_force_from: unknown
  in_force_to: unknown
}

async function editionsOf(organizationId: string, designations: readonly string[]): Promise<DirectoryWork[]> {
  const keys = [...new Set(designations.map((designation) => designationKey(designation)))]
  if (keys.length === 0) return []
  const spellings = [...new Set(designations.flatMap((designation) => [designationKey(designation), asciiKey(designation)]))]
  const rows = await withTenant({ organizationId }, () =>
    getDb().execute<DirectoryRow>(sql`
      SELECT w.identifiers ->> 'designation' AS designation, w.title, e.label, e.issued_on, e.in_force_from, e.in_force_to
      FROM knowledge_records wr
      JOIN knowledge_work_revisions w ON w.revision_id = wr.head_revision_id
      JOIN knowledge_edition_revisions e ON e.work_id = wr.id
      JOIN knowledge_records er ON er.id = e.record_id AND er.head_revision_id = e.revision_id
      WHERE wr.organization_id IS NULL AND wr.type = 'work' AND ${recordReadable('wr', organizationId)}
        AND er.organization_id IS NULL AND ${recordReadable('er', organizationId)}
        AND lower(regexp_replace(btrim(regexp_replace(w.identifiers ->> 'designation', '[[:space:]]+', ' ', 'g')), ':[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$', ''))
          IN (${sql.join(spellings.map((spelling) => sql`${spelling}`), sql`, `)})
      ORDER BY designation, e.in_force_from NULLS FIRST
      LIMIT ${MAX_READ}`),
  )
  const wanted = new Set(keys)
  const works = new Map<string, DirectoryWork>()
  for (const row of rows) {
    const key = designationKey(String(row.designation))
    if (!wanted.has(key)) continue
    const work = works.get(key) ?? { designation: String(row.designation), title: String(row.title), editions: [] }
    work.editions.push({
      label: String(row.label),
      issuedOn: isoDateOf(row.issued_on),
      inForceFrom: isoDateOf(row.in_force_from),
      inForceTo: isoDateOf(row.in_force_to),
    })
    works.set(key, work)
  }
  return [...works.values()]
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
}

async function competenceAt(organizationId: string, territoryId: string): Promise<SiteAuthority> {
  const today = calendarDayIn(await officeTimeZone(organizationId))
  const chain = await readTerritoryChain(organizationId, territoryId, today)
  const [site] = await competentAuthorities(organizationId, [chain], today)
  return site ?? { status: 'undetermined', reason: 'no_territory' }
}

async function directivesFor(organizationId: string, territoryId: string | null): Promise<PlatformDirective[]> {
  const { directives, authorities } = await withTenant({ organizationId }, async () => {
    const db = getDb()
    const directives = await db.execute<DirectiveRow>(sql`
      SELECT w.title, w.identifiers ->> 'designation' AS designation, w.addressees,
        (SELECT e.label FROM knowledge_edition_revisions e
           JOIN knowledge_records er ON er.id = e.record_id AND er.head_revision_id = e.revision_id
           WHERE e.work_id = wr.id AND er.organization_id IS NULL
           ORDER BY e.issued_on DESC NULLS LAST LIMIT 1) AS edition_label
      FROM knowledge_records wr
      JOIN knowledge_work_revisions w ON w.revision_id = wr.head_revision_id
      WHERE wr.organization_id IS NULL AND wr.type = 'work' AND ${recordReadable('wr', organizationId)}
        AND w.kind = 'authority_directive'
      ORDER BY w.title
      LIMIT ${MAX_READ}`)
    if (directives.length === 0) return { directives, authorities: [] as AuthorityRow[] }
    const authorities = await db.execute<AuthorityRow>(sql`
      SELECT r.id, a.name
      FROM knowledge_records r JOIN knowledge_authority_revisions a ON a.revision_id = r.head_revision_id
      WHERE r.organization_id IS NULL AND r.type = 'authority' AND ${recordReadable('r', organizationId)}
      LIMIT ${MAX_READ}`)
    return { directives, authorities }
  })
  if (directives.length === 0) return []
  const site = territoryId ? await competenceAt(organizationId, territoryId) : null
  const nameById = new Map(authorities.map((row) => [row.id, row.name]))
  return directives.flatMap((row) => {
    const verdict = directiveVerdict(row.addressees, site, territoryId)
    if (verdict.verdict === 'excluded') return []
    return [
      {
        title: row.title,
        designation: row.designation,
        editionLabel: row.edition_label,
        authorities: row.addressees.map((addressee) => nameById.get(addressee.authorityId ?? '') ?? addressee.name),
        verdict,
      },
    ]
  })
}

export const PLATFORM_RECORDS_KNOWLEDGE: PlatformKnowledge = {
  async listedNotHeld(organizationId, held) {
    const holds = new Set(held.map(designationKey))
    return (await listedFor(organizationId)).filter((listed) => !holds.has(designationKey(listed.designation)))
  },
  async editionsOf(organizationId, designations) {
    return editionsOf(organizationId, designations)
  },
  async isReleased(organizationId, revisionId) {
    const rows = await withTenant({ organizationId }, () =>
      getDb().execute(sql`
        SELECT 1 FROM knowledge_revisions
        WHERE revision_id = ${revisionId} AND organization_id IS NULL AND knowledge_revision_released(revision_id)
          AND EXISTS (SELECT 1 FROM knowledge_records r WHERE r.id = record_id AND ${recordReadable('r', organizationId)})`),
    )
    return rows.length > 0
  },
  async directivesFor(organizationId, territoryId) {
    return directivesFor(organizationId, territoryId)
  },
}
