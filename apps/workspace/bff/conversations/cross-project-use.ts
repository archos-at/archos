import 'server-only'
import { CrossProjectAudienceChangedError, CrossProjectMemoryError } from '@/lib/api/errors'
import { errorsCopy } from '@/i18n/namespaces/errors'
import { getDb } from '@/lib/db'
import { AGENT_REFUSAL_LOCALE } from './restricted-egress'
import { isUuid } from '@/lib/ids'
import { recordedForeignRestrictedFolders } from './restricted-use'
import {
  listProjectNames,
  listRestrictingSourceProjects,
  lockConversationAudience,
  markAnswerRestrictedUse,
  readConversationAudience,
  recordSourceFolders,
  recordSourceProjects,
  type ConversationAudienceRow,
} from './restricted-use-repository'

export function isSoloAudience(audience: ConversationAudienceRow, userId: string): boolean {
  if (!audience.exists) return true
  if (audience.visibility !== 'private' || audience.createdBy !== userId) return false
  return audience.grantees.every((grantee) => grantee === userId)
}

export function audienceKey(audience: ConversationAudienceRow): string {
  if (!audience.exists) return 'new'
  return [audience.visibility, audience.createdBy ?? '', ...[...audience.grantees].sort()].join('|')
}

export function audienceChangedRefusal(): CrossProjectAudienceChangedError {
  return new CrossProjectAudienceChangedError(errorsCopy.messages[AGENT_REFUSAL_LOCALE].crossProject.audienceChanged)
}

export interface HandOutParty {
  organizationId: string
  userId: string
  conversationId: string
  answerMessageId?: string | null
}

export interface CrossProjectHandOut {
  projectIds: readonly string[]
  folderIds: readonly string[]
}

export async function recordCrossProjectHandOut(
  party: HandOutParty,
  handOut: CrossProjectHandOut,
  searchedFor: string
): Promise<void> {
  const { organizationId, conversationId } = party
  const unchanged = await getDb().transaction(async (tx) => {
    await lockConversationAudience(tx, organizationId, conversationId)
    const audience = await readConversationAudience(tx, organizationId, conversationId)
    const now = audienceKey(audience)
    if (now !== searchedFor && !(searchedFor === 'new' && isSoloAudience(audience, party.userId))) return false
    await recordSourceProjects(tx, organizationId, conversationId, [...new Set(handOut.projectIds)])
    await recordSourceFolders(tx, organizationId, conversationId, [...new Set(handOut.folderIds)])
    if (party.answerMessageId) {
      await markAnswerRestrictedUse(tx, organizationId, conversationId, party.answerMessageId)
    }
    return true
  })
  if (!unchanged) throw audienceChangedRefusal()
}

export async function drewOnOtherProjects(conversationId: string, organizationId: string): Promise<boolean> {
  const db = getDb()
  const [projects, folders] = await Promise.all([
    listRestrictingSourceProjects(db, organizationId, conversationId),
    recordedForeignRestrictedFolders(conversationId, organizationId),
  ])
  return projects.length > 0 || folders.size > 0
}

export interface RestrictingOtherProject {
  id: string
  name: string | null
}

export async function restrictingOtherProjects(
  conversationId: string,
  organizationId: string
): Promise<RestrictingOtherProject[]> {
  const db = getDb()
  const [recorded, folders] = await Promise.all([
    listRestrictingSourceProjects(db, organizationId, conversationId),
    recordedForeignRestrictedFolders(conversationId, organizationId),
  ])
  const owners = [...folders].map(([folderId, owner]) => owner ?? folderId)
  const ids = [...new Set([...recorded, ...owners])]
  const names = await listProjectNames(db, organizationId, ids.filter(isUuid))
  return ids
    .map((id) => ({ id, name: names.get(id) ?? null }))
    .sort((a, b) => (a.name ?? '\uffff').localeCompare(b.name ?? '\uffff') || a.id.localeCompare(b.id))
}

export async function requireMayRememberFrom(
  conversationId: string | null | undefined,
  organizationId: string | null | undefined
): Promise<void> {
  if (!conversationId || !organizationId) return
  if (!(await drewOnOtherProjects(conversationId, organizationId))) return
  throw new CrossProjectMemoryError(errorsCopy.messages[AGENT_REFUSAL_LOCALE].crossProject.memory)
}
