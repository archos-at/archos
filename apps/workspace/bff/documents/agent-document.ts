import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import { NotFoundError } from '@/lib/api/errors'
import type { DocumentVersion } from '@/lib/db/schema/document-versions'
import { getOrganizationDisplayName } from '@/lib/organizations/service'
import { AGENT_DOCUMENT_MEDIA_TYPE, renderAgentDocumentMarkdown } from './agent-document-markdown'
import { resolveDocumentBranding } from './branding'
import { contentDigest } from './content-digest'
import { fileGeneratedDocument } from './generated'
import { AGENT_REFUSAL_LOCALE } from '@/lib/conversations/restricted-egress'
import type { Locale } from '@/i18n/config'
import { createDocumentVersion } from './lifecycle'
import { findDocumentInOrg } from './repository'
import { internalRead } from '@/lib/documents/document-reader'
import { findOpenVersion } from './version-repository'

export { AGENT_DOCUMENT_MEDIA_TYPE, renderAgentDocumentMarkdown }

export interface FileAgentDocumentDraftInput {
  session: AuthorizedSession
  projectId: string
  ref: string
  title: string
  content: string
  request?: Request
  actingHuman?: boolean
  originConversationId?: string | null
  locale?: Locale
}

export interface FiledAgentDocumentDraft {
  documentId: string
  version: DocumentVersion
  alreadyFiled: boolean
}

export async function fileAgentDocumentDraft(
  input: FileAgentDocumentDraftInput,
): Promise<FiledAgentDocumentDraft> {
  const organizationName = await getOrganizationDisplayName(input.session.organizationId)
  const branding = await resolveDocumentBranding({
    organizationId: input.session.organizationId,
    organizationName,
  })

  const filed = await fileGeneratedDocument({
    session: input.session,
    projectId: input.projectId,
    producer: 'agent_document',
    ref: input.ref,
    title: input.title,
    request: input.request,
    render: ({ marking }) => renderAgentDocumentMarkdown(input.content, marking, branding),
    origin: {
      conversationId: input.originConversationId ?? null,
      locale: input.locale ?? AGENT_REFUSAL_LOCALE,
    },
  })

  const document = await findDocumentInOrg(filed.documentId, input.session.organizationId, internalRead('just-written'))
  if (!document) throw new NotFoundError('Document not found')

  if (filed.alreadyFiled) {
    const existing = await findOpenVersion(document.id, input.session.organizationId)
    if (existing) return { documentId: document.id, version: existing, alreadyFiled: true }
  }

  const version = await createDocumentVersion(input.session, {
    document,
    op: 'create',
    storageKey: document.storageKey,
    storageBucket: document.storageBucket,
    contentType: document.contentType,
    fileSize: document.fileSize,
    contentHash: document.contentHash ?? contentDigest(new TextEncoder().encode(input.content)),
    request: input.request,
    actingHuman: input.actingHuman,
    originConversationId: input.originConversationId,
  })
  return { documentId: document.id, version, alreadyFiled: false }
}
