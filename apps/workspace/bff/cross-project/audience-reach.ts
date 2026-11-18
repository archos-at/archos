import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import { userHoldsProjectPermission } from '@/lib/authz/project-membership'
import { audienceKey, isSoloAudience } from '@/lib/conversations/cross-project-use'
import { readConversationAudience, type ConversationAudienceRow } from '@/lib/conversations/restricted-use-repository'
import { getDb } from '@/lib/db'
import type { Project } from '@/lib/db/schema/projects'
import { isProjectClosed } from '@/lib/projects/project-status'
import { listChatProjects, listChatProjectsAmong } from '@/lib/projects/service'

export const REACH_MAX_OTHER_READERS = 10

const REACH_CHECK_CONCURRENCY = 20

export interface AudienceReach {
  projects: Project[]
  restrictedFolders: boolean
  key: string
}

function otherReaders(createdBy: string | null, grantees: readonly string[], askerId: string): string[] {
  return [...new Set([createdBy, ...grantees])].filter((person): person is string => !!person && person !== askerId)
}

async function everyoneOpens(organizationId: string, people: readonly string[], projectId: string): Promise<boolean> {
  for (let start = 0; start < people.length; start += REACH_CHECK_CONCURRENCY) {
    const chunk = people.slice(start, start + REACH_CHECK_CONCURRENCY)
    const verdicts = await Promise.all(
      chunk.map((person) => userHoldsProjectPermission({ organizationId }, projectId, person, 'project:view'))
    )
    if (verdicts.includes(false)) return false
  }
  return true
}

export async function audienceReach(session: AuthorizedSession, conversationId: string): Promise<AudienceReach> {
  const [audience, chat] = await Promise.all([
    readConversationAudience(getDb(), session.organizationId, conversationId),
    listChatProjects(session, 'newest'),
  ])
  return reachOver(session, audience, chat)
}

export async function audienceReachAmong(
  session: AuthorizedSession,
  audience: ConversationAudienceRow,
  projectIds: readonly string[]
): Promise<AudienceReach> {
  return reachOver(session, audience, await listChatProjectsAmong(session, projectIds))
}

async function reachOver(
  session: AuthorizedSession,
  audience: ConversationAudienceRow,
  chat: readonly Project[]
): Promise<AudienceReach> {
  const key = audienceKey(audience)
  if (isSoloAudience(audience, session.userId)) return { projects: [...chat], restrictedFolders: true, key }
  const closed = chat.filter((project) => isProjectClosed(project))
  const others = otherReaders(audience.createdBy, audience.grantees, session.userId)
  if (audience.visibility !== 'private' || others.length > REACH_MAX_OTHER_READERS) {
    return { projects: closed, restrictedFolders: false, key }
  }
  const kept: Project[] = []
  for (const project of chat) {
    if (project.id === audience.projectId) continue
    if (isProjectClosed(project) || (await everyoneOpens(session.organizationId, others, project.id))) kept.push(project)
  }
  return { projects: kept, restrictedFolders: false, key }
}
