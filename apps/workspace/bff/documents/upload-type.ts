import 'server-only'
import { BadRequestError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { isVlmConfigured } from '@/lib/documents/vlm-capability'
import { uploadExtensionOf } from '@/shared/config/file-upload'
import { acceptedTypesForFlags } from './accepted-types'

export async function assertUploadTypeAllowed(
  session: AuthorizedSession,
  filename: string
): Promise<void> {
  const allowed = [...acceptedTypesForFlags(session, await isVlmConfigured())]
  const ext = uploadExtensionOf(filename)
  if (!ext || !allowed.includes(ext)) {
    throw new BadRequestError(`File type "${ext || 'unknown'}" is not permitted`, {
      extension: ext || null,
      accepted: allowed,
    })
  }
}
