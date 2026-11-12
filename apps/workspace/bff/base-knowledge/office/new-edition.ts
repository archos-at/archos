/**
 * A newer edition of a standard the office already holds (ticket 32: „eine
 * neue Ausgabe kommt hinzu, die bisherige bleibt nutzbar“): the file goes into
 * the same folder and becomes a second edition of the SAME work
 * (`store/office-editions.ts`), with the work's kind, title, territory, issuer
 * and authorities and its own edition read from the file name. Once a person
 * confirms it, the platform's rule (`time/editions.ts` `newestInForce`) decides
 * which edition an answer uses: the one in force on the project's reference
 * day. The earlier edition stays for the projects it still governs, and gets a
 * check that found a newer one.
 */

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
    // The edition is stored; a check that does not land costs only the earlier edition's note, never the upload.
    try {
      await recordBaseKnowledgeCheck(session, earlier.id, { result: 'newer_known', note: file.name.slice(0, 1000) })
    } catch (error) {
      console.warn('[base-knowledge] newer edition stored, check on the earlier one not recorded', { entryId: earlier.id, error })
    }
  }
  return added
}
