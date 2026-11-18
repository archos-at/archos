import { ConflictError } from '@/lib/api/errors'
import { isForeignKeyViolation, isUniqueViolation } from '@/lib/db/errors'

export const LIVE_NAME_INDEX = 'uniq_documents_live_name_per_collection'
export const OPEN_VERSION_INDEX = 'uniq_document_versions_open_per_document'

export class LiveFilenameTakenError extends ConflictError {
  constructor(readonly filename: string, options?: { cause?: unknown }) {
    super('A file with this name was just uploaded here', { reason: 'live_name_taken' })
    if (options?.cause !== undefined) this.cause = options.cause
  }
}

export class OpenVersionExistsError extends ConflictError {
  constructor(readonly documentId: string, options?: { cause?: unknown }) {
    super('This document already has an open version', { reason: 'open_version_exists' })
    if (options?.cause !== undefined) this.cause = options.cause
  }
}

export function mapDocumentInsertError(error: unknown, filename: string): unknown {
  return isUniqueViolation(error, LIVE_NAME_INDEX)
    ? new LiveFilenameTakenError(filename, { cause: error })
    : error
}

export const VERSION_DOCUMENT_FKS = [
  'document_versions_document_id_fkey',
  'document_versions_document_id_project_id_fkey',
] as const

export class DocumentDeletedError extends ConflictError {
  constructor(readonly documentId: string, options?: { cause?: unknown }) {
    super('The file was deleted while this upload was being recorded', {
      reason: 'deleted_during_upload',
    })
    if (options?.cause !== undefined) this.cause = options.cause
  }
}

export function mapVersionInsertError(error: unknown, documentId: string): unknown {
  if (isUniqueViolation(error, OPEN_VERSION_INDEX)) {
    return new OpenVersionExistsError(documentId, { cause: error })
  }
  if (VERSION_DOCUMENT_FKS.some((name) => isForeignKeyViolation(error, name))) {
    return new DocumentDeletedError(documentId, { cause: error })
  }
  return error
}

export class ReplacedDocumentGoneError extends ConflictError {
  constructor(readonly documentId: string) {
    super('The file this upload was replacing was just deleted', { reason: 'replaced_document_gone' })
  }
}

export async function retryRacedUpload<T>(attempt: () => Promise<T>): Promise<T> {
  try {
    return await attempt()
  } catch (error) {
    if (!(error instanceof LiveFilenameTakenError) && !(error instanceof ReplacedDocumentGoneError)) {
      throw error
    }
    return attempt()
  }
}
