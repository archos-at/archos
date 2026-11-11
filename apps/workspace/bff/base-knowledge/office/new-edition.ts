/**
 * A newer edition of an entry the office already holds (ticket 32: „eine neue
 * Ausgabe kommt hinzu, die bisherige bleibt nutzbar“). The new file is uploaded
 * as base knowledge into the same folder, proposed with the earlier entry's
 * kind, title, territory, issuer, authorities and licence class (its edition
 * and designation are read from the new file name, since those are what
 * changed), and the earlier entry gets a check that found a newer edition, so
 * it shows as due until somebody decides what to do with it. Nothing is
 * removed: a project whose reference date falls before the new edition may
 * still need the earlier one.
 *
 * Linking the two as editions of one work is the platform layer's (ADR-0163,
 * "one office work per copy for now").
 */

import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { BaseKnowledgeEntry } from '../wire'
import { isStandardsFolder } from './folders'
import { getBaseKnowledgeEntry, recordBaseKnowledgeCheck, uploadBaseKnowledge } from './service'

export async function addBaseKnowledgeEdition(
  session: AuthorizedSession,
  entryId: string,
  file: File,
  request: Request,
): Promise<BaseKnowledgeEntry> {
  const earlier = await getBaseKnowledgeEntry(session, entryId)
  const { kind, title, territoryIds, issuer, addressees, licenceClass } = earlier.values
  const folderId = earlier.folderId && (await isStandardsFolder(session, earlier.folderId)) ? earlier.folderId : null
  const added = await uploadBaseKnowledge(session, file, request, {
    folderId,
    kind,
    title,
    territoryIds,
    issuer,
    addressees,
    licenceClass,
  })
  if (earlier.status === 'confirmed') {
    await recordBaseKnowledgeCheck(session, entryId, { result: 'newer_known', note: file.name.slice(0, 1000) })
  }
  return added
}
