import 'server-only'
import { ApiError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { getAccessibleDocument } from './access'

export async function canWriteDocument(session: AuthorizedSession, documentId: string): Promise<boolean> {
  try {
    await getAccessibleDocument(session, documentId, 'write')
    return true
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return false
    throw error
  }
}
