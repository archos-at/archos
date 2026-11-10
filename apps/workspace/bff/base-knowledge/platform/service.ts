/**
 * The platform's base knowledge (ADR-0165): the headless capability that the
 * platform routes, the platform door and the platform view are clients of.
 * Platform knowledge changes only through a change request:
 *
 *   create → propose records (validated, dry run first) → submit → review claim
 *   by claim → approve (the person's yes, four eyes) → publish to preview →
 *   publish to stable (the person's yes) → rollback if needed (the person's yes).
 *
 * Reads take `platform:settings:view` (whose description already covers the base
 * knowledge corpus); writes `platform:settings:manage`; entitlements and a home
 * country `platform:organizations:manage`. Everything answers 403 until the
 * platform organization has the `platform-base-knowledge` flag. Approve,
 * publish, rollback and entitlement need the person's own yes at the server
 * (`requirePersonDecision`), whichever path the call took; each is audited.
 */

import 'server-only'
import { ConflictError, ForbiddenError, NotFoundError, UnprocessableError } from '@/lib/api/errors'
import type { UserSession } from '@/lib/auth/types'
import { recordAuditEvent } from '@/lib/audit/service'
import { FEATURE_FLAGS } from '@/lib/authz/feature-flags'
import { PLATFORM_PERMISSIONS, type PlatformPermission } from '@/lib/authz/permissions'
import { getPlatformOrganizationId, requirePlatformPermission } from '@/lib/authz/platform'
import { isOrgFeatureEnabled } from '@/lib/workos/feature-flags'
import { requirePersonDecision } from '@/lib/agent-api/person-decision'
import { homeCountrySchema } from '@/lib/organizations/home-country'
import type { ChangeRequestStatus } from '@/lib/base-knowledge/wire/vocab'
import { moveHomeCountry, readOrganizationCountries, setEntitlement } from './entitlements'
import { enqueueIndexRuns, readIndexStatus } from './indexing'
import { readOverview } from './overview'
import { referencesOf } from './records'
import { publishChangeRequest, rollbackChangeRequest, type PublishOutcome, type RollbackOutcome } from './release'
import {
  findChangeRequest,
  idsOfBatch,
  insertApproval,
  insertChangeRequest,
  insertProposedRecords,
  insertReviewDecisions,
  knownPlatformRecords,
  listChangeRequests,
  lockChangeRequest,
  platformTransaction,
  readChangeRequest,
  reviewedRevisions,
  setChangeRequestStatus,
  type ProposedRevision,
} from './store'
import { namedTerritories, validateProposal, type Problem } from './validate'
import {
  CHANGE_REQUEST_PAGE,
  type ChangeRequestSummary,
  type ChangeRequestView,
  type IndexStatusView,
  type OrganizationCountriesView,
  type PlatformKnowledgeOverview,
  type ProposedRecord,
  type ReleaseChannelBody,
  type ReviewDecisionBody,
} from './wire'

/** The platform organization has not switched platform knowledge on. */
export class PlatformKnowledgeDisabledError extends ForbiddenError {
  constructor() {
    super('Platform base knowledge is not enabled for the platform organization.')
  }
}

/** The platform permission, then the flag. Unknown platform organization: off (fail closed). */
async function requirePlatform(session: UserSession | null, permission: PlatformPermission): Promise<UserSession> {
  await requirePlatformPermission(session, permission)
  const platformOrganizationId = await getPlatformOrganizationId()
  if (!platformOrganizationId || !(await isOrgFeatureEnabled(FEATURE_FLAGS.platformBaseKnowledge, platformOrganizationId))) {
    throw new PlatformKnowledgeDisabledError()
  }
  return session as UserSession
}

type KnowledgeAuditAction =
  | 'platform.knowledge.change_request_approved'
  | 'platform.knowledge.change_request_rejected'
  | 'platform.knowledge.published'
  | 'platform.knowledge.rolled_back'

/** A decision on a change request, in the platform organization's trail. */
async function audit(
  session: UserSession,
  { action, targetId, metadata }: { action: KnowledgeAuditAction; targetId: string; metadata: Record<string, string | number | boolean> },
) {
  const organizationId = await getPlatformOrganizationId()
  if (!organizationId) return
  await recordAuditEvent({
    organizationId,
    actor: { userId: session.userId, email: session.email },
    action,
    targetType: 'knowledge_change_request',
    targetId,
    metadata,
  })
}

async function requireRequest(id: string) {
  const request = await findChangeRequest(id)
  if (!request) throw new NotFoundError('No change request with this id; list them first.')
  return request
}

export async function platformKnowledgeOverview(session: UserSession | null): Promise<PlatformKnowledgeOverview> {
  await requirePlatform(session, PLATFORM_PERMISSIONS.settingsView)
  return readOverview()
}

export async function listPlatformChangeRequests(
  session: UserSession | null,
  query: { status?: ChangeRequestStatus; limit?: number; cursor?: string },
): Promise<{ changeRequests: ChangeRequestSummary[]; nextCursor: string | null }> {
  await requirePlatform(session, PLATFORM_PERMISSIONS.settingsView)
  const offset = query.cursor ? Number(query.cursor) : 0
  const limit = query.limit ?? CHANGE_REQUEST_PAGE
  // One more than the page says whether another follows.
  const rows = await listChangeRequests(query.status, { offset, limit: limit + 1 })
  return { changeRequests: rows.slice(0, limit), nextCursor: rows.length > limit ? String(offset + limit) : null }
}

export async function getPlatformChangeRequest(session: UserSession | null, id: string): Promise<ChangeRequestView> {
  await requirePlatform(session, PLATFORM_PERMISSIONS.settingsView)
  const view = await readChangeRequest(id)
  if (!view) throw new NotFoundError('No change request with this id; list them first.')
  return view
}

export async function createPlatformChangeRequest(
  session: UserSession | null,
  body: { title: string; countryId: string },
): Promise<{ id: string }> {
  const person = await requirePlatform(session, PLATFORM_PERMISSIONS.settingsManage)
  return { id: await insertChangeRequest({ ...body, createdBy: person.userId }) }
}

export interface ProposalOutcome {
  dryRun: boolean
  problems: Problem[]
  written: ProposedRevision[]
}

/** Validate a batch and, unless it is a dry run or a check failed, write it into the draft. */
export async function proposePlatformRecords(
  session: UserSession | null,
  requestId: string,
  body: { records: ProposedRecord[]; dryRun: boolean },
  proposedBy: 'person' | 'agent' = 'person',
): Promise<ProposalOutcome> {
  const person = await requirePlatform(session, PLATFORM_PERMISSIONS.settingsManage)
  return platformTransaction(async (tx) => {
    const request = await lockChangeRequest(tx, requestId)
    if (!request) throw new NotFoundError('No change request with this id; list them first.')
    if (request.status !== 'draft') throw new ConflictError(`The change request is ${request.status}; records go into a draft.`)
    const named = (record: ProposedRecord) => [
      ...referencesOf(record).map((reference) => reference.id),
      ...namedTerritories(record),
    ]
    const known = await knownPlatformRecords(tx, idsOfBatch(body.records, named))
    const problems = validateProposal(body.records, request.countryId, known)
    if (body.dryRun) return { dryRun: true, problems, written: [] }
    if (problems.length > 0) {
      throw new UnprocessableError(`The proposal failed ${problems.length} check(s); run it with dryRun to see them.`, { problems })
    }
    const written = await insertProposedRecords(tx, request, body.records, { createdBy: person.userId, proposedBy })
    return { dryRun: false, problems: [], written }
  })
}

export async function submitPlatformChangeRequest(session: UserSession | null, requestId: string): Promise<{ status: 'submitted' }> {
  await requirePlatform(session, PLATFORM_PERMISSIONS.settingsManage)
  await platformTransaction(async (tx) => {
    const request = await lockChangeRequest(tx, requestId)
    if (!request) throw new NotFoundError('No change request with this id; list them first.')
    if (request.status !== 'draft') throw new ConflictError(`The change request is ${request.status}; only a draft is submitted.`)
    if ((await reviewedRevisions(tx, requestId)).length === 0) throw new UnprocessableError('The change request holds no records yet.')
    await setChangeRequestStatus(tx, requestId, 'submitted', 'submittedAt')
  })
  return { status: 'submitted' }
}

/** Record verdicts on claims. A review is no approval: it needs no yes of its own, and it changes nothing offices read. */
export async function reviewPlatformChangeRequest(
  session: UserSession | null,
  requestId: string,
  decisions: ReviewDecisionBody['decisions'],
): Promise<{ recorded: number }> {
  const person = await requirePlatform(session, PLATFORM_PERMISSIONS.settingsManage)
  await platformTransaction(async (tx) => {
    const request = await lockChangeRequest(tx, requestId)
    if (!request) throw new NotFoundError('No change request with this id; list them first.')
    if (request.status !== 'submitted') throw new ConflictError(`The change request is ${request.status}; only a submitted one is reviewed.`)
    const claims = new Set(
      (await reviewedRevisions(tx, requestId)).flatMap((revision) => revision.claims.map((claim) => `${revision.revisionId}|${claim.path}`)),
    )
    const unknown = decisions.filter((decision) => !claims.has(`${decision.revisionId}|${decision.claimPath}`))
    if (unknown.length > 0) {
      throw new UnprocessableError(`${unknown.length} decision(s) name no claim of this request; read the request for its claims.`)
    }
    await insertReviewDecisions(tx, requestId, person.userId, decisions)
  })
  return { recorded: decisions.length }
}

/**
 * Approve or reject a submitted request: the person's yes. Approval needs every
 * claim accepted; an edited or rejected claim goes into a follow-up request.
 */
export async function decidePlatformChangeRequest(
  session: UserSession | null,
  requestId: string,
  body: { decision: 'approve' | 'reject'; role: 'domain_expert' | 'counsel' | 'second_reviewer' },
): Promise<{ status: ChangeRequestStatus }> {
  const person = await requirePlatform(session, PLATFORM_PERMISSIONS.settingsManage)
  const decisionSource = requirePersonDecision(`${body.decision === 'approve' ? 'Approving' : 'Rejecting'} a change request`)
  const status = await platformTransaction(async (tx) => {
    const request = await lockChangeRequest(tx, requestId)
    if (!request) throw new NotFoundError('No change request with this id; list them first.')
    if (request.status !== 'submitted') throw new ConflictError(`The change request is ${request.status}; only a submitted one is decided.`)
    if (body.decision === 'reject') {
      await setChangeRequestStatus(tx, requestId, 'rejected', 'decidedAt')
      return 'rejected' as const
    }
    const open = (await reviewedRevisions(tx, requestId)).flatMap((revision) =>
      revision.claims.filter((claim) => claim.decision !== 'accepted').map((claim) => `${revision.recordId}.${claim.path}`),
    )
    if (open.length > 0) {
      throw new ConflictError(`${open.length} claim(s) are not accepted (${open.slice(0, 5).join(', ')}); review them first.`)
    }
    await insertApproval(tx, { changeRequestId: requestId, approver: person.userId, role: body.role, decisionSource })
    await setChangeRequestStatus(tx, requestId, 'approved', 'decidedAt')
    return 'approved' as const
  })
  await audit(person, {
    action: status === 'approved' ? 'platform.knowledge.change_request_approved' : 'platform.knowledge.change_request_rejected',
    targetId: requestId,
    metadata: { role: body.role, decisionSource },
  })
  return { status }
}

export interface PublishReceipt extends PublishOutcome {
  /** Whether every published text's indexing job was enqueued; a failure says which, and the index status shows it. */
  indexing: { enqueued: number; failed: number }
}

export async function publishPlatformChangeRequest(
  session: UserSession | null,
  requestId: string,
  body: ReleaseChannelBody,
): Promise<PublishReceipt> {
  const person = await requirePlatform(session, PLATFORM_PERMISSIONS.settingsManage)
  const decisionSource = requirePersonDecision(`Publishing a change request to ${body.channel}`)
  await requireRequest(requestId)
  const outcome = await publishChangeRequest(requestId, body.channel, { by: person.userId, decisionSource })
  const indexing = await enqueueIndexRuns(await getPlatformOrganizationId(), outcome.indexRuns)
  await audit(person, {
    action: 'platform.knowledge.published',
    targetId: requestId,
    metadata: { channel: body.channel, moved: outcome.moved, decisionSource, indexFailed: indexing.failed },
  })
  return { ...outcome, indexing }
}

export async function rollbackPlatformChangeRequest(
  session: UserSession | null,
  requestId: string,
  reason: string,
): Promise<RollbackOutcome> {
  const person = await requirePlatform(session, PLATFORM_PERMISSIONS.settingsManage)
  const decisionSource = requirePersonDecision('Rolling back a published change request')
  await requireRequest(requestId)
  const outcome = await rollbackChangeRequest(requestId, reason, { by: person.userId, decisionSource })
  await audit(person, {
    action: 'platform.knowledge.rolled_back',
    targetId: requestId,
    metadata: { restored: outcome.restored, decisionSource },
  })
  return outcome
}

export async function platformIndexStatus(session: UserSession | null, requestId: string): Promise<IndexStatusView> {
  await requirePlatform(session, PLATFORM_PERMISSIONS.settingsView)
  await requireRequest(requestId)
  return readIndexStatus(requestId)
}

export async function entitleOrganizationCountry(
  session: UserSession | null,
  organizationId: string,
  body: { countryId: string; entitled: boolean },
): Promise<{ changed: boolean }> {
  const person = await requirePlatform(session, PLATFORM_PERMISSIONS.organizationsManage)
  const decisionSource = requirePersonDecision(body.entitled ? 'Entitling an office to a country' : "Withdrawing an office's country")
  const changed = await setEntitlement(organizationId, body.countryId, body.entitled, { by: person.userId, decisionSource })
  await recordAuditEvent({
    organizationId,
    actor: { userId: person.userId, email: person.email },
    action: body.entitled ? 'platform.organization.country_entitled' : 'platform.organization.country_withdrawn',
    targetType: 'organization',
    targetId: organizationId,
    metadata: { countryId: body.countryId, changed, decisionSource },
  })
  return { changed }
}

export async function setOrganizationHomeCountry(
  session: UserSession | null,
  organizationId: string,
  countryId: string,
): Promise<{ homeCountry: string; previous: string | null }> {
  const person = await requirePlatform(session, PLATFORM_PERMISSIONS.organizationsManage)
  const home = homeCountrySchema.safeParse(countryId)
  if (!home.success) throw new UnprocessableError(`${countryId} is not a country the product is offered in.`)
  const decisionSource = requirePersonDecision("Moving an office's home country")
  const previous = await moveHomeCountry(organizationId, home.data, { by: person.userId, decisionSource })
  await recordAuditEvent({
    organizationId,
    actor: { userId: person.userId, email: person.email },
    action: 'platform.organization.home_country_set',
    targetType: 'organization',
    targetId: organizationId,
    metadata: { homeCountry: home.data, previous: previous ?? '', decisionSource },
  })
  return { homeCountry: home.data, previous }
}

/** An office's own countries: any member reads them. */
export async function organizationCountries(session: UserSession): Promise<OrganizationCountriesView> {
  return readOrganizationCountries(session.organizationId as string)
}
