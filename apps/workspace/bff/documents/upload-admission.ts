import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import { assertFileSizeAllowed } from '@/lib/storage/upload-limit'
import { assertWithinStorageQuota } from '@/lib/storage/service'
import { assertUploadNameAllowed, type NameGateResult } from '@/lib/upload-screening/service'
import { assertUploadTypeAllowed } from './upload-type'

interface UploadAdmissionInput {
  filename: string
  size: number
  originPath: string | null
  folderPath?: string | null
  projectId?: string | null
  screeningRelease: boolean
}

export async function admitUpload(session: AuthorizedSession, input: UploadAdmissionInput): Promise<NameGateResult> {
  const nameGate = await assertUploadNameAllowed(
    session.organizationId,
    { filename: input.filename, originPath: input.originPath, folderPath: input.folderPath },
    input.screeningRelease,
    input.projectId,
  )
  await admitFileBeforeReading(session, input)
  await assertWithinStorageQuota(session.organizationId, input.size)
  return nameGate
}

export async function admitFileBeforeReading(
  session: AuthorizedSession,
  file: { filename: string; size: number },
): Promise<void> {
  await assertUploadTypeAllowed(session, file.filename)
  await assertFileSizeAllowed(session.organizationId, file.size, file.filename)
}
