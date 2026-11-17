/**
 * The text of one manifestation of a change request, as its reviewer reads it
 * (ADR-0165, "Texts are attached in the request"): the PDF, served only while
 * the base corpus keeps the bytes the manifestation's revision names. Other
 * bytes under the file's name answer 409 `TEXT_CHANGED` and no text, so what
 * a reviewer vouches for is what the revision pins and the publish indexes.
 */

import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { readPlatformText } from '@/lib/base-knowledge/platform/texts'

type Params = { changeRequestId: string; manifestationKey: string }

export const GET = platformApiRoute<Params>(
  async ({ session, params }) => asProblem(async () => readPlatformText(session, params.changeRequestId, params.manifestationKey)),
  { permission: PLATFORM_PERMISSIONS.settingsView },
)
