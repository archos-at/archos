import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { BaseKnowledgeEntry } from '../wire'
import { isStandardsFolder } from './folders'
import { recordBaseKnowledgeCheck, storedEntryOf, uploadBaseKnowledge } from './service'

export async function addBaseKnowledgeEdition(
  session: AuthorizedSession,
  entryId: string,
  file: File,
  request: Request,
): Promise<BaseKnowledgeEntry> {
  const { stored, entry: earlier } = await storedEntryOf(session, entryId)
  const folderId = earlier.folderId && (await isStandardsFolder(session, earlier.folderId)) ? earlier.folderId : null
  const added = await uploadBaseKnowledge(session, file, request, { folderId, editionOf: stored })
  if (earlier.status === 'confirmed') {
    try {
      await recordBaseKnowledgeCheck(session, earlier.id, { result: 'newer_known', note: file.name.slice(0, 1000) })
    } catch (error) {
      console.warn('[base-knowledge] newer edition stored, check on the earlier one not recorded', { entryId: earlier.id, error })
    }
  }
  return added
}
