import 'server-only'
import { ConfidentialReleaseRequiredError, type ConfidentialSource, type ConversationConfinedError } from '@/lib/api/errors'
import { recordAuditEventOrThrow } from '@/lib/audit/service'
import type { AuthorizedSession } from '@/lib/auth/types'
import { currentActingSession } from '@/lib/agent-api/acting-session'
import { customFolderNames } from '@/lib/authz/folder-access'
import { readConversationRow } from '@/lib/conversation-context/audience'
import { getDb } from '@/lib/db'
import { errorsCopy } from '@/i18n/namespaces/errors'
import { confidentialReleaseEnabled } from '@/lib/organizations/confidential-release'
import { ownersOf, recordView, stillRestricting, unreadableSourcesOf } from './restricted-use'
import { listProjectNames, listRecordedSourceFolders, listRestrictingSourceProjects } from './restricted-use-repository'
import type { ConversationOrigin, FilingDestination, FilingRelease } from './restricted-egress'

interface ConfidentialRecord {
  folders: string[]
  projects: string[]
  sources: ConfidentialSource[]
}

async function confidentialRecordOf(organizationId: string, conversationId: string): Promise<ConfidentialRecord> {
  const [recorded, projects, audience] = await Promise.all([
    listRecordedSourceFolders(getDb(), organizationId, conversationId),
    listRestrictingSourceProjects(getDb(), organizationId, conversationId),
    readConversationRow(organizationId, conversationId),
  ])
  const view = await recordView(organizationId, audience.projectId, recorded)
  const folders = stillRestricting(view.tree, recorded)
  const owners = ownersOf(view, folders)
  const [projectNames, folderNames] = await Promise.all([
    listProjectNames(getDb(), organizationId, [...new Set([...owners, ...projects])]),
    Promise.all(owners.map(async (owner) => [owner, await customFolderNames(organizationId, owner)] as const)),
  ])
  const namesIn = new Map(folderNames)
  const sources: ConfidentialSource[] = [
    ...folders.map((folderId): ConfidentialSource => {
      const owner = view.ownerOf.get(folderId)
      const project = owner && owner !== audience.projectId ? projectNames.get(owner) : undefined
      return { kind: 'folder', name: (owner && namesIn.get(owner)?.get(folderId)) ?? folderId, ...(project ? { project } : {}) }
    }),
    ...projects.map((projectId): ConfidentialSource => ({ kind: 'project', name: projectNames.get(projectId) ?? projectId })),
  ]
  return { folders, projects, sources }
}

export async function releaseConfidential(
  origin: ConversationOrigin & { conversationId: string; release: FilingRelease },
  destination: FilingDestination,
  refusal: ConversationConfinedError,
): Promise<void> {
  const { session, confirmed, request } = origin.release
  if (!(await confidentialReleaseEnabled(session.organizationId))) throw refusal
  const unreadable = await unreadableSourcesOf(session, origin.conversationId)
  if (unreadable.folders.size > 0 || unreadable.projects.size > 0) throw refusal
  const record = await confidentialRecordOf(session.organizationId, origin.conversationId)
  if (!confirmed) {
    throw new ConfidentialReleaseRequiredError(errorsCopy.messages[origin.locale].confidentialRelease, record.sources)
  }
  await recordAuditEventOrThrow({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'conversation.confidential_released',
    targetType: 'conversation',
    targetId: origin.conversationId,
    metadata: {
      projectId: destination.projectId ?? '',
      folderId: destination.folderId ?? '',
      sourceFolders: record.folders.join(','),
      sourceProjects: record.projects.join(','),
    },
    ...(request ? { request } : {}),
  })
}

export function filingReleaseOf(session: AuthorizedSession, confirmed: boolean, request?: Request): FilingRelease | undefined {
  if (currentActingSession() !== undefined) return undefined
  return { session, confirmed, ...(request ? { request } : {}) }
}
