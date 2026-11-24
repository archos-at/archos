import 'server-only'
import { captureServer } from '@/lib/analytics/posthog-server'
import type { AuthorizedSession } from '@/lib/auth/types'
import { isOfficeStandardsEnabled } from '@/lib/authz/feature-flags'
import { recognizeNorm } from './reading'

export interface UploadedForReading {
  shelf: 'office_shelf' | 'project'
  fileName: string
  uploadId: string | null
  revisionOf: string | null
}

export function announceNormReadingAtUpload(session: AuthorizedSession, upload: UploadedForReading): void {
  if (upload.revisionOf || !isOfficeStandardsEnabled(session)) return
  const recognized = recognizeNorm({ fileName: upload.fileName }).norm
  captureServer({
    event: 'norm_recognized_at_upload',
    distinctId: session.userId,
    organizationId: session.organizationId,
    properties: {
      shelf: upload.shelf,
      recognized: recognized ? 1 : 0,
      plain: recognized ? 0 : 1,
      upload_id: upload.uploadId ?? undefined,
    },
  })
}
