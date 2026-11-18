import { internalApiRoute, parseJsonBody } from '@/lib/api/handler'
import {
  requireEnvelopeProject,
  requirePinnedSession,
  requireVerifiedContext,
} from '@/lib/api/internal-envelope'
import { withTenant } from '@/lib/db/tenant-context'
import type { VerifiedRequestContext } from '@/lib/request-context'
import { BadRequestError } from '@/lib/api/errors'
import { fileAgentDocumentDraft } from '@/lib/documents/agent-document'
import { fileAgentFileDraft } from '@/lib/documents/agent-file'
import { agentDestination } from '@/lib/documents/agent-folder'
import { reviseWithAgentWork, type AgentWork } from '@/lib/documents/agent-file-revision'
import { decodeAgentFileBase64 } from '@/lib/documents/agent-file-check'
import { getAccessibleDocument } from '@/lib/documents/access'
import { findOpenVersion, findPublishedVersion } from '@/lib/documents/version-repository'
import { listReviewCandidates, matchReviewCandidate } from '@/lib/documents/reviewers'
import { toDocumentVersionView, transitionDocumentVersion } from '@/lib/documents/lifecycle'
import {
  internalDocumentVersionRequestSchema,
  type InternalDocumentVersionRequest,
} from '@/lib/documents/lifecycle-types'
import type { AuthorizedSession } from '@/lib/auth/types'
import { AGENT_REFUSAL_LOCALE } from '@/lib/conversations/restricted-egress'

async function reviseOp(
  session: AuthorizedSession,
  request: Request,
  context: VerifiedRequestContext,
  input: {
    documentId: string
    work: AgentWork
    ifMatch?: string
    ownVersionId?: string
    changeNote?: string
    own: boolean
  },
) {
  if (!context.projectId) throw new BadRequestError('This request names no project', { reason: 'no-project' })
  const revised = await reviseWithAgentWork(session, {
    documentId: input.documentId,
    projectId: context.projectId,
    work: input.work,
    ifMatch: input.ifMatch,
    ownVersionId: input.ownVersionId,
    changeNote: input.changeNote,
    agentFiledOnly: input.own,
    options: {
      request,
      actingHuman: false,
      origin: { conversationId: context.conversationId, locale: AGENT_REFUSAL_LOCALE },
    },
  })
  return {
    documentId: revised.document.id,
    folderId: revised.document.folderId,
    forked: revised.forked,
    version: toDocumentVersionView(revised.version),
  }
}

async function runOp(
  session: AuthorizedSession,
  body: InternalDocumentVersionRequest,
  request: Request,
  context: VerifiedRequestContext,
) {
  if (body.op === 'create') {
    requireEnvelopeProject(context, body.projectId)
    const filed = await fileAgentDocumentDraft({
      session,
      projectId: body.projectId,
      ref: body.ref,
      title: body.title,
      content: body.content,
      folderId: await agentDestination(session, body.projectId, { folder: body.folder }),
      request,
      actingHuman: false,
      originConversationId: context.conversationId,
    })
    return {
      documentId: filed.documentId,
      alreadyFiled: filed.alreadyFiled,
      version: toDocumentVersionView(filed.version),
    }
  }

  if (body.op === 'create_file') {
    requireEnvelopeProject(context, body.projectId)
    const filed = await fileAgentFileDraft({
      session,
      projectId: body.projectId,
      ref: body.ref,
      title: body.title,
      filename: body.filename,
      folderId: await agentDestination(session, body.projectId, {
        folder: body.folder,
        sourceDocumentId: body.sourceDocumentId,
      }),
      contentType: body.contentType,
      bytes: decodeAgentFileBase64(body.contentBase64),
      request,
      actingHuman: false,
      originConversationId: context.conversationId,
    })
    return {
      documentId: filed.documentId,
      alreadyFiled: filed.alreadyFiled,
      folderId: filed.folderId,
      version: toDocumentVersionView(filed.version),
    }
  }

  if (body.op === 'status') {
    const document = await getAccessibleDocument(session, body.documentId)
    const current =
      (await findOpenVersion(document.id, session.organizationId)) ??
      (await findPublishedVersion(document.id, session.organizationId))
    return { documentId: document.id, version: current ? toDocumentVersionView(current) : null }
  }

  if (body.op === 'update_file' || body.op === 'revise_file') {
    const file = { contentType: body.contentType, bytes: decodeAgentFileBase64(body.contentBase64) }
    return reviseOp(session, request, context, {
      documentId: body.documentId,
      work: { kind: 'file', file },
      ...(body.op === 'update_file'
        ? { ifMatch: body.ifMatch, ownVersionId: body.versionId, own: true }
        : { ifMatch: body.ifMatch, ownVersionId: body.versionId, changeNote: body.changeNote, own: false }),
    })
  }

  if (body.op === 'update') {
    return reviseOp(session, request, context, {
      documentId: body.documentId,
      work: { kind: 'markdown', content: body.content },
      ifMatch: body.ifMatch,
      ownVersionId: body.versionId,
      own: true,
    })
  }

  const version = await transitionDocumentVersion(
    session,
    body.documentId,
    body.versionId,
    'submit',
    {
      reviewerUserIds: await resolveNamedReviewers(session, body),
      request,
      actingHuman: false,
    },
  )
  return { documentId: body.documentId, version: toDocumentVersionView(version) }
}

async function resolveNamedReviewers(
  session: AuthorizedSession,
  body: Extract<InternalDocumentVersionRequest, { op: 'submit' }>,
): Promise<readonly string[]> {
  if (body.reviewerUserIds.length > 0) return body.reviewerUserIds
  if (!body.reviewer) return []
  const document = await getAccessibleDocument(session, body.documentId, 'write')
  const candidates = await listReviewCandidates(session, document)
  const match = matchReviewCandidate(candidates, body.reviewer)
  if (match.ok) return [match.userId]
  throw new BadRequestError(
    match.reason === 'unknown'
      ? `Niemand in diesem Projekt heißt „${body.reviewer}“. Ohne Namen geht der Entwurf an alle Bearbeiter.`
      : `„${body.reviewer}“ ist in diesem Projekt mehrfach vergeben — bitte die E-Mail-Adresse angeben.`,
    { reviewer: body.reviewer },
  )
}

export const POST = internalApiRoute(
  'document-versions',
  async ({ request }) => {
    const context = requireVerifiedContext(request)
    const body = await parseJsonBody(request, internalDocumentVersionRequestSchema)
    const session = await requirePinnedSession(context)
    return withTenant({ organizationId: context.organizationId }, () =>
      runOp(session, body, request, context),
    )
  },
  {
    tenancy: {
      fromPayload:
        'the verified X-Grid-Request-Context envelope (organizationId), never the request body',
    },
    status: 201,
  },
)
