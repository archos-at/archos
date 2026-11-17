import 'server-only'
import { v5 as uuidv5 } from 'uuid'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { MailImport } from '@/lib/db/schema/mail-imports'
import { ARCHIVE_THREAD_RENDER_EFFECTS } from '@/lib/inbound-mail/batch-effects'
import {
  findJobUploadBatch,
  openUploadBatch,
  sealJobUploadBatch,
  UPLOAD_BATCH_MAX_FILES,
} from '@/lib/upload-batches/service'

const IMPORT_BATCH_NAMESPACE = '6f1d3c52-8a4e-4b7f-9c21-5e0a7d93b4c8'

const MAX_GENERATIONS = 1_000

export type ImportBatchKind = 'files' | 'threads'

export interface ImportBatch {
  id: string
  kind: ImportBatchKind
  generation: number
  documents: number
}

export function importBatchId(importId: string, generation: number, kind: ImportBatchKind = 'files'): string {
  const name = kind === 'files' ? `${importId}:${generation}` : `${importId}:${kind}:${generation}`
  return uuidv5(name, IMPORT_BATCH_NAMESPACE)
}

type Generation = { generation: number; id: string; documents: number | null }

async function firstUnsealed(row: MailImport, kind: ImportBatchKind): Promise<Generation> {
  for (let generation = 0; generation < MAX_GENERATIONS; generation += 1) {
    const id = importBatchId(row.id, generation, kind)
    const state = await findJobUploadBatch(row.organizationId, id, row.userId)
    if (state.status === 'open') return { generation, id, documents: state.documents }
    if (state.status === 'missing') return { generation, id, documents: null }
  }
  throw new Error(`no free upload batch for import ${row.id} after ${MAX_GENERATIONS} generations`)
}

export async function openImportBatch(
  session: AuthorizedSession,
  row: MailImport,
  kind: ImportBatchKind = 'files',
): Promise<ImportBatch> {
  const found = await firstUnsealed(row, kind)
  if (found.documents !== null) return { id: found.id, kind, generation: found.generation, documents: found.documents }
  await openUploadBatch(session, {
    id: found.id,
    scope: 'project',
    projectId: row.projectId,
    conversationId: null,
    expectedCount: 0,
    excluded: [],
    ...(kind === 'threads' ? { effects: ARCHIVE_THREAD_RENDER_EFFECTS } : {}),
  })
  return { id: found.id, kind, generation: found.generation, documents: 0 }
}

export async function importBatchWithRoom(
  session: AuthorizedSession,
  row: MailImport,
  current: ImportBatch,
): Promise<ImportBatch> {
  if (current.documents < UPLOAD_BATCH_MAX_FILES) return current
  await sealJobUploadBatch(row.organizationId, current.id, row.userId)
  return openImportBatch(session, row, current.kind)
}

export async function sealImportBatch(row: MailImport): Promise<void> {
  for (const kind of ['files', 'threads'] as const) {
    try {
      const found = await firstUnsealed(row, kind)
      if (found.documents !== null) await sealJobUploadBatch(row.organizationId, found.id, row.userId)
    } catch (error) {
      console.error(`[mail-import] could not seal the ${kind} batch of ${row.id}; the upload sweep will:`, error)
    }
  }
}
