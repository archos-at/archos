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
import { getAccessibleDocument } from '@/lib/documents/access'
import { listReviewCandidates, matchReviewCandidate } from '@/lib/documents/reviewers'
import {
  replaceVersionContent,
  toDocumentVersionView,
  transitionDocumentVersion,
} from '@/lib/documents/lifecycle'
import {
  internalDocumentVersionRequestSchema,
  type InternalDocumentVersionRequest,
} from '@/lib/documents/lifecycle-types'
import type { AuthorizedSession } from '@/lib/auth/types'
import { AGENT_REFUSAL_LOCALE } from '@/lib/conversations/restricted-egress'

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

  if (body.op === 'update') {
    const version = await replaceVersionContent(
      session,
      body.documentId,
      body.versionId,
      body.content,
      body.ifMatch,
      {
        request,
        actingHuman: false,
        origin: {
          conversationId: context.conversationId,
          locale: AGENT_REFUSAL_LOCALE,
        },
      },
    )
    return { documentId: body.documentId, version: toDocumentVersionView(version) }
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
