import 'server-only'
import { captureServer } from '@/lib/analytics/posthog-server'
import { ApiError, BadRequestError, ForbiddenError, NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { filterUsersWithProjectAccess } from '@/lib/authz/project-membership'
import { PRODUCT_NAME } from '@/lib/brand'
import type { MentionRequest } from '@/lib/db/schema/mention-requests'
import type { ShareableResourceType } from '@/lib/db/schema/resource-shares'
import { publishToUsers } from '@/lib/events/bus'
import { inboxGroupKey } from '@/lib/inbox/registry'
import {
  emitInboxItems,
  resolveInboxItemsFor,
  type InboxResolutionTarget,
} from '@/lib/inbox/service'
import { requireResourceAccess, type ResourceAccess } from '@/lib/sharing/access'
import { loadOrganizationDirectory, unknownPerson } from '@/lib/sharing/directory'
import { describeResource, roleSatisfies } from '@/lib/sharing/registry'
import { consumeLimit, MAX_MENTIONS_PER_MESSAGE, memberSubject, MENTION_LIMIT } from '@/lib/limits'
import { grantResourceAccess, resolveParticipants } from '@/lib/sharing/service'
import { SHARING_ERROR_REASONS, type DirectoryPerson, type ShareCandidate } from '@/lib/sharing/types'
import {
  findRequestById,
  insertMentionRequests,
  listOpenRequestsForResource,
  listOpenRequestsForSubject,
  resolveRequests,
  voidOpenRequestsForResource,
  voidOpenRequestsForSubject,
} from './repository'
import { LEGACY_AGENT_MENTION_ID } from './legacy-mention-ids'
import {
  isAgentMentionId,
  MENTION_ERROR_REASONS,
  type AddresseeSet,
  type AwaitingStateResponse,
  type MentionCandidate,
  type MentionCandidatesResponse,
  type MentionInput,
  type PendingMentionView,
} from './types'

const INBOX_TEXT_LIMIT = 280

class MentionRateLimitedError extends ForbiddenError {
  constructor(message: string) {
    super(message)
    Object.assign(this, { details: { reason: MENTION_ERROR_REASONS.rateLimited } })
  }
}

export async function voidRequestsForSubject(
  resourceType: ShareableResourceType,
  resourceId: string,
  subjectUserId: string,
): Promise<number> {
  const voided = await voidOpenRequestsForSubject(resourceType, resourceId, subjectUserId)
  if (voided.length === 0) return 0

  await resolveInboxItemsFor(requestedInboxTargets(voided))
  return voided.length
}

export async function voidRequestsForResource(
  resourceType: ShareableResourceType,
  resourceId: string,
): Promise<number> {
  const voided = await voidOpenRequestsForResource(resourceType, resourceId)
  if (voided.length === 0) return 0

  await resolveInboxItemsFor(requestedInboxTargets(voided))
  return voided.length
}

export interface ApplyMessageMentionsInput {
  session: AuthorizedSession
  resourceType: ShareableResourceType
  resourceId: string
  anchorId: string
  mentions: MentionInput[]
  note?: string | null
  excerpt?: string | null
}

export interface ApplyMessageMentionsResult {
  addressees: AddresseeSet
  createdRequests: number
  awaitingUserIds: string[]
}

export async function applyMessageMentions(
  input: ApplyMessageMentionsInput,
): Promise<ApplyMessageMentionsResult> {
  const { session, resourceType, resourceId, anchorId } = input

  const targets = [...new Set(input.mentions.map((mention) => mention.targetId).filter(Boolean))]
  const agentMentioned = targets.some(isAgentMentionId)
  const humanTargets = targets.filter(
    (targetId) => !isAgentMentionId(targetId) && targetId !== session.userId,
  )

  if (targets.length === 0) {
    return { addressees: { agent: true, users: [] }, createdRequests: 0, awaitingUserIds: [] }
  }

  if (!describeResource(resourceType).supportsMentions) {
    throw new BadRequestError('Mentions are not available on this resource')
  }

  await enforceMentionBounds(session, targets.length)

  const access = await requireResourceAccess(session, resourceType, resourceId, 'collaborator')

  const [directory, participants] = await Promise.all([
    loadOrganizationDirectory(session.organizationId),
    resolveParticipants(session.organizationId, resourceType, resourceId),
  ])
  const participantSet = new Set(participants)

  const resolvable = humanTargets.filter((targetId) => directory.has(targetId))

  const reachable = await resolveReachableTargets(session, access, resolvable)

  const addressed: string[] = []
  const toInvite: string[] = []
  for (const targetId of resolvable) {
    if (!reachable.has(targetId)) throw containerAccessRefusal(targetId)

    if (participantSet.has(targetId)) {
      addressed.push(targetId)
      continue
    }

    if (!roleSatisfies(access.role, 'owner')) {
      throw new BadRequestError(
        'You can only mention people who are already in this conversation. Ask an owner to invite them.',
        { reason: MENTION_ERROR_REASONS.inviteRequiresOwner, targetId },
      )
    }
    addressed.push(targetId)
    toInvite.push(targetId)
  }

  const addressees: AddresseeSet = {
    agent: agentMentioned || addressed.length === 0,
    users: addressed,
  }

  for (const targetId of toInvite) {
    await inviteMentionTarget(session, resourceType, resourceId, targetId)
  }

  const supersededByAgent = agentMentioned
    ? await releaseOpenRequests(await listOpenRequestsForResource(resourceType, resourceId), session.userId)
    : 0

  const created =
    addressed.length > 0
      ? await insertMentionRequests(
          addressed.map((requestedOf) => ({
            organizationId: session.organizationId,
            resourceType,
            resourceId,
            anchorId,
            requestedBy: session.userId,
            requestedOf,
            note: truncate(input.note),
          })),
        )
      : []

  if (created.length > 0) {
    await notifyMentionRecipients(session, resourceType, resourceId, anchorId, created, input)
  }

  if (created.length === 0 && supersededByAgent === 0) {
    return { addressees, createdRequests: 0, awaitingUserIds: [] }
  }

  const awaitingUserIds = await publishAwaiting(session.organizationId, resourceType, resourceId)
  return { addressees, createdRequests: created.length, awaitingUserIds }
}

export async function enforceMentionBounds(session: AuthorizedSession, count: number): Promise<void> {
  if (count > MAX_MENTIONS_PER_MESSAGE) {
    throw new MentionRateLimitedError(
      `A message may mention at most ${MAX_MENTIONS_PER_MESSAGE} people.`,
    )
  }

  const limit = await consumeLimit(MENTION_LIMIT, memberSubject(session), count)
  if (!limit.allowed) {
    throw new MentionRateLimitedError('Too many mentions. Please wait a while before mentioning more people.')
  }
}

async function resolveReachableTargets(
  session: AuthorizedSession,
  access: ResourceAccess,
  targetIds: readonly string[],
): Promise<Set<string>> {
  const projectId = access.container.projectId
  if (!projectId || targetIds.length === 0) return new Set(targetIds)
  return filterUsersWithProjectAccess(session, projectId, targetIds)
}

function containerAccessRefusal(targetId: string): BadRequestError {
  return new BadRequestError(
    'That person cannot see this project yet. Add them to the project first — mentioning someone is never a back door into it.',
    { reason: MENTION_ERROR_REASONS.containerAccessRequired, targetId },
  )
}

async function inviteMentionTarget(
  session: AuthorizedSession,
  resourceType: ShareableResourceType,
  resourceId: string,
  targetId: string,
): Promise<void> {
  try {
    await grantResourceAccess(session, resourceType, resourceId, {
      subjectUserId: targetId,
      role: 'collaborator',
    })
  } catch (error) {
    const reason = errorReason(error)
    if (reason === MENTION_ERROR_REASONS.containerAccessRequired) {
      throw containerAccessRefusal(targetId)
    }
    const namesPerson =
      reason === SHARING_ERROR_REASONS.restrictedContent || reason === SHARING_ERROR_REASONS.crossProjectContent
    if (namesPerson && error instanceof ApiError) {
      throw new ApiError(error.status, error.code, error.message, { ...asRecord(error.details), targetId })
    }
    throw error
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function errorReason(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null
  const details = error.details
  if (!details || typeof details !== 'object') return null
  const reason = (details as { reason?: unknown }).reason
  return typeof reason === 'string' ? reason : null
}

async function notifyMentionRecipients(
  session: AuthorizedSession,
  resourceType: ShareableResourceType,
  resourceId: string,
  anchorId: string,
  created: MentionRequest[],
  input: Pick<ApplyMessageMentionsInput, 'note' | 'excerpt'>,
): Promise<void> {
  const subject = await resolveSubjectLine(resourceType, resourceId, session.organizationId)
  const excerpt = truncate(input.note ?? input.excerpt)

  await emitInboxItems(
    created.map((request) => ({
      organizationId: session.organizationId,
      recipientUserId: request.requestedOf,
      type: 'mention.requested' as const,
      resourceType,
      resourceId,
      anchorId,
      actorUserId: session.userId,
      groupKey: inboxGroupKey('mention.requested', resourceType, resourceId, anchorId),
      payload: { subject, excerpt },
    })),
  )
}

export interface ResolveRequestsOnReplyInput {
  organizationId: string
  resourceType: ShareableResourceType
  resourceId: string
  authorUserId: string
  addressedUserIds?: readonly string[]
}

export async function resolveRequestsOnReply(
  input: ResolveRequestsOnReplyInput,
): Promise<{ answered: number; askedBack: number; askerUserIds: string[] }> {
  const { organizationId, resourceType, resourceId, authorUserId, addressedUserIds } = input
  const none = { answered: 0, askedBack: 0, askerUserIds: [] as string[] }

  const open = await listOpenRequestsForSubject(resourceType, resourceId, authorUserId)
  if (open.length === 0) return none

  const addressed = new Set(addressedUserIds ?? [])
  const askedBack = open.filter((request) => addressed.has(request.requestedBy))
  const answered = open.filter((request) => !addressed.has(request.requestedBy))

  const closedAskedBack =
    askedBack.length > 0
      ? await resolveRequests(
          askedBack.map((request) => request.id),
          'asked_back',
          authorUserId,
        )
      : []
  const closedAnswered =
    answered.length > 0
      ? await resolveRequests(
          answered.map((request) => request.id),
          'answered',
          authorUserId,
        )
      : []
  const closed = [...closedAskedBack, ...closedAnswered]
  if (closed.length === 0) return none

  await resolveInboxItemsFor(requestedInboxTargets(closed))

  const askerUserIds = [...new Set(closed.map((request) => request.requestedBy))]
  if (closedAnswered.length > 0) {
    const subject = await resolveSubjectLine(resourceType, resourceId, organizationId)
    await emitInboxItems(
      closedAnswered.map((request) => ({
        organizationId,
        recipientUserId: request.requestedBy,
        type: 'mention.answered' as const,
        resourceType,
        resourceId,
        anchorId: request.anchorId,
        actorUserId: authorUserId,
        groupKey: answeredGroupKey(request),
        payload: { subject, excerpt: request.note },
      })),
    )
  }

  await publishAwaiting(organizationId, resourceType, resourceId)
  return { answered: closedAnswered.length, askedBack: closedAskedBack.length, askerUserIds }
}

export async function releaseRequest(
  session: AuthorizedSession,
  requestId: string,
): Promise<AwaitingStateResponse> {
  const request = await findRequestById(requestId)
  if (!request || request.organizationId !== session.organizationId) throw new NotFoundError()

  const resourceType = request.resourceType
  await requireResourceAccess(session, resourceType, request.resourceId, 'collaborator')

  const released = await releaseOpenRequests([request], session.userId)
  if (released > 0) {
    captureServer({
      event: 'mention_released',
      distinctId: session.userId,
      organizationId: session.organizationId,
      properties: { resource_type: resourceType },
    })
    await publishAwaiting(session.organizationId, resourceType, request.resourceId)
  }

  return buildAwaitingState(session, resourceType, request.resourceId)
}

async function releaseOpenRequests(requests: MentionRequest[], resolvedBy: string): Promise<number> {
  if (requests.length === 0) return 0
  const closed = await resolveRequests(
    requests.map((request) => request.id),
    'released',
    resolvedBy,
  )
  if (closed.length === 0) return 0
  await resolveInboxItemsFor(requestedInboxTargets(closed))
  return closed.length
}

export async function getAwaitingState(
  session: AuthorizedSession,
  conversationId: string,
): Promise<AwaitingStateResponse> {
  await requireResourceAccess(session, 'conversation', conversationId, 'viewer')
  return buildAwaitingState(session, 'conversation', conversationId)
}

async function buildAwaitingState(
  session: AuthorizedSession,
  resourceType: ShareableResourceType,
  resourceId: string,
): Promise<AwaitingStateResponse> {
  const open = await listOpenRequestsForResource(resourceType, resourceId)
  if (open.length === 0) return { pending: [], awaitingMe: false }

  const directory = await loadOrganizationDirectory(session.organizationId)
  const pending: PendingMentionView[] = open.map((request) => ({
    id: request.id,
    person: directory.get(request.requestedOf) ?? unknownPerson(request.requestedOf),
    requestedBy: directory.get(request.requestedBy) ?? null,
    note: request.note,
    anchorId: request.anchorId,
    createdAt: request.createdAt.toISOString(),
  }))

  return {
    pending,
    awaitingMe: open.some((request) => request.requestedOf === session.userId),
  }
}

export async function listMentionCandidates(
  session: AuthorizedSession,
  conversationId: string,
): Promise<MentionCandidatesResponse> {
  const roster = await loadCandidateRoster(session, 'conversation', conversationId, 'collaborator')
  const canInvite = roleSatisfies(roster.access.role, 'owner')

  const candidates: MentionCandidate[] = [
    {
      targetId: LEGACY_AGENT_MENTION_ID,
      person: {
        userId: LEGACY_AGENT_MENTION_ID,
        email: null,
        name: PRODUCT_NAME,
        profilePictureUrl: null,
      },
      isAgent: true,
      isParticipant: true,
      needsInvite: false,
    },
  ]

  for (const person of roster.people) {
    candidates.push({
      targetId: person.userId,
      person,
      isAgent: false,
      isParticipant: roster.participants.has(person.userId),
      needsInvite: !roster.participants.has(person.userId),
    })
  }

  return { candidates, canInvite }
}

export async function listShareCandidates(
  session: AuthorizedSession,
  resourceType: ShareableResourceType,
  resourceId: string,
): Promise<ShareCandidate[]> {
  const roster = await loadCandidateRoster(session, resourceType, resourceId, 'owner', {
    includeUnreachable: true,
  })
  const lacking = await lackingContentAccess(session, resourceType, resourceId, roster)

  return roster.people.map((person) => ({
    person,
    alreadyHasAccess: roster.participants.has(person.userId),
    needsProjectAccess: !roster.reachable.has(person.userId),
    ...(lacking ? { lacksFolderAccess: lacking.has(person.userId) } : {}),
  }))
}

async function lackingContentAccess(
  session: AuthorizedSession,
  resourceType: ShareableResourceType,
  resourceId: string,
  roster: CandidateRoster,
): Promise<ReadonlySet<string> | null> {
  const readersAmong = describeResource(resourceType).readersAmong
  if (!readersAmong) return null
  const inviteable = roster.people
    .map((person) => person.userId)
    .filter((userId) => roster.reachable.has(userId) && !roster.participants.has(userId))
  const readers = await readersAmong(session.organizationId, resourceId, inviteable, session)
  return new Set(inviteable.filter((userId) => !readers.has(userId)))
}

interface CandidateRoster {
  access: ResourceAccess
  people: DirectoryPerson[]
  participants: Set<string>
  reachable: Set<string>
}

async function loadCandidateRoster(
  session: AuthorizedSession,
  resourceType: ShareableResourceType,
  resourceId: string,
  minimum: 'collaborator' | 'owner',
  options: { includeUnreachable?: boolean } = {},
): Promise<CandidateRoster> {
  const access = await requireResourceAccess(session, resourceType, resourceId, minimum)
  const [directory, participants] = await Promise.all([
    loadOrganizationDirectory(session.organizationId),
    resolveParticipants(session.organizationId, resourceType, resourceId),
  ])

  const participantSet = new Set(participants)
  const others = [...directory.values()].filter((person) => person.userId !== session.userId)

  const reachable = await resolveReachableTargets(
    session,
    access,
    others.map((person) => person.userId),
  )

  const visible = options.includeUnreachable
    ? others
    : others.filter((person) => reachable.has(person.userId))

  visible.sort((a, b) => {
    const aParticipant = participantSet.has(a.userId) ? 0 : 1
    const bParticipant = participantSet.has(b.userId) ? 0 : 1
    if (aParticipant !== bParticipant) return aParticipant - bParticipant
    return a.name.localeCompare(b.name)
  })

  return { access, people: visible, participants: participantSet, reachable }
}

async function publishAwaiting(
  organizationId: string,
  resourceType: ShareableResourceType,
  resourceId: string,
): Promise<string[]> {
  const open = await listOpenRequestsForResource(resourceType, resourceId)
  const awaitingUserIds = [...new Set(open.map((request) => request.requestedOf))]
  const participants = await resolveParticipants(organizationId, resourceType, resourceId)
  await publishToUsers([...participants, ...awaitingUserIds], {
    kind: 'conversation.awaiting',
    conversationId: resourceId,
    awaitingUserIds,
  })
  return awaitingUserIds
}

function requestedInboxTargets(requests: MentionRequest[]): InboxResolutionTarget[] {
  return requests
    .filter((request) => request.anchorId)
    .map((request) => ({
      organizationId: request.organizationId,
      recipientUserId: request.requestedOf,
      groupKey: inboxGroupKey(
        'mention.requested',
        request.resourceType,
        request.resourceId,
        request.anchorId,
      ),
    }))
}

function answeredGroupKey(request: MentionRequest): string {
  return inboxGroupKey(
    'mention.answered',
    request.resourceType,
    request.resourceId,
    request.anchorId ?? request.id,
  )
}

async function resolveSubjectLine(
  resourceType: ShareableResourceType,
  resourceId: string,
  organizationId: string,
): Promise<string | null> {
  const ref = await describeResource(resourceType).describeRef(resourceId, organizationId)
  return ref?.title ?? null
}

function truncate(text: string | null | undefined): string | null {
  if (!text) return null
  const trimmed = text.trim()
  if (trimmed.length === 0) return null
  return trimmed.length > INBOX_TEXT_LIMIT ? `${trimmed.slice(0, INBOX_TEXT_LIMIT - 1)}…` : trimmed
}

export async function threadIsAwaitingHuman(
  resourceType: ShareableResourceType,
  resourceId: string,
): Promise<boolean> {
  const open = await listOpenRequestsForResource(resourceType, resourceId)
  return open.length > 0
}
