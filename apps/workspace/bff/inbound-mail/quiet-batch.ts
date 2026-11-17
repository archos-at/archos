import 'server-only'

import { randomUUID } from 'node:crypto'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { UploadBatchEffects } from '@/lib/db/schema/upload-batches'
import { openUploadBatch, sealJobUploadBatch } from '@/lib/upload-batches/service'

export async function openQuietBatch(
  session: AuthorizedSession,
  projectId: string,
  effects: Readonly<UploadBatchEffects>
): Promise<string> {
  const id = randomUUID()
  await openUploadBatch(session, {
    id,
    scope: 'project',
    projectId,
    conversationId: null,
    expectedCount: 0,
    excluded: [],
    effects,
  })
  return id
}

export async function sealQuietBatch(session: AuthorizedSession, batchId: string): Promise<void> {
  try {
    await sealJobUploadBatch(session.organizationId, batchId, session.userId)
  } catch (error) {
    console.warn(
      `[inbound-mail] could not seal upload batch ${batchId}; the upload sweep will:`,
      error
    )
  }
}
