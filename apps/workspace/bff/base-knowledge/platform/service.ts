import 'server-only'
import { ConflictError, NotFoundError, UnprocessableError } from '@/lib/api/errors'
import type { UserSession } from '@/lib/auth/types'
import { recordAuditEvent } from '@/lib/audit/service'
import { PLATFORM_PERMISSIONS, type PlatformPermission } from '@/lib/authz/permissions'
import { getPlatformOrganizationId, requirePlatformPermission } from '@/lib/authz/platform'
import { actingClientId } from '@/lib/agent-api/acting-session'
import { callDecisionSource, requirePersonDecision } from '@/lib/agent-api/person-decision'
import { homeCountrySchema } from '@/lib/organizations/home-country'
import type {
  ApprovalRole,
  ChangeRequestOrigin,
  ChangeRequestStatus,
  SecondReviewState,
} from '@/lib/base-knowledge/wire/vocab'
import { moveHomeCountry, readOrganizationCountries, setEntitlement } from './entitlements'
import { enqueueDeindex, enqueueIndexRuns, readIndexStatus } from './indexing'
import { readOverview } from './overview'
import { audit, auditOfDecision, decideInTransaction, SECOND_REVIEW_STATUSES, type DecisionOutcome } from './decide'
import { readOrganizationPlacements } from './organization-countries'
import { requestSourceChecks, requestTextProblems, runKit, validateRequest } from './onboarding'
import { checksOutsideKit } from './text-checks'
import { pinnedTexts } from './text-store'
import { requirePlatform } from './service-gate'
import { proposalKey as keyOf, recordIdOf } from './records'
import { DISPUTED_NOT_PUBLISHED, publishChangeRequest, rollbackChangeRequest, type PublishOutcome, type RollbackOutcome } from './release'
import {
  findChangeRequest,
  insertChangeRequest,
  insertProposedRecords,
  insertReviewDecisions,
  listChangeRequests,
  lockChangeRequest,
  platformTransaction,
  readChangeRequest,
  reviewedRevisions,
  setChangeRequestStatus,
} from './store'
import {
  CHANGE_REQUEST_PAGE,
  type ApprovalBody,
  type ChangeRequestSummary,
  type ChangeRequestView,
  type IndexStatusView,
  type OrganizationCountriesView,
  type PlatformKnowledgeOverview,
  type PlatformOrganizationCountries,
  type ProposalRecordResult,
  type ProposalView,
  type ProposedRecord,
  type ReleaseChannelBody,
  type ReviewDecisionBody,
} from './wire'

const APPROVAL_ROLE_PERMISSIONS: Readonly<Record<ApprovalRole, PlatformPermission>> = {
  domain_expert: PLATFORM_PERMISSIONS.knowledgeApproveAsDomainExpert,
  counsel: PLATFORM_PERMISSIONS.knowledgeApproveAsCounsel,
  privacy_reviewer: PLATFORM_PERMISSIONS.knowledgeApproveAsPrivacyReviewer,
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
  query: { status?: ChangeRequestStatus; countryId?: string; origin?: ChangeRequestOrigin; secondReview?: SecondReviewState; limit?: number; cursor?: string },
): Promise<{ changeRequests: ChangeRequestSummary[]; nextCursor: string | null }> {
  await requirePlatform(session, PLATFORM_PERMISSIONS.settingsView)
  const offset = query.cursor ? Number(query.cursor) : 0
  const limit = query.limit ?? CHANGE_REQUEST_PAGE
  const rows = await listChangeRequests(
    { status: query.status, countryId: query.countryId, origin: query.origin, secondReview: query.secondReview },
    { offset, limit: limit + 1 },
  )
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
  const person = await requirePlatform(session, PLATFORM_PERMISSIONS.knowledgeWrite)
  return { id: await insertChangeRequest({ ...body, createdBy: person.userId }) }
}


export async function proposePlatformRecords(
  session: UserSession | null,
  requestId: string,
  body: { records: ProposedRecord[]; dryRun: boolean },
  proposedBy: 'person' | 'agent' = 'person',
): Promise<ProposalView> {
  const person = await requirePlatform(session, PLATFORM_PERMISSIONS.knowledgeWrite)
  const pinned = await platformTransaction((tx) => pinnedTexts(tx, requestId))
  const { checks: sourceChecks, pins, awaiting } = await checksOutsideKit(body.records, pinned, true, requestId)
  return platformTransaction(async (tx) => {
    const request = await lockChangeRequest(tx, requestId)
    if (!request) throw new NotFoundError('No change request with this id; list them first.')
    if (request.status !== 'draft') throw new ConflictError(`The change request is ${request.status}; records go into a draft.`)
    const problems = await runKit(tx, request, body.records, sourceChecks)
    const results = body.records.map((record, index): ProposalRecordResult => {
      const own = problems.filter((problem) => problem.index === index)
      const status = own.length > 0 ? 'invalid' : 'valid'
      const waits = awaiting.get(recordIdOf(record))
      return { index, key: own[0]?.key ?? keyOf(record), recordId: recordIdOf(record), status, revisionId: null, problems: own, ...(waits ? { awaiting: waits } : {}) }
    })
    if (body.dryRun) return { dryRun: true, valid: problems.length === 0, results }
    if (problems.length > 0) {
      throw new UnprocessableError(`The proposal failed ${problems.length} check(s) on ${results.filter((r) => r.status === 'invalid').length} record(s); nothing was written.`, { results })
    }
    const viaClient = actingClientId()
    const written = await insertProposedRecords(tx, request, body.records, { createdBy: person.userId, proposedBy, pins, ...(viaClient ? { viaClient } : {}) })
    return {
      dryRun: false,
      valid: true,
      results: results.map((result, index) => ({ ...result, status: written[index]?.status ?? 'written', revisionId: written[index]?.revisionId ?? null })),
    }
  })
}

export async function submitPlatformChangeRequest(session: UserSession | null, requestId: string): Promise<{ status: 'submitted' }> {
  await requirePlatform(session, PLATFORM_PERMISSIONS.knowledgeWrite)
  const sourceChecks = await requestSourceChecks(requestId)
  await platformTransaction(async (tx) => {
    const request = await lockChangeRequest(tx, requestId)
    if (!request) throw new NotFoundError('No change request with this id; list them first.')
    if (request.status !== 'draft') throw new ConflictError(`The change request is ${request.status}; only a draft is submitted.`)
    if ((await reviewedRevisions(tx, requestId)).length === 0) throw new UnprocessableError('The change request holds no records yet.')
    const validation = await validateRequest(tx, request, sourceChecks)
    if (!validation.valid) {
      throw new UnprocessableError(`The change request fails ${validation.problems.length} check(s); run platform-knowledge-validate and repair them.`, { problems: validation.problems })
    }
    await setChangeRequestStatus(tx, requestId, 'submitted', 'submittedAt')
  })
  return { status: 'submitted' }
}

export async function reviewPlatformChangeRequest(
  session: UserSession | null,
  requestId: string,
  decisions: ReviewDecisionBody['decisions'],
): Promise<{ recorded: number }> {
  const person = await requirePlatform(session, PLATFORM_PERMISSIONS.knowledgeReview)
  if (decisions.some((decision) => decision.sourceChecked)) requirePersonDecision('Marking a cited source as checked')
  await platformTransaction(async (tx) => {
    const request = await lockChangeRequest(tx, requestId)
    if (!request) throw new NotFoundError('No change request with this id; list them first.')
    if (request.status !== 'submitted' && !(request.secondReview === 'due' && SECOND_REVIEW_STATUSES.includes(request.status))) {
      throw new ConflictError(`The change request is ${request.status}; only a submitted one, or one whose second review is due, is reviewed.`)
    }
    const revisions = await reviewedRevisions(tx, requestId)
    const claims = new Set(revisions.flatMap((revision) => revision.claims.map((claim) => `${revision.revisionId}|${claim.path}`)))
    const unknown = decisions.filter((decision) => !claims.has(`${decision.revisionId}|${decision.claimPath}`))
    if (unknown.length > 0) {
      throw new UnprocessableError(`${unknown.length} decision(s) name no claim of this request; read the request for its claims.`)
    }
    await insertReviewDecisions(tx, requestId, { by: person.userId, decisionSource: callDecisionSource() }, decisions)
  })
  return { recorded: decisions.length }
}

export async function decidePlatformChangeRequest(
  session: UserSession | null,
  requestId: string,
  body: ApprovalBody,
): Promise<DecisionOutcome> {
  const person = await requirePlatform(session, PLATFORM_PERMISSIONS.knowledgeReview)
  const role = body.role ?? 'domain_expert'
  if (body.override && body.decision !== 'approve') throw new UnprocessableError('An override is for approving; a reject needs none.')
  await requirePlatformPermission(person, APPROVAL_ROLE_PERMISSIONS[role])
  if (body.override) await requirePlatformPermission(person, PLATFORM_PERMISSIONS.knowledgeApproveAlone)
  const verb = body.override ? 'Approving a change request alone, without a second person' : `${body.decision === 'approve' ? 'Approving' : 'Rejecting'} a change request`
  const decisionSource = requirePersonDecision(verb)
  if (body.decision === 'approve') {
    const problems = await requestTextProblems(requestId)
    if (problems.length > 0) {
      throw new ConflictError(`A text of this change request is not the one that was proposed (${problems.length} problem(s)); it is not approved.`, { problems })
    }
  }
  const outcome = await platformTransaction((tx) => decideInTransaction(tx, requestId, { ...body, role }, { by: person.userId, decisionSource }))
  await audit(person, auditOfDecision(requestId, body, role, decisionSource, outcome))
  return {
    status: outcome.status,
    awaiting: outcome.awaiting,
    approval: outcome.approval,
    secondReview: outcome.secondReview,
    secondReviewDue: outcome.secondReviewDue,
  }
}

export interface PublishReceipt extends PublishOutcome {
  indexing: { enqueued: number; failed: number }
}

export async function publishPlatformChangeRequest(
  session: UserSession | null,
  requestId: string,
  body: ReleaseChannelBody,
): Promise<PublishReceipt> {
  const person = await requirePlatform(session, PLATFORM_PERMISSIONS.knowledgeReview)
  const decisionSource = requirePersonDecision(`Publishing a change request to ${body.channel}`)
  const request = await requireRequest(requestId)
  if (request.secondReview === 'disputed') {
    throw new ConflictError(DISPUTED_NOT_PUBLISHED)
  }
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
  const person = await requirePlatform(session, PLATFORM_PERMISSIONS.knowledgeReview)
  const decisionSource = requirePersonDecision('Rolling back a published change request')
  await requireRequest(requestId)
  const outcome = await rollbackChangeRequest(requestId, reason, { by: person.userId, decisionSource })
  const deindexFailed = outcome.unreleasedFiles.length > 0 ? await enqueueDeindex(await getPlatformOrganizationId(), outcome.unreleasedFiles) : 0
  await audit(person, {
    action: 'platform.knowledge.rolled_back',
    targetId: requestId,
    metadata: { restored: outcome.restored, decisionSource, deindexed: outcome.unreleasedFiles.length, deindexFailed },
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

export async function listOrganizationPlacements(
  session: UserSession | null,
  page: { limit?: number; cursor?: string } = {},
): Promise<PlatformOrganizationCountries> {
  await requirePlatform(session, PLATFORM_PERMISSIONS.organizationsView)
  return readOrganizationPlacements(page)
}

export async function organizationCountries(session: UserSession): Promise<OrganizationCountriesView> {
  return readOrganizationCountries(session.organizationId as string)
}
