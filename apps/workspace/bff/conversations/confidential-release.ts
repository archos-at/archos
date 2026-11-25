import 'server-only'
import { ConfidentialReleaseRequiredError, type ConfidentialSource, type ConversationConfinedError } from '@/lib/api/errors'
import { recordAuditEventOrThrow } from '@/lib/audit/service'
import type { AuthorizedSession } from '@/lib/auth/types'
import { currentActingSession } from '@/lib/agent-api/acting-session'
import { customFolderNames } from '@/lib/authz/folder-access'
import { getDb } from '@/lib/db'
import { errorsCopy } from '@/i18n/namespaces/errors'
import { confidentialReleaseForbidden } from '@/lib/organizations/confidential-release'
import { restrictingRecordOf, unreadableSourcesOf } from './restricted-use'
import { listProjectNames, listRestrictingSourceProjects } from './restricted-use-repository'
import type { Locale } from '@/i18n/config'
import type { FilingDestination, FilingRelease } from './restricted-egress'

interface ConfidentialRecord {
  folders: string[]
  projects: string[]
  sources: ConfidentialSource[]
}

async function confidentialRecordOf(organizationId: string, conversationId: string): Promise<ConfidentialRecord> {
  const [restricting, projects] = await Promise.all([
    restrictingRecordOf(organizationId, conversationId),
    listRestrictingSourceProjects(getDb(), organizationId, conversationId),
  ])
  const { folders, ownerOf, projectId: here } = restricting
  const owners = [...new Set(folders.map((folderId) => ownerOf.get(folderId)).filter((owner): owner is string => !!owner))]
  const [projectNames, folderNames] = await Promise.all([
    listProjectNames(getDb(), organizationId, [...new Set([...owners, ...projects])]),
    Promise.all(owners.map(async (owner) => [owner, await customFolderNames(organizationId, owner)] as const)),
  ])
  const namesIn = new Map(folderNames)
  const sources: ConfidentialSource[] = [
    ...folders.map((folderId): ConfidentialSource => {
      const owner = ownerOf.get(folderId)
      const project = owner && owner !== here ? projectNames.get(owner) : undefined
      return { kind: 'folder', name: (owner && namesIn.get(owner)?.get(folderId)) ?? folderId, ...(project ? { project } : {}) }
    }),
    ...projects.map((projectId): ConfidentialSource => ({ kind: 'project', name: projectNames.get(projectId) ?? projectId })),
  ]
  return { folders, projects, sources }
}

export interface ReleaseRequest {
  session: AuthorizedSession
  confirmed: boolean
  request?: Request
}

export async function releaseConfidential(
  by: ReleaseRequest,
  conversationId: string,
  locale: Locale,
  destination: FilingDestination,
  refusal: ConversationConfinedError,
): Promise<void> {
  const { session, confirmed, request } = by
  if (await confidentialReleaseForbidden(session.organizationId)) throw refusal
  const unreadable = await unreadableSourcesOf(session, conversationId)
  if (unreadable.folders.size > 0 || unreadable.projects.size > 0) throw refusal
  const record = await confidentialRecordOf(session.organizationId, conversationId)
  if (!confirmed) {
    throw new ConfidentialReleaseRequiredError(errorsCopy.messages[locale].confidentialRelease, record.sources)
  }
  await recordAuditEventOrThrow({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'conversation.confidential_released',
    targetType: 'conversation',
    targetId: conversationId,
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
  const by: ReleaseRequest = { session, confirmed, ...(request ? { request } : {}) }
  return {
    lift: (conversationId, locale, destination, refusal) =>
      releaseConfidential(by, conversationId, locale, destination, refusal),
  }
}
