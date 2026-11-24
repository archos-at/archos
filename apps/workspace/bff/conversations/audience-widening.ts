import 'server-only'
import { ConflictError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { clearanceOf, clearanceOfMember, customFolderNames, type FolderClearance } from '@/lib/authz/folder-access'
import { userHoldsProjectPermission } from '@/lib/authz/project-membership'
import { getDb } from '@/lib/db'
import type { DbExecutor } from '@/lib/db/executor'
import { loadOrganizationDirectory } from '@/lib/sharing/directory'
import { SHARING_ERROR_REASONS } from '@/lib/sharing/types'
import { readConversationRow } from '@/lib/conversation-context/audience'
import { personalShelfUsed } from './personal-shelf-use'
import {
  mayReadEvery,
  mayReadFolder,
  ownersOf,
  projectOf,
  recordView,
  sessionMayOpenAll,
  stillRestricting,
  type ProjectRef,
  type RecordView,
} from './restricted-use'
import { listRecordedSourceFolders, listRestrictingSourceProjects, lockConversationAudience } from './restricted-use-repository'

export type AudienceWidening =
  | { kind: 'person'; userId: string; self: boolean; ownerConfirmed?: boolean }
  | { kind: 'visibility'; ownerConfirmed?: boolean }

interface Uncovered {
  folders: string[]
  projects: string[]
  personalShelf: boolean
}

function isCovered(missing: Uncovered): boolean {
  return missing.folders.length === 0 && missing.projects.length === 0 && !missing.personalShelf
}

function personalShelfUncovered(
  session: AuthorizedSession,
  widening: AudienceWidening,
  context: WideningContext,
  used: boolean
): boolean {
  return used && !(widening.ownerConfirmed === true && context.ownerId === session.userId)
}

async function wideningRefusal(
  session: AuthorizedSession,
  widening: AudienceWidening,
  missing: Uncovered,
  context: WideningContext
): Promise<ConflictError> {
  const crossProject = missing.projects.length > 0
  if (missing.personalShelf && missing.folders.length === 0 && !crossProject) {
    const confirmable = context.ownerId === session.userId
    return new ConflictError(
      confirmable
        ? 'This conversation drew on your own shelf. The others will see its answers, never the files. Confirm to share it.'
        : 'This conversation drew on its creator’s own shelf; only they may share it further.',
      { reason: SHARING_ERROR_REASONS.personalShelfContent, confirmable }
    )
  }
  if (widening.kind === 'visibility') {
    return crossProject
      ? new ConflictError(
          'This conversation draws on another project and cannot be made visible to the whole project.',
          { reason: SHARING_ERROR_REASONS.crossProjectContentProject }
        )
      : new ConflictError(
          'This conversation draws on a folder with restricted access and cannot be made visible to the whole project.',
          { reason: SHARING_ERROR_REASONS.restrictedContentProject }
        )
  }
  if (widening.self) {
    return crossProject
      ? new ConflictError('You may not open every project this conversation draws on.', {
          reason: SHARING_ERROR_REASONS.crossProjectContentSelf,
        })
      : new ConflictError('You may not read every restricted folder this conversation draws on.', {
          reason: SHARING_ERROR_REASONS.restrictedContentSelf,
        })
  }
  const directory = await loadOrganizationDirectory(session.organizationId)
  const person = directory.get(widening.userId)?.name ?? null
  if (crossProject) {
    return new ConflictError('That person may not open every project this conversation draws on.', {
      reason: SHARING_ERROR_REASONS.crossProjectContent,
      ...(person ? { person } : {}),
    })
  }
  const folders = context.project ? await folderNamesReadableBy(session, context, missing.folders) : []
  return new ConflictError('That person may not read every restricted folder this conversation draws on.', {
    reason: SHARING_ERROR_REASONS.restrictedContent,
    ...(person ? { person } : {}),
    ...(folders.length > 0 ? { folders } : {}),
  })
}

async function folderNamesReadableBy(
  session: AuthorizedSession,
  context: WideningContext,
  folderIds: readonly string[]
): Promise<string[]> {
  if (!context.project) return []
  const names = await customFolderNames(session.organizationId, context.project.projectId)
  const sharer = await clearanceOf(session, context.project.projectId)
  return folderIds
    .filter((folderId) => mayReadFolder(context.view.tree, sharer, folderId))
    .map((folderId) => names.get(folderId))
    .filter((name): name is string => Boolean(name))
}

function uncovered(
  widening: AudienceWidening,
  restricted: readonly string[],
  projects: readonly string[],
  context: WideningContext,
  personalShelf: boolean
): Uncovered {
  if (widening.kind === 'visibility') return { folders: [...restricted], projects: [...projects], personalShelf }
  const clearances = context.personClearances
  return {
    personalShelf,
    folders: restricted.filter(
      (folderId) => !clearances || !mayReadEvery(context.view, (owner) => clearances.get(owner), [folderId])
    ),
    projects: projects.filter((projectId) => !context.personOpens.has(projectId)),
  }
}

interface WideningContext {
  ownerId: string | null
  project: ProjectRef | null
  view: RecordView
  personClearances: ReadonlyMap<string, FolderClearance> | null
  personOpens: ReadonlySet<string>
}

async function wideningContext(
  session: AuthorizedSession,
  conversationId: string,
  widening: AudienceWidening
): Promise<WideningContext> {
  const { organizationId } = session
  const [audience, recorded, projects] = await Promise.all([
    readConversationRow(organizationId, conversationId),
    listRecordedSourceFolders(getDb(), organizationId, conversationId),
    listRestrictingSourceProjects(getDb(), organizationId, conversationId),
  ])
  const project = await projectOf(organizationId, audience, null)
  const view = await recordView(organizationId, audience.projectId, recorded)
  const ownerId = audience.createdBy
  if (widening.kind === 'visibility') return { ownerId, project, view, personClearances: null, personOpens: new Set() }
  const owners = ownersOf(view, stillRestricting(view.tree, recorded))
  const clearanceIn = (owner: string) =>
    widening.self ? clearanceOf(session, owner) : clearanceOfMember(organizationId, widening.userId, owner)
  const [found, personOpens] = await Promise.all([
    Promise.all(owners.map(clearanceIn)),
    widening.self ? sessionOpens(session, projects) : peopleWhoMayOpenEach(organizationId, widening.userId, projects),
  ])
  const personClearances = new Map(owners.map((owner, index) => [owner, found[index]]))
  return { ownerId, project, view, personClearances, personOpens }
}

async function sessionOpens(session: AuthorizedSession, projectIds: readonly string[]): Promise<Set<string>> {
  const opens = new Map<string, boolean>()
  for (const projectId of projectIds) await sessionMayOpenAll(session, [projectId], opens)
  return new Set(projectIds.filter((projectId) => opens.get(projectId) === true))
}

async function peopleWhoMayOpenEach(organizationId: string, userId: string, projectIds: readonly string[]): Promise<Set<string>> {
  const verdicts = await Promise.all(
    projectIds.map((projectId) => userHoldsProjectPermission({ organizationId }, projectId, userId, 'project:view'))
  )
  return new Set(projectIds.filter((_, index) => verdicts[index]))
}

function restrictedRecord(context: WideningContext, recorded: readonly string[]): string[] {
  return stillRestricting(context.view.tree, recorded)
}

export async function assertMayWidenConversation(
  session: AuthorizedSession,
  conversationId: string,
  widening: AudienceWidening
): Promise<void> {
  const { organizationId } = session
  const context = await wideningContext(session, conversationId, widening)
  const [recorded, projects, used] = await Promise.all([
    listRecordedSourceFolders(getDb(), organizationId, conversationId),
    listRestrictingSourceProjects(getDb(), organizationId, conversationId),
    personalShelfUsed(organizationId, conversationId),
  ])
  const personalShelf = personalShelfUncovered(session, widening, context, used)
  const missing = uncovered(widening, restrictedRecord(context, recorded), projects, context, personalShelf)
  if (!isCovered(missing)) throw await wideningRefusal(session, widening, missing, context)
}

export async function widenConversationAudience<T>(
  session: AuthorizedSession,
  conversationId: string,
  widening: AudienceWidening,
  write: (executor: DbExecutor) => Promise<T>
): Promise<T> {
  const { organizationId } = session
  const context = await wideningContext(session, conversationId, widening)
  const refusal: { missing: Uncovered } = { missing: { folders: [], projects: [], personalShelf: false } }
  const result = await getDb().transaction(async (tx) => {
    await lockConversationAudience(tx, organizationId, conversationId)
    const recorded = restrictedRecord(context, await listRecordedSourceFolders(tx, organizationId, conversationId))
    const projects = await listRestrictingSourceProjects(tx, organizationId, conversationId)
    const personalShelf = personalShelfUncovered(session, widening, context, await personalShelfUsed(organizationId, conversationId, tx))
    refusal.missing = uncovered(widening, recorded, projects, context, personalShelf)
    if (!isCovered(refusal.missing)) return null
    return { value: await write(tx) }
  })
  if (result === null) throw await wideningRefusal(session, widening, refusal.missing, context)
  return result.value
}
