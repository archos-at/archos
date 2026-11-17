import {
  detachMailThreadEntry,
  followMailThread,
  getMailThread,
  listMailThreads,
  mailThreadEntryOriginalUrl,
  unfollowMailThread,
} from '@/adapters/api/mail-thread-client'
import { listProjectPeople, type ProjectPerson } from '@/adapters/api/folder-access-client'
import { downloadFetched, type FetchedDownload } from '@/lib/browser-download'
import { documentLifecycleClient } from '@/lib/documents/lifecycle-client'
import type { DocumentVersionDiffResponse, DocumentVersionListResponse } from '@/lib/documents/lifecycle-types'
import type {
  MailThreadEntryDetachBody,
  MailThreadEntryDetachResultView,
  MailThreadFollowBody,
  MailThreadFollowResultView,
  MailThreadListQuery,
  MailThreadListView,
  MailThreadSummaryView,
  MailThreadUnfollowResultView,
  MailThreadView,
} from '@/lib/mail-thread/mail-thread-wire'

export interface MailThreadClient {
  ofDocument(projectId: string, documentId: string, signal?: AbortSignal): Promise<MailThreadSummaryView | null>
  get(projectId: string, threadId: string, signal?: AbortSignal): Promise<MailThreadView>
  list(projectId: string, query?: Partial<MailThreadListQuery>): Promise<MailThreadListView>
  follow(projectId: string, threadId: string, body?: MailThreadFollowBody): Promise<MailThreadFollowResultView>
  unfollow(projectId: string, threadId: string, options?: { userId?: string }): Promise<MailThreadUnfollowResultView>
  detach(projectId: string, threadId: string, entryId: string, body: MailThreadEntryDetachBody): Promise<MailThreadEntryDetachResultView>
  downloadOriginal(projectId: string, threadId: string, entryId: string): Promise<FetchedDownload>
  versions(documentId: string): Promise<DocumentVersionListResponse>
  diff(documentId: string, fromVersionId: string, toVersionId: string): Promise<DocumentVersionDiffResponse>
  people(projectId: string): Promise<ProjectPerson[]>
}

export const mailThreadClient: MailThreadClient = {
  ofDocument: async (projectId, documentId, signal) =>
    (await listMailThreads(projectId, { documentId, limit: 1 }, signal)).items[0] ?? null,
  get: getMailThread,
  list: (projectId, query) => listMailThreads(projectId, query),
  follow: followMailThread,
  unfollow: unfollowMailThread,
  detach: detachMailThreadEntry,
  downloadOriginal: (projectId, threadId, entryId) =>
    downloadFetched(mailThreadEntryOriginalUrl(projectId, threadId, entryId), 'original.eml'),
  versions: (documentId) => documentLifecycleClient.listVersions(documentId),
  diff: (documentId, from, to) => documentLifecycleClient.diff(documentId, from, to),
  people: listProjectPeople,
}
