import 'server-only'
import { and, eq } from 'drizzle-orm'
import { findConversationInOrg } from '@/lib/conversations/repository'
import { getDb } from '@/lib/db'
import { findBimModelById } from '@/lib/bim/repository'
import { projectFolders } from '@/lib/db/schema/project-folders'
import { projects } from '@/lib/db/schema/projects'
import { proposedChanges } from '@/lib/db/schema/proposed-changes'
import { uploadBatches } from '@/lib/db/schema/upload-batches'
import { inboundMails } from '@/lib/db/schema/inbound-mail'
import { mailThreads } from '@/lib/db/schema/mail-thread'
import { hasPassedScreening, memberReader } from '@/lib/documents/document-reader'
import { findDocumentInOrg } from '@/lib/documents/repository'
import { isUuid } from '@/lib/ids'
import type { OperationTarget } from './operation-targets'

export interface TargetPlace {
  projectId: string | null
  conversationId: string | null
  document?: { folderId: string | null; passedScreening: boolean }
}

const place = (projectId: string | null, conversationId: string | null = null): TargetPlace => ({
  projectId: projectId === null ? null : String(projectId),
  conversationId,
})

export async function findTargetPlace(
  organizationId: string,
  userId: string,
  target: OperationTarget,
): Promise<TargetPlace | null> {
  const db = getDb()
  if (target.type === 'conversation') {
    const conversation = await findConversationInOrg(target.id, organizationId)
    return conversation ? place(conversation.projectId, conversation.id) : null
  }
  if (!isUuid(target.id)) return null
  switch (target.type) {
    case 'project': {
      const [row] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, target.id), eq(projects.organizationId, organizationId)))
        .limit(1)
      return row ? place(row.id) : null
    }
    case 'document': {
      const doc = await findDocumentInOrg(target.id, organizationId, memberReader(userId))
      if (!doc) return null
      return {
        ...place(doc.projectId, doc.conversationId ?? null),
        document: { folderId: doc.folderId ?? null, passedScreening: hasPassedScreening(doc) },
      }
    }
    case 'folder': {
      const [row] = await db
        .select({ projectId: projectFolders.projectId })
        .from(projectFolders)
        .where(and(eq(projectFolders.id, target.id), eq(projectFolders.organizationId, organizationId)))
        .limit(1)
      return row ? place(row.projectId) : null
    }
    case 'bim_model': {
      const model = await findBimModelById(target.id, organizationId, memberReader(userId))
      return model ? place(model.projectId) : null
    }
    case 'upload_batch': {
      const [row] = await db
        .select({ projectId: uploadBatches.projectId })
        .from(uploadBatches)
        .where(and(eq(uploadBatches.id, target.id), eq(uploadBatches.organizationId, organizationId)))
        .limit(1)
      return row ? place(row.projectId) : null
    }
    case 'inbound_mail': {
      const [row] = await db
        .select({ projectId: inboundMails.projectId })
        .from(inboundMails)
        .where(and(eq(inboundMails.id, target.id), eq(inboundMails.organizationId, organizationId)))
        .limit(1)
      return row ? place(row.projectId) : null
    }
    case 'mail_thread': {
      const [row] = await db
        .select({ projectId: mailThreads.projectId })
        .from(mailThreads)
        .where(and(eq(mailThreads.id, target.id), eq(mailThreads.organizationId, organizationId)))
        .limit(1)
      return row ? place(row.projectId) : null
    }
    case 'proposal': {
      const [row] = await db
        .select({ projectId: proposedChanges.projectId, conversationId: proposedChanges.originConversationId })
        .from(proposedChanges)
        .where(and(eq(proposedChanges.id, target.id), eq(proposedChanges.organizationId, organizationId)))
        .limit(1)
      return row ? place(row.projectId, row.conversationId) : null
    }
  }
}

export async function findProjectName(organizationId: string, projectId: string): Promise<string | null> {
  if (!isUuid(projectId)) return null
  const [row] = await getDb()
    .select({ name: projects.name })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
    .limit(1)
  return row?.name ?? null
}

export async function findFolderName(
  organizationId: string,
  folderId: string,
): Promise<{ projectId: string | null; name: string } | null> {
  if (!isUuid(folderId)) return null
  const [row] = await getDb()
    .select({ projectId: projectFolders.projectId, name: projectFolders.name })
    .from(projectFolders)
    .where(and(eq(projectFolders.id, folderId), eq(projectFolders.organizationId, organizationId)))
    .limit(1)
  return row ? { projectId: row.projectId === null ? null : String(row.projectId), name: row.name } : null
}
