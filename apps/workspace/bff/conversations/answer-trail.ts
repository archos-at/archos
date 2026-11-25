import 'server-only'
import { and, eq } from 'drizzle-orm'
import type { AuthorizedSession } from '@/lib/auth/types'
import { customFolderNames, isFolderVisibleTo } from '@/lib/authz/folder-access'
import { requireProjectAccess } from '@/lib/authz/projects'
import { getDb } from '@/lib/db'
import { answerContexts, type AnswerContext } from '@/lib/db/schema/answer-contexts'
import { withTenant } from '@/lib/db/tenant-context'
import { findProjectInOrg } from '@/lib/projects/repository'
import { projectsOfFolders } from './restricted-use-repository'

export type TrailPlace =
  | { kind: 'project' | 'folder'; id: string; name: string }
  | { kind: 'project' | 'folder'; withheld: true }

export interface AnswerTrail {
  messageId: string
  places: TrailPlace[]
  personalMemory: boolean
  personalShelf: boolean
  solo: boolean
}

const MAX_ANSWERS = 500

export async function answerReadsOf(session: AuthorizedSession, conversationId: string): Promise<AnswerContext[]> {
  const { organizationId, userId } = session
  return withTenant({ organizationId, userId }, () =>
    getDb()
      .select()
      .from(answerContexts)
      .where(and(eq(answerContexts.organizationId, organizationId), eq(answerContexts.conversationId, conversationId)))
      .orderBy(answerContexts.decidedAt, answerContexts.messageId)
      .limit(MAX_ANSWERS),
  )
}

export async function trailsAsSeenBy(session: AuthorizedSession, conversationId: string): Promise<AnswerTrail[]> {
  const { organizationId, userId } = session
  const rows = await answerReadsOf(session, conversationId)
  return withTenant({ organizationId, userId }, async () => {
    const projectIds = [...new Set(rows.flatMap((row) => row.readProjects))]
    const folderIds = [...new Set(rows.flatMap((row) => row.readFolders))]
    const [projects, folders] = await Promise.all([
      projectPlaces(session, projectIds),
      folderPlaces(session, folderIds),
    ])
    return rows.map((row) => ({
      messageId: row.messageId,
      places: [
        ...row.readProjects.map((id) => projects.get(id) ?? withheld('project')),
        ...row.readFolders.map((id) => folders.get(id) ?? withheld('folder')),
      ],
      personalMemory: row.personalMemory,
      personalShelf: row.readPersonalShelf,
      solo: row.solo,
    }))
  })
}

const withheld = (kind: 'project' | 'folder'): TrailPlace => ({ kind, withheld: true })

async function projectPlaces(session: AuthorizedSession, projectIds: readonly string[]): Promise<Map<string, TrailPlace>> {
  const places = new Map<string, TrailPlace>()
  for (const projectId of projectIds) {
    const opens = await requireProjectAccess(session, projectId, 'project:view').then(
      () => true,
      () => false,
    )
    if (!opens) continue
    const project = await findProjectInOrg(projectId, session.organizationId)
    if (project) places.set(projectId, { kind: 'project', id: projectId, name: project.name })
  }
  return places
}

async function folderPlaces(session: AuthorizedSession, folderIds: readonly string[]): Promise<Map<string, TrailPlace>> {
  const places = new Map<string, TrailPlace>()
  if (folderIds.length === 0) return places
  const owners = await projectsOfFolders(getDb(), session.organizationId, folderIds)
  const byProject = new Map<string, string[]>()
  for (const [folderId, projectId] of owners) byProject.set(projectId, [...(byProject.get(projectId) ?? []), folderId])
  for (const [projectId, ids] of byProject) {
    const names = await customFolderNames(session.organizationId, projectId)
    for (const folderId of ids) {
      const name = names.get(folderId)
      if (name && (await isFolderVisibleTo(session, projectId, folderId))) {
        places.set(folderId, { kind: 'folder', id: folderId, name })
      }
    }
  }
  return places
}
