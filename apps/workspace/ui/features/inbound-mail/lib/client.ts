import {
  createInboundMailAddress,
  deleteInboundMailAddress,
  dismissInboundMails,
  fileInboundMails,
  getInboundMail,
  getInboundMailAddress,
  getInboundMailText,
  inboundMailOriginalUrl,
  inboundMailPartContentUrl,
  listInboundMails,
  reportInboundMail,
  restoreInboundMail,
  rotateInboundMailAddress,
  setInboundMailForwardedFrom,
} from '@/adapters/api/inbound-mail-client'
import { followMailThread, listMailThreads, unfollowMailThread } from '@/adapters/api/mail-thread-client'
import type {
  DismissInboundMailsBody,
  FileInboundMailsBody,
  InboundMailAddressView,
  InboundMailDecisionResultView,
  InboundMailListQuery,
  InboundMailListView,
  InboundMailReportResultView,
  InboundMailTextView,
  InboundMailView,
} from '@/lib/inbound-mail/inbound-mail-wire'
import type { MailThreadFollowBody, MailThreadSummaryView } from '@/lib/mail-thread/mail-thread-wire'

export interface InboundMailClient {
  list(projectId: string, query?: Partial<InboundMailListQuery>, signal?: AbortSignal): Promise<InboundMailListView>
  get(projectId: string, mailId: string, signal?: AbortSignal): Promise<InboundMailView>
  text(projectId: string, mailId: string, signal?: AbortSignal): Promise<InboundMailTextView>
  file(projectId: string, body: FileInboundMailsBody): Promise<InboundMailDecisionResultView>
  dismiss(projectId: string, body: DismissInboundMailsBody): Promise<{ mails: InboundMailView[] }>
  restore(projectId: string, mailId: string): Promise<InboundMailView>
  report(projectId: string, mailId: string): Promise<InboundMailReportResultView>
  follow(projectId: string, threadId: string, body?: MailThreadFollowBody): Promise<void>
  unfollow(projectId: string, threadId: string): Promise<void>
  threadOfDocument(projectId: string, documentId: string): Promise<MailThreadSummaryView | null>
  partContentUrl(projectId: string, mailId: string, partId: string): string
  originalUrl(projectId: string, mailId: string): string
}

export interface InboundMailAddressClient {
  get(projectId: string, signal?: AbortSignal): Promise<InboundMailAddressView>
  create(projectId: string): Promise<InboundMailAddressView>
  rotate(projectId: string): Promise<InboundMailAddressView>
  remove(projectId: string): Promise<InboundMailAddressView>
  setForwardedFrom(projectId: string, forwardedFrom: readonly string[]): Promise<InboundMailAddressView>
}

export const inboundMailClient: InboundMailClient = {
  list: listInboundMails,
  get: getInboundMail,
  text: getInboundMailText,
  file: fileInboundMails,
  dismiss: dismissInboundMails,
  restore: restoreInboundMail,
  report: reportInboundMail,
  follow: async (projectId, threadId, body) => {
    await followMailThread(projectId, threadId, body)
  },
  unfollow: async (projectId, threadId) => {
    await unfollowMailThread(projectId, threadId)
  },
  threadOfDocument: async (projectId, documentId) => (await listMailThreads(projectId, { documentId, limit: 1 })).items[0] ?? null,
  partContentUrl: inboundMailPartContentUrl,
  originalUrl: inboundMailOriginalUrl,
}

export const inboundMailAddressClient: InboundMailAddressClient = {
  get: getInboundMailAddress,
  create: createInboundMailAddress,
  rotate: rotateInboundMailAddress,
  remove: deleteInboundMailAddress,
  setForwardedFrom: setInboundMailForwardedFrom,
}
