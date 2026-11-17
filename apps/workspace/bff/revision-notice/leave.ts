import 'server-only'
import { ensureDocumentThread } from '@/lib/annotations/document-thread'
import type { AuthorizedSession } from '@/lib/auth/types'
import { insertMessages } from '@/lib/conversations/repository'
import type { Document } from '@/lib/db/schema/documents'
import { documentDisplayName } from '@/lib/documents/display-name'
import { inboxGroupKey } from '@/lib/inbox/registry'
import { emitInboxItems } from '@/lib/inbox/service'

export interface NoticeLeaving {
  session: AuthorizedSession
  newer: Document
  conversationId: string
  messageId: string
  content: string
  metadata: Record<string, unknown>
  marks: ReadonlyArray<{ id: string }>
  excerpt: string | null
  variant: string
  related?: string
}

export const noticeThread = (session: AuthorizedSession, newer: Document): Promise<string> =>
  ensureDocumentThread(session, newer)

export async function leaveNotice(input: NoticeLeaving): Promise<void> {
  const { session, newer } = input
  await insertMessages([
    {
      id: input.messageId,
      conversationId: input.conversationId,
      role: 'assistant',
      content: input.content,
      metadata: { messageType: 'agent_response', ...input.metadata },
    },
  ])
  const first = input.marks[0]
  if (!first) return
  await emitInboxItems([
    {
      organizationId: session.organizationId,
      recipientUserId: session.userId,
      type: 'piloti.revision_checked',
      resourceType: 'document',
      resourceId: newer.id,
      anchorId: first.id,
      actorUserId: null,
      groupKey: inboxGroupKey('piloti.revision_checked', 'document', newer.id, first.id),
      payload: {
        subject: documentDisplayName(newer),
        ...(input.related ? { related: input.related } : {}),
        openMarks: input.marks.length,
        variant: input.variant,
        ...(input.excerpt ? { excerpt: input.excerpt } : {}),
      },
    },
  ]).catch((error: unknown) => console.warn('[revision-notice] the inbox row could not be written', error))
}
