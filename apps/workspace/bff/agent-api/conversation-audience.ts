import 'server-only'

import { listProjectFolderTree } from '@/lib/authz/folder-access-repository'
import { folderTree, getHiddenFolderIds, readableByEveryMember, readRestrictingFoldersOnPath } from '@/lib/authz/folder-access'
import { CrossProjectAudienceChangedError } from '@/lib/api/errors'
import {
  audienceKey,
  drewOnOtherProjects,
  isSoloAudience,
  recordCrossProjectHandOut,
  type CrossProjectHandOut,
} from '@/lib/conversations/cross-project-use'
import { readConversationAudience, type ConversationAudienceRow } from '@/lib/conversations/restricted-use-repository'
import { audienceReachAmong } from '@/lib/cross-project/audience-reach'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import type { AgentOperation } from './operation'
import {
  type OperationTarget,
  type TargetInput,
  TooManyTargetsError,
  namesUntypedResource,
  placesOf,
  targetsOf,
} from './operation-targets'
import type { TargetPlace } from './operation-targets-repository'
import type { AgentPrincipal } from './principal'
import { PRODUCT_NAME } from '@/lib/brand'

export interface ConversationAudience {
  row: ConversationAudienceRow
  solo: boolean
  key: string
}

export type ReadCarries = 'document' | 'projectFacts'

const CARRIED_TARGET: Readonly<Record<ReadCarries, OperationTarget['type']>> = {
  document: 'document',
  projectFacts: 'project',
}

const tenantOf = (principal: AgentPrincipal) => ({
  organizationId: principal.session.organizationId,
  userId: principal.session.userId,
})

export async function conversationAudienceOf(principal: AgentPrincipal): Promise<ConversationAudience | null> {
  const conversationId = principal.conversationId
  if (principal.actor !== 'piloti' || !conversationId) return null
  const row = await withTenant(tenantOf(principal), () =>
    readConversationAudience(getDb(), principal.session.organizationId, conversationId)
  )
  return { row, solo: isSoloAudience(row, principal.session.userId), key: audienceKey(row) }
}

export const READ_REFUSALS = {
  shared:
    'This conversation is shared, and that read answers with what the person may see, not with what everyone in ' +
    'the conversation may: in a shared conversation ' + PRODUCT_NAME + ' reads only a document or a project\'s facts, of a project ' +
    'every reader may open. Tell the person to open it themselves, or to ask in a conversation that is theirs alone.',
  outsideReach:
    'That belongs to a project outside what this conversation may read from: the projects the person may chat in ' +
    'when the conversation is theirs alone; when it is shared, the closed projects and those every reader may open. ' +
    'Tell the person to open it themselves, or to ask in a conversation that is theirs alone.',
  restrictedFolder:
    'That sits in a folder with its own access list, and this conversation is shared, so ' + PRODUCT_NAME + ' does not read it ' +
    'here: not every reader was asked whether they may read that folder. Tell the person to open it themselves, or ' +
    'to ask in a conversation that is theirs alone.',
  notEveryReader:
    'Not everyone who reads this shared conversation may read that (a file still being screened, a file of another ' +
    'conversation, or one outside every project), so ' + PRODUCT_NAME + ' does not read it here. Tell the person to open it themselves.',
  otherConversation:
    'That conversation drew on other projects, so ' + PRODUCT_NAME + ' does not read it here: their content would land in this ' +
    'conversation without the record that keeps it to their readers. Tell the person to open it themselves.',
  spansProjects:
    'That read reaches across the office\'s projects, so ' + PRODUCT_NAME + ' does not run it in this project\'s conversation: ' +
    'it answers with every project the person sees, not with what this conversation may read. Narrow it to one ' +
    'project where the operation allows, or tell the person to open it themselves.',
  unknown:
    PRODUCT_NAME + ' cannot tell where that lives, so it does not read it here: what it does not find, it cannot hold to ' +
    'this conversation\'s rules for who may read it. Check the id, or tell the person to open it themselves.',
  tooMany:
    'The call names too many projects, documents, folders or conversations to check. Narrow it and call again.',
  proposalOutsideReach:
    'This conversation is shared, and that change names a project not everyone who reads it may open: its card, ' +
    'and what the change returns, would sit here. Tell the person to make the change in ' + PRODUCT_NAME + ' themselves, or to ' +
    'ask in a conversation that is theirs alone.',
  audienceChanged:
    'Who reads this conversation changed while ' + PRODUCT_NAME + ' was reading, so nothing was read. Call again: the read is ' +
    'judged against the readers the conversation has now.',
} as const

export type ReadJudgement = { refusal: string } | { handOut: CrossProjectHandOut }

const refuse = (refusal: string): ReadJudgement => ({ refusal })

function namedTargets(
  principal: AgentPrincipal,
  op: Pick<AgentOperation, 'path' | 'spansProjects'>,
  input: TargetInput,
): OperationTarget[] | string {
  const turnProject = principal.projectId ?? null
  if (op.spansProjects === 'always' && turnProject) return READ_REFUSALS.spansProjects
  let targets: OperationTarget[]
  try {
    targets = targetsOf(op, input)
  } catch (error) {
    if (error instanceof TooManyTargetsError) return READ_REFUSALS.tooMany
    throw error
  }
  if (namesUntypedResource(input)) return READ_REFUSALS.unknown
  const namesProject = targets.some((target) => target.type === 'project')
  if (op.spansProjects === 'unlessScoped' && turnProject && !namesProject) return READ_REFUSALS.spansProjects
  return targets
}

interface ForeignPlace {
  target: OperationTarget
  place: TargetPlace & { projectId: string }
}

export async function judgeWorkspaceRead(
  principal: AgentPrincipal,
  audience: ConversationAudience,
  op: Pick<AgentOperation, 'path' | 'spansProjects'> | null,
  input: TargetInput,
  carries: ReadCarries | undefined,
  ownFolders: () => Promise<string[]>,
): Promise<ReadJudgement> {
  if (!audience.solo && (!op || !carries)) return refuse(READ_REFUSALS.shared)
  const targets = op ? namedTargets(principal, op, input) : []
  if (typeof targets === 'string') return refuse(targets)
  if (!audience.solo && targets.some((target) => target.type !== CARRIED_TARGET[carries as ReadCarries])) {
    return refuse(READ_REFUSALS.shared)
  }
  const { organizationId, userId } = principal.session
  return withTenant(tenantOf(principal), async () => {
    const places = await placesOf(organizationId, userId, targets)
    let touchesOwn = targets.length === 0
    const foreign: ForeignPlace[] = []
    for (const [index, place] of places.entries()) {
      const target = targets[index] as OperationTarget
      if (!place) {
        if (target.type === 'conversation' && target.id === principal.conversationId) {
          touchesOwn = true
          continue
        }
        return refuse(READ_REFUSALS.unknown)
      }
      const refused = await placeRefusal(principal, audience, place, organizationId)
      if (refused) return refuse(refused)
      const own = place.conversationId === principal.conversationId || place.projectId === (principal.projectId ?? null)
      if (own || !place.projectId) {
        touchesOwn = true
        if (!audience.solo) {
          const shut = await sharedOwnRefusal(organizationId, place, carries)
          if (shut) return refuse(shut)
        }
        continue
      }
      foreign.push({ target, place: { ...place, projectId: place.projectId } })
    }
    const handOut = await foreignHandOut(principal, audience, foreign, carries)
    if ('refusal' in handOut) return handOut
    const own = audience.solo && touchesOwn && principal.projectId ? await ownFolders() : []
    return {
      handOut: { projectIds: handOut.handOut.projectIds, folderIds: [...own, ...handOut.handOut.folderIds] },
    }
  })
}

async function placeRefusal(
  principal: AgentPrincipal,
  audience: ConversationAudience,
  place: TargetPlace,
  organizationId: string,
): Promise<string | null> {
  const other = place.conversationId !== null && place.conversationId !== principal.conversationId
  if (!other) return null
  if (!audience.solo) return READ_REFUSALS.notEveryReader
  return (await drewOnOtherProjects(place.conversationId as string, organizationId)) ? READ_REFUSALS.otherConversation : null
}

async function sharedOwnRefusal(
  organizationId: string,
  place: TargetPlace,
  carries: ReadCarries | undefined,
): Promise<string | null> {
  if (!place.projectId) return READ_REFUSALS.notEveryReader
  if (carries !== 'document' || !place.document) return null
  if (!place.document.passedScreening) return READ_REFUSALS.notEveryReader
  const path = await restrictingPathOf(organizationId, place.projectId, place.document.folderId)
  return path.length > 0 ? READ_REFUSALS.restrictedFolder : null
}

async function restrictingPathOf(organizationId: string, projectId: string, folderId: string | null): Promise<string[]> {
  if (!folderId) return []
  return readRestrictingFoldersOnPath(folderTree(await listProjectFolderTree(organizationId, projectId)), folderId)
}

async function foreignHandOut(
  principal: AgentPrincipal,
  audience: ConversationAudience,
  foreign: readonly ForeignPlace[],
  carries: ReadCarries | undefined,
): Promise<ReadJudgement> {
  if (foreign.length === 0) return { handOut: { projectIds: [], folderIds: [] } }
  const projectIds = [...new Set(foreign.map(({ place }) => place.projectId))]
  const reach = await audienceReachAmong(principal.session, audience.row, projectIds)
  const inReach = new Set(reach.projects.map((project) => project.id))
  if (projectIds.some((projectId) => !inReach.has(projectId))) return refuse(READ_REFUSALS.outsideReach)
  const folderIds: string[] = []
  for (const { target, place } of foreign) {
    if (!reach.restrictedFolders && place.document && !place.document.passedScreening) {
      return refuse(READ_REFUSALS.notEveryReader)
    }
    const carried = await carriedFolders(principal, place, target, carries)
    if (carried.length > 0 && !reach.restrictedFolders) return refuse(READ_REFUSALS.restrictedFolder)
    folderIds.push(...carried)
  }
  return { handOut: { projectIds, folderIds } }
}

async function carriedFolders(
  principal: AgentPrincipal,
  place: ForeignPlace['place'],
  target: OperationTarget,
  carries: ReadCarries | undefined,
): Promise<string[]> {
  if (carries === 'projectFacts' && target.type === 'project') return []
  if (carries === 'document' && target.type === 'document' && place.document) {
    return restrictingPathOf(principal.session.organizationId, place.projectId, place.document.folderId)
  }
  return restrictingFolders(principal.session, place.projectId)
}

async function restrictingFolders(session: AgentPrincipal['session'], projectId: string): Promise<string[]> {
  const [rows, hidden] = await Promise.all([
    listProjectFolderTree(session.organizationId, projectId),
    getHiddenFolderIds(session, projectId),
  ])
  const tree = folderTree(rows)
  const unseen = new Set(hidden)
  return [...tree.keys()].filter((folderId) => !readableByEveryMember(tree, folderId) && !unseen.has(folderId))
}

export async function ownRestrictingFolders(principal: AgentPrincipal): Promise<string[]> {
  if (!principal.projectId) return []
  const projectId = principal.projectId
  return withTenant(tenantOf(principal), () => restrictingFolders(principal.session, projectId))
}

export async function recordWorkspaceHandOut(
  principal: AgentPrincipal,
  audience: ConversationAudience,
  handOut: CrossProjectHandOut,
): Promise<boolean> {
  const conversationId = principal.conversationId
  if (!conversationId) return true
  const party = {
    organizationId: principal.session.organizationId,
    userId: principal.session.userId,
    conversationId,
    answerMessageId: principal.answerMessageId ?? null,
  }
  try {
    await withTenant(tenantOf(principal), () => recordCrossProjectHandOut(party, handOut, audience.key))
    return true
  } catch (error) {
    if (error instanceof CrossProjectAudienceChangedError) return false
    throw error
  }
}

export async function proposalReachRefusal(
  party: { session: AgentPrincipal['session']; conversationId?: string | null; projectId?: string | null },
  targets: readonly OperationTarget[],
): Promise<string | null> {
  const { conversationId } = party
  if (!conversationId || targets.length === 0) return null
  const { organizationId, userId } = party.session
  const row = await readConversationAudience(getDb(), organizationId, conversationId)
  if (isSoloAudience(row, userId)) return null
  const places = await placesOf(organizationId, userId, targets)
  const own = party.projectId ?? row.projectId ?? null
  const projectIds = [
    ...new Set(places.flatMap((place) => (place?.projectId && place.projectId !== own ? [place.projectId] : []))),
  ]
  if (projectIds.length === 0) return null
  const reach = await audienceReachAmong(party.session, row, projectIds)
  const inReach = new Set(reach.projects.map((project) => project.id))
  return projectIds.every((projectId) => inReach.has(projectId)) ? null : READ_REFUSALS.proposalOutsideReach
}
