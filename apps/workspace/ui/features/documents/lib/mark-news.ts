import { inboxClient, type InboxClient } from '@/lib/inbox/client'

export function readMarkNews(documentId: string, annotationId: string, client: InboxClient = inboxClient): void {
  void client.markMarkRead({ documentId, annotationId }).catch(() => undefined)
}
