import 'server-only'
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { isUniqueViolation } from '@/lib/db/errors'
import { bucketAdminS3Client, buildStorageKey, s3Client } from '@/lib/s3'
import { agentDocumentFilename, isNamespacedAgentDocument } from './agent-namespace'
import { ensureTenantBucketChecked } from '@/lib/storage/bucket'
import { admitOrDiscard } from '@/lib/storage/admission'
import { requireProjectAccess } from '@/lib/authz/projects'
import { placementCollectionFor, requireFolderWrite } from '@/lib/authz/folder-access'
import { aiProvenanceMarking, markingIsInBytes, type AiProvenanceMarking } from '@/lib/ai-provenance'
import { fileSlug } from '@/lib/text/latinize'
import { FEATURE_FLAGS, isAgentAuthoredDocumentsEnabled } from '@/lib/authz/feature-flags'
import { recordAuditEventOrThrow } from '@/lib/audit/service'
import { ForbiddenError, NotFoundError } from '@/lib/api/errors'
import { findProjectInOrg } from '@/lib/projects/repository'
import { findRootProjectFolderByName, getOrCreateProjectFolderByName } from '@/lib/projects/folder-service'
import { requireMayFileFrom, type ConversationOrigin } from '@/lib/conversations/restricted-egress'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { AuthoredRefKind } from './document-authors'
import { deleteProjectDocument, findDocumentAuthoredByRef } from './repository'
import { projectShelf } from './shelf'
import { publishShelfChanged } from './shelf-live'

export const GENERATED_DOCUMENT_PRODUCER_REF_KINDS = {
  deep_research: 'agent_run',
  diagram_svg: 'answer_artifact',
  diagram_pdf: 'answer_artifact',
  agent_document: 'answer_artifact',
} as const satisfies Record<string, AuthoredRefKind>

export type GeneratedDocumentProducer = keyof typeof GENERATED_DOCUMENT_PRODUCER_REF_KINDS

export const GENERATED_DOCUMENT_PRODUCERS = Object.keys(
  GENERATED_DOCUMENT_PRODUCER_REF_KINDS,
) as readonly GeneratedDocumentProducer[]

const REF_KIND_IS_A_RUN: Record<AuthoredRefKind, boolean> = {
  agent_run: true,
  answer_artifact: false,
}

export function generatedDocumentMarking(
  producer: GeneratedDocumentProducer,
  ref: string,
): AiProvenanceMarking {
  const refKind = GENERATED_DOCUMENT_PRODUCER_REF_KINDS[producer]
  return aiProvenanceMarking(REF_KIND_IS_A_RUN[refKind] ? { runId: ref } : {})
}

export class UnmarkedRenderingError extends Error {
  constructor(readonly producer: GeneratedDocumentProducer, readonly contentType: string) {
    super(`${producer} rendered ${contentType} bytes that do not carry the AI marking`)
    this.name = 'UnmarkedRenderingError'
  }
}

const AUTHORED_REF_INDEX = 'uniq_documents_authored_ref_producer_per_project'

export interface GeneratedRenderContext {
  projectId: string
  projectName: string
  marking: AiProvenanceMarking
}

export interface GeneratedRendering {
  bytes: Uint8Array
  contentType: string
  marking: AiProvenanceMarking
}

export interface FileGeneratedDocumentInput {
  session: AuthorizedSession
  projectId: string
  producer: GeneratedDocumentProducer
  ref: string
  title: string
  render: (context: GeneratedRenderContext) => Promise<GeneratedRendering> | GeneratedRendering
  request?: Request
  origin?: ConversationOrigin
}

export interface FiledGeneratedDocument {
  documentId: string
  filename: string
  folderId: string | null
  alreadyFiled: boolean
}

export const GENERATED_DOCUMENT_FOLDER_NAME = 'Berichte'

export interface GeneratedDocumentDestination {
  folderName: string
}

export function resolveGeneratedDocumentDestination(
  _producer: GeneratedDocumentProducer,
): GeneratedDocumentDestination {
  return { folderName: GENERATED_DOCUMENT_FOLDER_NAME }
}

const EXTENSION_BY_CONTENT_TYPE: Readonly<Record<string, string>> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/pdf': 'pdf',
  'text/markdown': 'md',
  'application/json': 'json',
  'image/svg+xml': 'svg',
}

export function generatedFilename(title: string, contentType: string, now: Date): string {
  const day = now.toISOString().slice(0, 10)
  const slug = fileSlug(title)
  const extension = EXTENSION_BY_CONTENT_TYPE[contentType.split(';')[0].trim()] ?? 'bin'
  return `${slug || 'document'}-${day}.${extension}`
}

export async function assertMayFileGeneratedDocument(session: AuthorizedSession, projectId: string): Promise<void> {
  if (!isAgentAuthoredDocumentsEnabled(session)) {
    throw new ForbiddenError('Agent-authored documents are disabled', {
      feature: FEATURE_FLAGS.agentAuthoredDocuments,
    })
  }

  await requireProjectAccess(session, projectId, ['project:documents:write', 'project:edit'])
  await requireProjectAccess(session, projectId, 'project:documents:generate')

  const destination = await findRootProjectFolderByName(projectId, GENERATED_DOCUMENT_FOLDER_NAME, session.organizationId)
  await requireFolderWrite(session, projectId, [destination?.id ?? null])
}

export async function fileGeneratedDocument(
  input: FileGeneratedDocumentInput,
): Promise<FiledGeneratedDocument> {
  const { session, projectId, producer, ref, title, render, request, origin } = input
  const refKind = GENERATED_DOCUMENT_PRODUCER_REF_KINDS[producer]

  await assertMayFileGeneratedDocument(session, projectId)

  const existing = await findDocumentAuthoredByRef(ref, session.organizationId, projectId, producer)
  if (existing) {
    return {
      documentId: existing.id,
      filename: existing.filename,
      folderId: existing.folderId,
      alreadyFiled: true,
    }
  }

  const project = await findProjectInOrg(projectId, session.organizationId)
  if (!project) throw new NotFoundError('Project not found')

  const existingDestination = await findRootProjectFolderByName(
    projectId,
    resolveGeneratedDocumentDestination(producer).folderName,
    session.organizationId,
  )
  if (origin) {
    const destination = existingDestination
    await requireMayFileFrom(origin, {
      organizationId: session.organizationId,
      projectId,
      projectCollection: project.collectionName,
      folderId: destination?.id ?? null,
    })
  }

  const marking = generatedDocumentMarking(producer, ref)
  const rendered = await render({ projectId, projectName: project.name, marking })

  if (rendered.marking !== marking || !markingIsInBytes(rendered.bytes, marking)) {
    throw new UnmarkedRenderingError(producer, rendered.contentType)
  }

  const destination = resolveGeneratedDocumentDestination(producer)
  const folder = await getOrCreateProjectFolderByName(projectId, destination.folderName, session.organizationId)
  if (folder.id !== existingDestination?.id) await requireFolderWrite(session, projectId, [folder.id])

  const documentId = crypto.randomUUID()
  const storedName = generatedFilename(title, rendered.contentType, new Date())
  const filename = isNamespacedAgentDocument({ authoredByProducer: producer })
    ? agentDocumentFilename(documentId, storedName)
    : storedName
  const storageKey = buildStorageKey(session.organizationId, projectId, documentId, storedName, folder.path)

  const storageBucket = await ensureTenantBucketChecked(bucketAdminS3Client, session.organizationId)

  const body = Buffer.from(rendered.bytes)
  await s3Client.send(
    new PutObjectCommand({
      Bucket: storageBucket,
      Key: storageKey,
      Body: body,
      ContentType: rendered.contentType,
    }),
  )

  try {
    await admitOrDiscard(storageBucket, storageKey, {
      id: documentId,
      organizationId: session.organizationId,
      projectId,
      folderId: folder.id,
      createdBy: session.userId,
      authoredBy: 'agent',
      authoredByProducer: producer,
      authoredByRef: ref,
      authoredByRefKind: refKind,
      filename,
      displayName: title.trim() || storedName,
      storageKey,
      storageBucket,
      collectionName: await placementCollectionFor(session.organizationId, projectId, project.collectionName, folder.id),
      fileSize: body.byteLength,
      contentType: rendered.contentType,
      status: 'stored',
    })
  } catch (error) {
    if (!isUniqueViolation(error, AUTHORED_REF_INDEX)) throw error

    const winner = await findDocumentAuthoredByRef(ref, session.organizationId, projectId, producer)
    if (!winner) throw error

    return {
      documentId: winner.id,
      filename: winner.filename,
      folderId: winner.folderId,
      alreadyFiled: true,
    }
  }

  try {
    await recordAuditEventOrThrow({
      organizationId: session.organizationId,
      actor: { type: 'agent', userId: session.userId, email: session.email, ref: { kind: refKind, id: ref } },
      action: 'document.generated',
      targetType: 'document',
      targetId: documentId,
      filedIn: { projectId, folderId: folder.id },
      metadata: { projectId, producer, filename, fileSize: body.byteLength },
      request,
    })
  } catch (error) {
    await unfile(documentId, projectId, session.organizationId, storageBucket, storageKey)
    throw error
  }

  return { documentId, filename, folderId: folder.id, alreadyFiled: false }
}

async function unfile(
  documentId: string,
  projectId: string,
  organizationId: string,
  bucket: string,
  storageKey: string,
): Promise<void> {
  try {
    await deleteProjectDocument(documentId, organizationId, projectId)
    publishShelfChanged(organizationId, projectShelf(projectId))
  } catch (error) {
    console.error(
      '[documents] failed to delete the row of a generated document after its audit write failed; ' +
        'its object is deliberately LEFT so the document still opens — delete it through the application',
      { documentId, bucket, storageKey, cause: error instanceof Error ? error.name : 'unknown' },
    )
    return
  }

  try {
    await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: storageKey }))
  } catch (error) {
    console.error(
      '[documents] failed to delete the object of a generated document after its audit write failed; ' +
        'the row is gone, so this is an orphan object for the project purge',
      { documentId, bucket, storageKey, cause: error instanceof Error ? error.name : 'unknown' },
    )
  }
}
