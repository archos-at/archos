import 'server-only'
import { ConflictError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { maySeeHeld } from '@/lib/upload-screening/quarantine-reviewers'
import { hasPassedScreening } from './document-reader'
import { NAME_TAKEN_DETAILS, nameTakenMessage } from './name-taken'
import type { LiveDocumentNameHolder } from './repository'

export async function refuseUnseenHolder(session: AuthorizedSession, holder: LiveDocumentNameHolder, name: string): Promise<void> {
  if (hasPassedScreening(holder) || (await maySeeHeld(session, holder))) return
  throw new ConflictError(nameTakenMessage(name), NAME_TAKEN_DETAILS)
}
