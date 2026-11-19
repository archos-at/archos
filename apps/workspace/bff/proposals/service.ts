import 'server-only'
import { defaultLocale, type Locale } from '@/i18n/config'
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { canManageOfficeShelf } from '@/lib/authz/organizations'
import { requireProjectAccess } from '@/lib/authz/projects'
import { findConversationInOrg } from '@/lib/conversations/repository'
import { findOperation } from '@/lib/agent-api/catalog'
import { describeTargets, requireTargetsReadable, TooManyTargetsError, targetsOf } from '@/lib/agent-api/operation-targets'
import { requireResourceAccess } from '@/lib/sharing/access'
import { loadOrganizationDirectory } from '@/lib/sharing/directory'
import { recordDecisionScore, type Decision } from '@/lib/langfuse/decision-score'
import { onProposalCreated, onProposalDecided } from './attention'
import { auditProposalCreated, auditProposalDecided } from './audit'
import { resolveItemDocuments } from './executors'
import {
  applyKind,
  DECIDE_PERMISSIONS,
  noticeVariantOf,
  ORGANIZATION_KINDS,
  parseKindPayload,
  requireProposable,
  summaryOf,
  type KindPayload,
} from './kinds'
import { publishProposalDecided } from './live'
import {
  claimProposedChange,
  deleteUndecidedProposedChange,
  dismissProposedChange,
  findOpenOperationProposal,
  findProposedChange,
  insertProposedChange,
  listShelfProposals,
  releaseProposedChange,
  settleProposedChange,
  type ProposalShelf,
  type ProposedChangeRow,
} from './repository'
import {
  type ApplyProposalRequest,
  type ListedProposal,
  type ParsedProposalListQuery,
  type ProposalListResponse,
  type ProposalScope,
  type ProposedChangeKind,
  type ProposedChangeResult,
  type ProposedChangeStatus,
  type ProposedChangeView,
} from './types'
import { AGENT_KIND } from '@/lib/agent-kind'

export const APPLY_CLAIM_TTL_MS = 5 * 60 * 1000

const staleBefore = (now = Date.now()) => new Date(now - APPLY_CLAIM_TTL_MS)

const claimIsLive = (row: ProposedChangeRow, now = Date.now()) =>
  row.applyingSince !== null && row.applyingSince.getTime() >= now - APPLY_CLAIM_TTL_MS

function scopeOf(projectId: string | null, typed: KindPayload): ProposalScope {
  if (projectId) return 'project'
  return ORGANIZATION_KINDS.has(typed.kind) ? 'organization' : 'office_shelf'
}

export interface CreateProposalInput {
  projectId: string | null
  kind: ProposedChangeKind
  payload: unknown
  conversationId: string | null
  answerMessageId: string | null
  originCardIndex?: number | null
  originTraceId?: string | null
}

export async function createProposal(session: AuthorizedSession, input: CreateProposalInput): Promise<ProposedChangeRow> {
  if (input.projectId) await requireProjectAccess(session, input.projectId, 'project:view')
  const typed = parseKindPayload(input.kind, input.payload)
  const scope = scopeOf(input.projectId, typed)
  requireProposable(typed, scope)
  if (input.conversationId) {
    const conversation = await findConversationInOrg(input.conversationId, session.organizationId)
    if (!conversation) throw new NotFoundError('Conversation not found')
    if (typed.kind === 'operation') {
      const open = await findOpenOperationProposal(session.organizationId, input.conversationId, session.userId, typed.payload)
      if (open) return open
    }
  }
  const { row, created } = await insertProposedChange({
    organizationId: session.organizationId,
    projectId: input.projectId,
    scope,
    kind: typed.kind,
    payload: typed.payload,
    proposedByKind: AGENT_KIND,
    onBehalfOf: session.userId,
    originConversationId: input.conversationId,
    originMessageId: input.answerMessageId,
    originCardIndex: input.answerMessageId ? (input.originCardIndex ?? null) : null,
    originTraceId: input.originTraceId ?? null,
  })
  if (!created) {
    if (
      row.projectId !== input.projectId ||
      row.originConversationId !== input.conversationId ||
      row.kind !== typed.kind
    ) {
      throw new ConflictError('This card already names another proposal', { reason: 'proposal-card-taken' })
    }
    return row
  }
  auditProposalCreated(session, row, typed)
  bestEffort('attention (created)', () =>
    onProposalCreated({
      organizationId: row.organizationId,
      projectId: row.projectId,
      proposalId: row.id,
      originConversationId: row.originConversationId,
      onBehalfOf: row.onBehalfOf,
      summary: summaryOf(typed),
      variant: noticeVariantOf(typed),
    })
  )
  return row
}

function bestEffort(what: string, run: () => Promise<unknown>): void {
  void Promise.resolve()
    .then(run)
    .catch((error: unknown) => {
      console.warn(`[proposals] ${what} failed (non-fatal):`, error)
    })
}

function afterDecision(session: AuthorizedSession, row: ProposedChangeRow): void {
  const status = row.status
  if (status === 'proposed') return
  bestEffort('live publish', () => publishProposalDecided(row.id, status))
  bestEffort('attention (decided)', () => onProposalDecided({ organizationId: row.organizationId, proposalId: row.id }))
  auditProposalDecided(session, row)
  const decision: Decision | null =
    status === 'dismissed' ? 'dismissed' : status === 'failed' ? null : 'accepted'
  if (!decision) return
  bestEffort('decision score', () =>
    recordDecisionScore({
      organizationId: row.organizationId,
      subject: 'proposal',
      subjectId: row.id,
      decision,
      decidedBy: session.userId,
      origin:
        row.originConversationId && row.originMessageId
          ? { conversationId: row.originConversationId, messageId: row.originMessageId }
          : null,
      traceId: row.originTraceId,
    })
  )
}

async function documentsFor(
  session: AuthorizedSession,
  row: ProposedChangeRow,
  typed: KindPayload = parseKindPayload(row.kind, row.payload)
): Promise<ListedProposal['documents'] | null> {
  if (typed.kind !== 'file_operation') return []
  return resolveItemDocuments(session, row.projectId, typed.payload.operations)
}

const hiddenFromOthers = (session: AuthorizedSession, row: ProposedChangeRow) =>
  row.scope === 'organization' && !row.originConversationId && row.onBehalfOf !== session.userId

async function readableBy(session: AuthorizedSession, row: ProposedChangeRow): Promise<boolean> {
  try {
    await assertReadable(session, row)
    return true
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) return false
    throw error
  }
}

export async function requireReadableProposal(session: AuthorizedSession, id: string): Promise<ProposedChangeRow> {
  const row = await findProposedChange(session.organizationId, id)
  if (!row) throw new NotFoundError()
  await assertReadable(session, row)
  return row
}

async function assertReadable(session: AuthorizedSession, row: ProposedChangeRow): Promise<void> {
  if (row.projectId) await requireProjectAccess(session, row.projectId, 'project:view')
  if (row.originConversationId) {
    await requireResourceAccess(session, 'conversation', row.originConversationId, 'viewer')
  } else if (hiddenFromOthers(session, row) || (await documentsFor(session, row)) === null) {
    throw new NotFoundError()
  }
}

const deciderNeedsWrite = (kind: ProposedChangeKind) =>
  new ForbiddenError('Only someone who may make this change in the project can decide this proposal', {
    reason: 'proposal-decider-needs-write',
    kind,
  })

async function requireDecider(session: AuthorizedSession, row: ProposedChangeRow): Promise<void> {
  if (!row.projectId) {
    if (row.scope === 'organization' && ORGANIZATION_KINDS.has(row.kind)) return
    if (!canManageOfficeShelf(session)) throw deciderNeedsWrite(row.kind)
    return
  }
  if (row.kind === 'office_shelf_norm' && !canManageOfficeShelf(session)) throw deciderNeedsWrite(row.kind)
  try {
    await requireProjectAccess(session, row.projectId, DECIDE_PERMISSIONS[row.kind])
  } catch (error) {
    if (error instanceof NotFoundError) throw deciderNeedsWrite(row.kind)
    throw error
  }
}

async function mayDecide(session: AuthorizedSession, row: ProposedChangeRow): Promise<boolean> {
  try {
    await requireDecider(session, row)
    return true
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) return false
    throw error
  }
}

async function requireTargetsOfOperationReadable(session: AuthorizedSession, row: ProposedChangeRow): Promise<void> {
  if (row.kind !== 'operation') return
  const typed = parseKindPayload(row.kind, row.payload)
  if (typed.kind !== 'operation') return
  const op = findOperation(typed.payload.operation)
  if (!op) return
  try {
    await requireTargetsReadable(session, targetsOf(op, typed.payload.input))
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError || error instanceof TooManyTargetsError) {
      throw new ForbiddenError('This change names something you cannot open, so somebody who can must decide it', {
        reason: 'proposal-decider-cannot-read-target',
      })
    }
    throw error
  }
}

async function readsEveryTarget(session: AuthorizedSession, row: ProposedChangeRow): Promise<boolean> {
  try {
    await requireTargetsOfOperationReadable(session, row)
    return true
  } catch (error) {
    if (error instanceof ForbiddenError) return false
    throw error
  }
}

const alreadyDecided = (row: ProposedChangeRow) =>
  new ConflictError('This proposal has already been decided', { reason: 'proposal-decided', status: row.status })

const beingApplied = () => new ConflictError('This proposal is being applied', { reason: 'proposal-applying' })

function projectOf(row: ProposedChangeRow): string {
  if (!row.projectId) throw new Error(`A ${row.kind} proposal without a project`)
  return row.projectId
}

async function toView(
  session: AuthorizedSession,
  row: ProposedChangeRow,
  decides: (row: ProposedChangeRow) => Promise<boolean> = (candidate) => mayDecide(session, candidate)
): Promise<ProposedChangeView> {
  const directory = await loadOrganizationDirectory(session.organizationId)
  const nameOf = (userId: string | null) => (userId ? (directory.get(userId)?.name ?? null) : null)
  const undecided = row.status === 'proposed' && !claimIsLive(row)
  const base = {
    id: row.id,
    status: row.status,
    proposedByKind: row.proposedByKind,
    onBehalfOf: row.onBehalfOf,
    onBehalfOfName: nameOf(row.onBehalfOf),
    originConversationId: row.originConversationId,
    originMessageId: row.originMessageId,
    createdAt: row.createdAt.toISOString(),
    decidedBy: row.decidedBy,
    decidedByName: nameOf(row.decidedBy),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    results: row.results ?? null,
    canDecide: undecided && (await decides(row)) && (await readsEveryTarget(session, row)),
  }
  const projectId = row.scope === 'project' ? projectOf(row) : row.projectId
  const typed = parseKindPayload(row.kind, row.payload)
  if (typed.kind === 'office_shelf_norm') return { ...base, ...typed, projectId, proposedByKind: 'person' }
  if (typed.kind !== 'operation') return { ...base, ...typed, projectId }
  const op = findOperation(typed.payload.operation)
  const targets = op ? await describeTargets(session, op, typed.payload.input, directory) : []
  return { ...base, ...typed, projectId, targets }
}

export async function getProposal(session: AuthorizedSession, id: string): Promise<ProposedChangeView> {
  return toView(session, await requireReadableProposal(session, id))
}

const outcomeOf = (results: readonly ProposedChangeResult[]) => {
  const applied = results.filter((result) => result.ok).length
  if (applied === results.length) return 'applied' as const
  return applied === 0 ? ('failed' as const) : ('partially_applied' as const)
}

export interface ApplyProposalOptions extends ApplyProposalRequest {
  locale?: Locale
}

export async function applyProposal(
  session: AuthorizedSession,
  id: string,
  request: Request,
  options: ApplyProposalOptions = {}
): Promise<ProposedChangeView> {
  const row = await requireReadableProposal(session, id)
  if (row.status !== 'proposed') throw alreadyDecided(row)
  await requireDecider(session, row)
  await requireTargetsOfOperationReadable(session, row)
  const claim = await claimProposedChange(session.organizationId, id, session.userId, staleBefore())
  if (!claim) {
    const now = await findProposedChange(session.organizationId, id)
    throw now && now.status === 'proposed' ? beingApplied() : alreadyDecided(now ?? row)
  }
  let results: ProposedChangeResult[]
  try {
    results = await applyKind(parseKindPayload(claim.kind, claim.payload), {
      session,
      projectId: claim.projectId,
      request,
      originConversationId: claim.originConversationId,
      locale: options.locale ?? defaultLocale,
      memoryScope: options.memoryScope,
      proposalId: claim.id,
    })
  } catch (error) {
    await releaseProposedChange(session.organizationId, claim)
    throw error
  }
  const settled = await settleProposedChange(session.organizationId, claim, { status: outcomeOf(results), results })
  if (!settled) throw new ConflictError('This proposal was decided while it was being applied', { reason: 'proposal-decided' })
  afterDecision(session, settled)
  return toView(session, settled)
}

export async function dismissProposal(session: AuthorizedSession, id: string): Promise<ProposedChangeView> {
  const row = await requireReadableProposal(session, id)
  if (row.status !== 'proposed') throw alreadyDecided(row)
  await requireDecider(session, row)
  await requireTargetsOfOperationReadable(session, row)
  const dismissed = await dismissProposedChange(session.organizationId, id, session.userId, staleBefore())
  if (!dismissed) {
    const now = await findProposedChange(session.organizationId, id)
    throw now && now.status === 'proposed' ? beingApplied() : alreadyDecided(now ?? row)
  }
  afterDecision(session, dismissed)
  return toView(session, dismissed)
}

export async function listOpenProposals(session: AuthorizedSession, query: ParsedProposalListQuery): Promise<ProposalListResponse> {
  const shelf: ProposalShelf = query.projectId
    ? { scope: 'project', projectId: query.projectId }
    : { scope: query.shelf === 'organization' ? 'organization' : 'office_shelf' }
  if (shelf.scope === 'project') await requireProjectAccess(session, shelf.projectId, 'project:view')
  const rows = await listShelfProposals(session.organizationId, shelf, {
    statuses: ['proposed'],
    kind: query.kind,
    after: query.cursor,
    limit: query.limit + 1,
  })
  const hasMore = rows.length > query.limit
  const page = hasMore ? rows.slice(0, query.limit) : rows
  const decidesByKind = new Map<ProposedChangeKind, Promise<boolean>>()
  const decides = (row: ProposedChangeRow): Promise<boolean> => {
    let pending = decidesByKind.get(row.kind)
    if (!pending) {
      pending = mayDecide(session, row)
      decidesByKind.set(row.kind, pending)
    }
    return pending
  }
  const listed = await Promise.all(
    page.map(async (row): Promise<ListedProposal | null> => {
      if (row.originConversationId && !(await readableBy(session, row))) return null
      if (hiddenFromOthers(session, row)) return null
      const documents = await documentsFor(session, row)
      if (documents === null) return null
      return { proposal: await toView(session, row, decides), documents }
    })
  )
  return {
    proposals: listed.filter((entry): entry is ListedProposal => entry !== null),
    nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
  }
}

export interface ShelfProposalRecord {
  id: string
  status: ProposedChangeStatus
  typed: KindPayload
  originConversationId: string | null
  claimed: boolean
}

export async function listShelfFileProposals(
  organizationId: string,
  shelf: ProposalShelf
): Promise<ShelfProposalRecord[]> {
  const rows = await listShelfProposals(organizationId, shelf, {
    statuses: ['proposed', 'dismissed'],
    kind: 'file_operation',
    limit: 500,
  })
  return rows.flatMap((row) => {
    try {
      return [
        {
          id: row.id,
          status: row.status,
          typed: parseKindPayload(row.kind, row.payload),
          originConversationId: row.originConversationId,
          claimed: claimIsLive(row),
        },
      ]
    } catch {
      return []
    }
  })
}

export async function withdrawProposal(organizationId: string, id: string): Promise<boolean> {
  const withdrawn = await deleteUndecidedProposedChange(organizationId, id, staleBefore())
  if (withdrawn) bestEffort('attention (withdrawn)', () => onProposalDecided({ organizationId, proposalId: id }))
  return withdrawn
}
