import 'server-only'
import { NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { atLeast, clearanceOf, effectiveFolderLevel, folderTree } from '@/lib/authz/folder-access'
import { listProjectFolderTree } from '@/lib/authz/folder-access-repository'
import type { TaskRun } from '@/lib/db/schema/task-model'
import type { TaskPlan } from '@/lib/db/schema/task-model'
import { findSubjectDocumentPlaces, listRunsByIds } from './repository'

export interface WithPlan {
  plan: TaskPlan | null
}

function subjectOf(row: WithPlan): string | null {
  return row.plan?.subject?.documentId ?? null
}

async function subjectReader(
  session: AuthorizedSession,
  projectId: string,
  rows: readonly WithPlan[],
): Promise<(row: WithPlan) => boolean> {
  const documentIds = [...new Set(rows.map(subjectOf).filter((id): id is string => id !== null))]
  if (documentIds.length === 0) return () => true
  const places = await findSubjectDocumentPlaces(session.organizationId, documentIds)
  const restricting = [...places.values()].some((place) => place.projectId !== projectId || place.folderId !== null)
  if (!restricting) return () => true
  const tree = folderTree(await listProjectFolderTree(session.organizationId, projectId))
  const clearance = await clearanceOf(session, projectId)
  return (row) => {
    const documentId = subjectOf(row)
    if (documentId === null) return true
    const place = places.get(documentId)
    if (!place) return true
    if (place.projectId !== projectId) return false
    if (place.folderId === null) return true
    return atLeast(effectiveFolderLevel(tree, clearance, place.folderId), 'read')
  }
}

export async function withoutUnreadableSubjects<T extends WithPlan>(
  session: AuthorizedSession,
  projectId: string,
  rows: readonly T[],
): Promise<T[]> {
  const mayRead = await subjectReader(session, projectId, rows)
  return rows.filter(mayRead)
}

export async function requireMaySeeSubject(
  session: AuthorizedSession,
  projectId: string,
  row: WithPlan,
  message = 'Task not found',
): Promise<void> {
  const mayRead = await subjectReader(session, projectId, [row])
  if (!mayRead(row)) throw new NotFoundError(message)
}

export interface RunRef {
  projectId: string
  runId: string
}

export async function unreadableRunIds(session: AuthorizedSession, refs: readonly RunRef[]): Promise<Set<string>> {
  const unreadable = new Set<string>()
  if (refs.length === 0) return unreadable
  const runs = new Map(
    (await listRunsByIds(session.organizationId, refs.map((ref) => ref.runId))).map((run) => [run.id, run]),
  )
  const byProject = new Map<string, TaskRun[]>()
  for (const ref of refs) {
    const run = runs.get(ref.runId)
    if (!run) continue
    if (run.projectId !== ref.projectId) {
      unreadable.add(ref.runId)
      continue
    }
    byProject.set(ref.projectId, [...(byProject.get(ref.projectId) ?? []), run])
  }
  for (const [projectId, projectRuns] of byProject) {
    const mayRead = await subjectReader(session, projectId, projectRuns)
    for (const run of projectRuns) {
      if (!mayRead(run)) unreadable.add(run.id)
    }
  }
  return unreadable
}
