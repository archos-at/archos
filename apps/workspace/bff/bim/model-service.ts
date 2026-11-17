import 'server-only'
import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { s3Client, signingS3Client } from '@/lib/s3'
import { recordDocumentAccess } from '@/lib/download-log/service'
import { resolveDocumentBucket } from '@/lib/storage/bucket'
import { requireProjectAccess, type ProjectPermission } from '@/lib/authz/projects'
import { getHiddenFolderIds, isFolderVisibleTo } from '@/lib/authz/folder-access'

const BIM_WRITE: readonly ProjectPermission[] = ['project:documents:write', 'project:edit']
import { requireResourceAccess } from '@/lib/sharing/access'
import { isIfcModelsEnabled } from '@/lib/authz/feature-flags'
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/api/errors'
import { contextForPage } from '@/lib/base-knowledge/context/service'
import { findDocumentForSession, getAccessibleDocument } from '@/lib/documents/access'
import { internalRead, type DocumentReader } from '@/lib/documents/document-reader'
import { shelfReaderFor } from '@/lib/upload-screening/quarantine-reviewers'
import type { Document } from '@/lib/db/schema/documents'
import { findProjectInOrg } from '@/lib/projects/repository'
import type { AuthorizedSession } from '@/lib/auth/types'
import { buildComplianceBcf, type BcfExport } from './bcf'
import { buildBimDerivedKeys } from './service'
import { attachConfirmations, BIM_RULES, canonicalBimRuleId } from './rules'
import { ruleBasis } from './rule-basis'
import { revisionSeriesKey } from './revision-series'
import {
  deleteBimCheckConfirmation,
  findBimModelByDocument,
  findBimModelById,
  listBimCheckConfirmations,
  listBimModels,
  upsertBimCheckConfirmation,
  type BimModelHeader,
  type BimStoredConfirmation,
} from './repository'
import { runBimQuery, type BimMainUse, type BimQuery, type BimQueryResult } from './query'

const presignTtlSeconds = (): number => Number(process.env.SEAWEED_PRESIGNED_URL_TTL_SECONDS || 600)

export function assertIfcModelsEnabled(session: AuthorizedSession): void {
  if (!isIfcModelsEnabled(session)) {
    throw new ForbiddenError('IFC models are not enabled for this organization')
  }
}

async function assertDocumentReadable(
  session: AuthorizedSession,
  document: Document,
  notFoundMessage: string
): Promise<void> {
  switch (document.scope) {
    case 'office_shelf':
      return
    case 'session':
      if (!document.conversationId) throw new NotFoundError(notFoundMessage)
      await requireResourceAccess(session, 'conversation', document.conversationId, 'viewer')
      return
    case 'project': {
      if (document.projectId === null) throw new NotFoundError(notFoundMessage)
      await requireProjectAccess(session, document.projectId, 'project:view')
      if (!(await isFolderVisibleTo(session, document.projectId, document.folderId))) {
        throw new NotFoundError(notFoundMessage)
      }
      return
    }
    default: {
      const unreachable: never = document.scope
      throw new NotFoundError(`Unknown document scope: ${String(unreachable)}`)
    }
  }
}

export async function getAccessibleModel(
  session: AuthorizedSession,
  modelId: string
): Promise<BimModelHeader> {
  assertIfcModelsEnabled(session)
  const model = await findBimModelById(modelId, session.organizationId, internalRead('resolve-document'))
  if (!model) throw new NotFoundError('Model not found')

  const document = await findDocumentForSession(session, model.documentId)
  if (!document) throw new NotFoundError('Model not found')

  await assertDocumentReadable(session, document, 'Model not found')
  return model
}

export async function getModelForDocument(
  session: AuthorizedSession,
  documentId: string
): Promise<BimModelHeader | null> {
  assertIfcModelsEnabled(session)
  const document = await findDocumentForSession(session, documentId)
  if (!document) throw new NotFoundError('Document not found')
  await assertDocumentReadable(session, document, 'Document not found')
  return findBimModelByDocument(documentId, session.organizationId, internalRead('reloaded'))
}

async function modelListReader(session: AuthorizedSession, projectId: string): Promise<DocumentReader> {
  const [project, officeShelf] = await Promise.all([
    shelfReaderFor(session, { scope: 'project', projectId }),
    shelfReaderFor(session, { scope: 'office_shelf', projectId: null }),
  ])
  return { kind: 'shelves', project, officeShelf: officeShelf }
}

export async function listAccessibleModels(
  session: AuthorizedSession,
  projectId: string
): Promise<BimModelHeader[]> {
  assertIfcModelsEnabled(session)
  await requireProjectAccess(session, projectId, 'project:view')
  return listBimModels(session.organizationId, {
    projectId,
    includeOfficeShelf: true,
    hiddenFolderIds: await getHiddenFolderIds(session, projectId),
    reader: await modelListReader(session, projectId),
  })
}

export async function queryAccessibleModel(
  session: AuthorizedSession,
  modelId: string,
  request: BimQuery
): Promise<BimQueryResult> {
  const model = await getAccessibleModel(session, modelId)
  const baseModelId = 'baseModelId' in request ? request.baseModelId : undefined
  if (typeof baseModelId === 'string' && baseModelId !== model.id) {
    await getAccessibleModel(session, baseModelId)
  }
  return runBimQuery(request, { modelId: model.id, organizationId: session.organizationId })
}

export interface BimModelSource {
  url: string
  filename: string
  expiresInSeconds: number
}

async function hasObject(bucket: string, storageKey: string): Promise<string | null> {
  const keys = buildBimDerivedKeys(storageKey)
  if (!keys) return null
  try {
    await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: keys.sourceKey }))
    return keys.sourceKey
  } catch {
    return null
  }
}

export async function getModelSource(
  session: AuthorizedSession,
  modelId: string
): Promise<BimModelSource> {
  const model = await getAccessibleModel(session, modelId)
  const document = await getAccessibleDocument(session, model.documentId, 'read')
  if (!document.storageKey) throw new NotFoundError('Model file not available')

  const expiresIn = presignTtlSeconds()
  const bucket = resolveDocumentBucket(document.storageBucket)
  const key = (await hasObject(bucket, document.storageKey)) ?? document.storageKey
  const url = await getSignedUrl(
    signingS3Client,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn }
  )
  await recordDocumentAccess(session, document, 'model')
  return { url, filename: document.filename, expiresInSeconds: expiresIn }
}

async function revisionSiblingIds(
  session: AuthorizedSession,
  projectId: string,
  model: { id: string; filename: string }
): Promise<string[]> {
  const series = revisionSeriesKey(model.filename)
  const models = await listBimModels(session.organizationId, {
    projectId,
    includeOfficeShelf: true,
    limit: 200,
    reader: await modelListReader(session, projectId),
  })
  const ids = models
    .filter((candidate) => revisionSeriesKey(candidate.filename) === series)
    .map((candidate) => candidate.id)
  return ids.includes(model.id) ? ids : [...ids, model.id]
}

export async function listAccessibleCheckConfirmations(
  session: AuthorizedSession,
  projectId: string
): Promise<BimStoredConfirmation[]> {
  assertIfcModelsEnabled(session)
  await requireProjectAccess(session, projectId, 'project:view')
  return listBimCheckConfirmations(session.organizationId, projectId, await modelListReader(session, projectId))
}

function assertModelInProject(model: BimModelHeader, projectId: string): void {
  if (model.projectId !== null && model.projectId !== projectId) {
    throw new NotFoundError('Model not found in this project')
  }
}

export async function confirmAccessibleCheck(
  session: AuthorizedSession,
  projectId: string,
  input: { ruleId: string; modelId: string; note: string | null }
): Promise<void> {
  assertIfcModelsEnabled(session)
  await requireProjectAccess(session, projectId, BIM_WRITE)
  const model = await getAccessibleModel(session, input.modelId)
  assertModelInProject(model, projectId)
  const ruleId = canonicalBimRuleId(input.ruleId)
  const rule = BIM_RULES.find((candidate) => candidate.id === ruleId)
  if (rule && ruleBasis(rule, await contextForPage(session.organizationId, projectId)).kind === 'hint') {
    throw new ConflictError('The rule gives a hint at this project site, not a verdict, so there is nothing to confirm')
  }
  await upsertBimCheckConfirmation({
    organizationId: session.organizationId,
    projectId,
    ruleId,
    modelId: model.id,
    confirmedBy: session.userId,
    note: input.note,
  })
}

async function resolveModelByName(
  session: AuthorizedSession,
  projectId: string,
  name: string
): Promise<BimModelHeader> {
  const models = (
    await listBimModels(session.organizationId, {
      projectId,
      includeOfficeShelf: true,
      limit: 200,
      hiddenFolderIds: await getHiddenFolderIds(session, projectId),
      reader: await modelListReader(session, projectId),
    })
  ).filter((model) => model.status === 'ready')
  const needle = name.trim().toLowerCase()
  const model =
    models.find((entry) => entry.filename.toLowerCase() === needle) ??
    models.find((entry) => entry.filename.toLowerCase().includes(needle))
  if (!model) throw new NotFoundError('Model not found in this project')
  return model
}

export async function exportAccessibleComplianceBcf(
  session: AuthorizedSession,
  projectId: string,
  input: {
    modelId: string | null
    modelName?: string | null
    buildingClass: number | null
    mainUse: BimMainUse | null
  }
): Promise<BcfExport> {
  assertIfcModelsEnabled(session)
  await requireProjectAccess(session, projectId, 'project:view')

  const model = input.modelId
    ? await getAccessibleModel(session, input.modelId)
    : await resolveModelByName(session, projectId, input.modelName ?? '')
  assertModelInProject(model, projectId)

  const [result, confirmations, project] = await Promise.all([
    runBimQuery(
      {
        op: 'compliance',
        buildingClass: input.buildingClass,
        mainUse: input.mainUse,
      },
      { modelId: model.id, organizationId: session.organizationId }
    ),
    listBimCheckConfirmations(session.organizationId, projectId, await modelListReader(session, projectId)),
    findProjectInOrg(projectId, session.organizationId),
  ])

  const results = attachConfirmations(
    result.compliance ?? [],
    confirmations.map((entry) => ({
      ruleId: entry.ruleId,
      modelId: entry.modelId,
      confirmedBy: entry.confirmedBy,
      note: entry.note,
      confirmedAt: entry.confirmedAt.toISOString(),
    })),
    model.id,
    await revisionSiblingIds(session, projectId, model)
  )

  const root = model.summary?.spatial
  return buildComplianceBcf({
    projectId,
    projectName: project?.name ?? null,
    model: {
      id: model.id,
      filename: model.filename,
      ifcProjectGlobalId: root?.ifcType === 'IfcProject' ? root.globalId : null,
      updatedAt: model.updatedAt,
    },
    results,
    author: session.email,
  })
}

export async function withdrawAccessibleCheck(
  session: AuthorizedSession,
  projectId: string,
  ruleId: string,
  modelId: string
): Promise<void> {
  assertIfcModelsEnabled(session)
  await requireProjectAccess(session, projectId, BIM_WRITE)
  const model = await getAccessibleModel(session, modelId)
  assertModelInProject(model, projectId)
  await deleteBimCheckConfirmation({
    organizationId: session.organizationId,
    projectId,
    ruleId: canonicalBimRuleId(ruleId),
    modelIds: await revisionSiblingIds(session, projectId, model),
  })
}
