import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import { requireResourceAccess } from '@/lib/sharing/access'
import { deleteDraftInBackend, restoreDraftInBackend } from './draft-backend'

export interface RestoredConversationDraft {
  path: string
  version: number
}

const absolute = (path: string): string => `/${path.trim().replace(/^\/+/, '')}`

export async function deleteConversationDraft(
  session: AuthorizedSession,
  conversationId: string,
  path: string,
): Promise<{ path: string; deleted: true }> {
  await requireResourceAccess(session, 'conversation', conversationId, 'collaborator')
  await deleteDraftInBackend(conversationId, path)
  return { path: absolute(path), deleted: true }
}

export async function restoreConversationDraft(
  session: AuthorizedSession,
  conversationId: string,
  path: string,
): Promise<RestoredConversationDraft> {
  await requireResourceAccess(session, 'conversation', conversationId, 'collaborator')
  const version = await restoreDraftInBackend(conversationId, path)
  return { path: absolute(path), version }
}
