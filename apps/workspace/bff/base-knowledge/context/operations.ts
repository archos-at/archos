/**
 * The knowledge context's operations (ADR-0173, design §4.5, §5.4): how far
 * the base knowledge goes (`coverage-get`), a report of wrong law
 * (`base-knowledge-report`), a project's base (`project-base-get`) and its
 * confirmation as the Steckbrief (`project-base-confirm`). Every read runs as
 * the office; the report alone writes into the platform, as a draft change
 * request a platform reviewer reads.
 */

import 'server-only'
import { and, desc, eq, sql } from 'drizzle-orm'
import { ConflictError, NotFoundError, UnprocessableError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { requirePersonDecision } from '@/lib/agent-api/person-decision'
import { requireProjectAccess } from '@/lib/authz/projects'
import { getDb } from '@/lib/db'
import { projectBaseConfirmations } from '@/lib/db/schema/knowledge-context'
import { sqlTextArray } from '@/lib/db/sql-list'
import { withTenant } from '@/lib/db/tenant-context'
import { readOrganizationCountries } from '../platform/entitlements'
import { insertChangeRequest } from '../platform/store'
import type { CoverageLevel } from '../wire/vocab'
import { knowledgeContextForTurn } from './service'
import type {
  BaseKnowledgeReportBody,
  BaseKnowledgeReportResult,
  CoverageQuery,
  CoverageView,
  ProjectBaseConfirmBody,
  ProjectBaseConfirmResult,
  ProjectBaseView,
} from './operations-wire'

/** Most nodes stating a coverage that one country returns. */
const MAX_NODES = 500

interface CoverageRow extends Record<string, unknown> {
  id: string
  country_id: string
  name: string
  kind: string
  coverage_level: CoverageLevel | null
  municipal_law: boolean | null
}

/** How far the base knowledge goes in each country the office is entitled to: the country's level and every node that states its own. */
export async function readCoverage(session: AuthorizedSession, query: CoverageQuery): Promise<CoverageView> {
  const { organizationId } = session
  const { entitled } = await readOrganizationCountries(organizationId)
  const countries = entitled.map((entry) => entry.countryId).filter((id) => !query.countryId || id === query.countryId)
  if (countries.length === 0) return { countries: [] }
  const rows = await withTenant({ organizationId }, () =>
    getDb().execute<CoverageRow>(sql`
      SELECT r.id, r.country_id, t.name, t.kind, t.coverage_level, t.municipal_law
      FROM knowledge_records r JOIN knowledge_territory_revisions t ON t.revision_id = r.head_revision_id
      WHERE r.organization_id IS NULL AND r.type = 'territory' AND r.head_revision_id IS NOT NULL
        AND knowledge_country_entitled(r.country_id) AND r.country_id = ANY(${sqlTextArray(countries)})
        AND (t.coverage_level IS NOT NULL OR r.id = r.country_id)
      ORDER BY r.country_id, r.id
      LIMIT ${MAX_NODES * countries.length}`),
  )
  return {
    countries: countries.map((countryId) => {
      const own = rows.filter((row) => row.country_id === countryId)
      const country = own.find((row) => row.id === countryId)
      return {
        countryId,
        level: country?.coverage_level ?? 'none',
        nodes: own
          .filter((row) => row.id !== countryId && row.coverage_level !== null)
          .slice(0, MAX_NODES)
          .map((row) => ({ territoryId: row.id, name: row.name, kind: row.kind, level: row.coverage_level, municipalLaw: row.municipal_law })),
      }
    }),
  }
}

/**
 * Report wrong law to the platform: a draft change request in the country,
 * titled with what is wrong, for a platform reviewer to fill and release
 * (design §4.4 "Hotfix"). Only for a country the office is entitled to, so
 * nobody reports on records they cannot read.
 */
export async function reportBaseKnowledge(session: AuthorizedSession, body: BaseKnowledgeReportBody): Promise<BaseKnowledgeReportResult> {
  // A report reaches a platform reviewer outside the office: it goes on the person's own yes, never an agent's.
  requirePersonDecision('Reporting wrong law in the base knowledge to the platform')
  const { entitled } = await readOrganizationCountries(session.organizationId)
  if (!entitled.some((entry) => entry.countryId === body.countryId)) {
    throw new UnprocessableError(`The office is not entitled to ${body.countryId}; a report needs a country whose base knowledge it reads.`)
  }
  const subject = [body.workId, body.editionId, body.messageId ? `(answer ${body.messageId})` : null].filter(Boolean).join(' ')
  const title = `Report${subject ? ` on ${subject}` : ''}: ${body.note}`.slice(0, 200)
  const id = await insertChangeRequest({ title, countryId: body.countryId, createdBy: session.userId })
  return { changeRequestId: id, status: 'draft' }
}

async function contextOf(session: AuthorizedSession, projectId: string) {
  const context = await knowledgeContextForTurn(session.organizationId, projectId, undefined, null, 'operation')
  // The route checks the flag first; a context withheld here is the flag going off between the two reads.
  if (!context) throw new NotFoundError('The knowledge context is not available for this office.')
  return context
}

/** A project's base as the turn reads it, and the newest Steckbrief a person confirmed. Needs project:view. */
export async function readProjectBase(session: AuthorizedSession, projectId: string): Promise<ProjectBaseView> {
  await requireProjectAccess(session, projectId, 'project:view')
  const [context, confirmed] = await Promise.all([
    contextOf(session, projectId),
    withTenant({ organizationId: session.organizationId }, () =>
      getDb()
        .select({
          id: projectBaseConfirmations.id,
          confirmedAt: projectBaseConfirmations.confirmedAt,
          confirmedBy: projectBaseConfirmations.confirmedBy,
          packSeqs: projectBaseConfirmations.packSeqs,
        })
        .from(projectBaseConfirmations)
        .where(and(eq(projectBaseConfirmations.organizationId, session.organizationId), eq(projectBaseConfirmations.projectId, projectId)))
        .orderBy(desc(projectBaseConfirmations.confirmedAt))
        .limit(1),
    ),
  ])
  const row = confirmed[0]
  return { context, confirmed: row ? { ...row, confirmedAt: row.confirmedAt.toISOString() } : null }
}

const sameSeqs = (a: readonly { packId: string; seq: number }[], b: readonly { packId: string; seq: number }[]) =>
  JSON.stringify([...a].sort((x, y) => x.packId.localeCompare(y.packId))) === JSON.stringify([...b].sort((x, y) => x.packId.localeCompare(y.packId)))

/**
 * Confirm the project's Steckbrief: the person's yes on the base as the
 * server resolves it now, never a snapshot the client sent. The packs the
 * person saw must still be the newest, or the confirmation is refused (409)
 * and they look again. Needs project:edit and the person's own decision.
 */
export async function confirmProjectBase(
  session: AuthorizedSession,
  projectId: string,
  body: ProjectBaseConfirmBody,
): Promise<ProjectBaseConfirmResult> {
  await requireProjectAccess(session, projectId, 'project:edit')
  const decisionSource = requirePersonDecision('Confirming a project’s base knowledge (its Steckbrief)')
  const context = await contextOf(session, projectId)
  if (!['open', 'core', 'full'].includes(context.gate.state)) {
    throw new UnprocessableError(`Nothing to confirm: the project's base reads ${context.gate.state}.`)
  }
  if (!sameSeqs(context.packs, body.packs)) {
    throw new ConflictError('The base knowledge was released again since you read it; read project-base-get and confirm what it shows now.')
  }
  const packSeqs = Object.fromEntries(context.packs.map((pack) => [pack.packId, pack.seq]))
  const snapshot = { gate: context.gate, chains: context.chains, date: context.date, procedures: context.procedures, uses: context.uses }
  const [row] = await withTenant({ organizationId: session.organizationId }, () =>
    getDb()
      .insert(projectBaseConfirmations)
      .values({ organizationId: session.organizationId, projectId, confirmedBy: session.userId, decisionSource, snapshot, packSeqs })
      .returning({ id: projectBaseConfirmations.id, confirmedAt: projectBaseConfirmations.confirmedAt }),
  )
  if (!row) throw new ConflictError('The confirmation was not stored; try again.')
  return { id: row.id, confirmedAt: row.confirmedAt.toISOString() }
}
