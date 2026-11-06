/**
 * The upload type gate: is this file's type one this organization accepts?
 *
 * Its own module so the upload doors and `./upload-admission` can import it
 * without importing `./service`, which imports `./shelf-upload` (a cycle).
 */

import 'server-only'
import { BadRequestError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { isVlmConfigured } from '@/lib/documents/vlm-capability'
import { uploadExtensionOf } from '@/shared/config/file-upload'
import { acceptedTypesForFlags } from './accepted-types'

/**
 * Server-side upload allow-list. The client already filters by accepted type,
 * but nothing enforced it on the server until now — so any type could be
 * POSTed directly. This mirrors the same env-driven accepted-types config the
 * client uses (closing that gap for ALL types), and gates image types by
 * availability = the `image-upload` flag AND the derived VLM capability:
 * images are in the allow-list only when the session's org has the flag AND a
 * vision model resolves on the backend. The capability comes from the same
 * TTL-cached probe (`isVlmConfigured`) that layout.tsx uses, so this allow-list
 * and the client's accepted-types list are ONE truth. Fail-closed: an
 * unconfirmable capability excludes images (never a silent-failure upload).
 *
 * The list is `acceptedTypesForFlags`, the resolver the sessionless path
 * (`acceptedTypesForOrganization`) answers from too, so a mail part offered for
 * filing and the upload that files it agree by construction.
 */
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
