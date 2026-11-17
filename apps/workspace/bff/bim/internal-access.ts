import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { s3Client } from '@/lib/s3'
import { resolveDocumentBucket } from '@/lib/storage/bucket'
import { ForbiddenError, NotFoundError } from '@/lib/api/errors'
import { FEATURE_FLAGS } from '@/lib/authz/feature-flags'
import { isOrgFeatureEnabled } from '@/lib/workos/feature-flags'
import { findDocumentInOrg } from '@/lib/documents/repository'
import { SCREENED_ONLY } from '@/lib/documents/document-reader'
import { getRestrictedFolderIds } from '@/lib/authz/folder-access'
import { listBimModels, type BimModelHeader } from './repository'
import { modelShelf } from './model-shelf'

export async function assertInternalIfcModelsEnabled(organizationId: string): Promise<void> {
  if (!(await isOrgFeatureEnabled(FEATURE_FLAGS.ifcModels, organizationId))) {
    throw new ForbiddenError('IFC models are not enabled for this organization')
  }
}

export function describeModel(model: BimModelHeader) {
  return {
    modelId: model.id,
    filename: model.filename,
    status: model.status,
    shelf: modelShelf(model),
    projectId: model.projectId,
    projectName: model.summary?.projectName ?? null,
    elements: model.summary?.totals.elements ?? model.elementCount,
    storeys: model.summary?.totals.storeys ?? 0,
  }
}

export interface UnresolvedModel {
  resolved: false
  reason: 'no_match' | 'ambiguous' | 'not_ready' | 'no_models' | 'no_own_model'
  message: string
  models: ReturnType<typeof describeModel>[]
}

export interface ResolvedModel {
  resolved: true
  model: BimModelHeader
  readable: BimModelHeader[]
}

export interface InternalModelQuery {
  organizationId: string
  projectId?: string
  modelId?: string
  modelName?: string
}

export async function resolveInternalModel(
  input: InternalModelQuery
): Promise<ResolvedModel | UnresolvedModel> {
  const candidates = await listBimModels(input.organizationId, {
    projectId: input.projectId ?? null,
    includeOfficeShelf: true,
    limit: 200,
    hiddenFolderIds: input.projectId ? await getRestrictedFolderIds(input.organizationId, input.projectId) : [],
    reader: SCREENED_ONLY,
  })
  const readable = candidates.filter((model) => model.status === 'ready')

  if (input.modelId) {
    const selected = candidates.find((model) => model.id === input.modelId)
    if (!selected) throw new NotFoundError('Model not found in this organization')
    if (selected.status !== 'ready') {
      return {
        resolved: false,
        reason: 'not_ready',
        message:
          selected.status === 'failed'
            ? 'Dieses IFC-Modell konnte nicht gelesen werden.'
            : 'Dieses IFC-Modell wird derzeit verarbeitet. Es steht noch nicht zur Abfrage bereit.',
        models: [describeModel(selected)],
      }
    }
    return { resolved: true, model: selected, readable }
  }

  if (input.modelName) {
    const needle = input.modelName.toLowerCase()
    const matches = readable.filter((model) => model.filename.toLowerCase().includes(needle))
    if (matches.length === 0) {
      return {
        resolved: false,
        reason: 'no_match',
        message: `Kein Modell mit dem Namen „${input.modelName}“ gefunden.`,
        models: readable.map(describeModel),
      }
    }
    if (matches.length > 1) {
      return {
        resolved: false,
        reason: 'ambiguous',
        message: `Mehrere Modelle passen auf „${input.modelName}“. Bitte eines auswählen.`,
        models: matches.map(describeModel),
      }
    }
    return { resolved: true, model: matches[0], readable }
  }

  const own = input.projectId ? readable.filter((model) => modelShelf(model) === 'project') : readable
  if (own.length === 1) return { resolved: true, model: own[0], readable }

  if (own.length === 0 && readable.length > 0) {
    const ownPending = input.projectId ? candidates.filter((model) => modelShelf(model) === 'project') : []
    if (ownPending.length > 0) {
      return {
        resolved: false,
        reason: 'not_ready',
        message: 'This project has an IFC model that is still being processed. It is not ready to query yet.',
        models: ownPending.map(describeModel),
      }
    }
    return {
      resolved: false,
      reason: 'no_own_model',
      message:
        'This project has no IFC model of its own. The office shelf holds models that belong to no project; ' +
        'they are read only with `model_name`.',
      models: readable.map(describeModel),
    }
  }

  if (readable.length === 0) {
    return {
      resolved: false,
      reason: candidates.length > 0 ? 'not_ready' : 'no_models',
      message:
        candidates.length > 0
          ? 'Für dieses Projekt wird derzeit ein IFC-Modell verarbeitet. Es steht noch nicht zur Abfrage bereit.'
          : 'Für dieses Projekt ist kein IFC-Modell hinterlegt.',
      models: candidates.map(describeModel),
    }
  }

  return {
    resolved: false,
    reason: 'ambiguous',
    message: 'Für dieses Projekt gibt es mehrere IFC-Modelle. Bitte eines auswählen.',
    models: own.map(describeModel),
  }
}

export interface InternalModelSource {
  url: string
  expiresInSeconds: number
  bytes: number | null
  etag: string | null
}

const presignTtlSeconds = (): number => Number(process.env.SEAWEED_PRESIGNED_URL_TTL_SECONDS || 600)

export async function getInternalModelSource(
  model: BimModelHeader,
  organizationId: string
): Promise<InternalModelSource> {
  const document = await findDocumentInOrg(model.documentId, organizationId, SCREENED_ONLY)
  if (!document?.storageKey) throw new NotFoundError('Model file not available')

  const bucket = resolveDocumentBucket(document.storageBucket)
  const expiresIn = presignTtlSeconds()

  let bytes: number | null = null
  let etag: string | null = null
  try {
    const head = await s3Client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: document.storageKey })
    )
    bytes = typeof head.ContentLength === 'number' ? head.ContentLength : null
    etag = head.ETag ? head.ETag.replace(/"/g, '') : null
  } catch {
    // Left null.
  }

  const url = await getSignedUrl(
    s3Client,
    new GetObjectCommand({ Bucket: bucket, Key: document.storageKey }),
    { expiresIn }
  )
  return { url, expiresInSeconds: expiresIn, bytes, etag }
}
