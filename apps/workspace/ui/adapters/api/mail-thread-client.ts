import type {
  MailThreadEntryDetachBody,
  MailThreadEntryDetachResultView,
  MailThreadFollowBody,
  MailThreadFollowResultView,
  MailThreadUnfollowResultView,
} from '@/lib/mail-thread/mail-thread-wire'
import { ApiRequestError } from './api-error'

export { getMailThread, listMailThreads } from './inbound-mail-client'

const enc = encodeURIComponent
const threadBase = (projectId: string, threadId: string) => `/api/projects/${enc(projectId)}/mail-threads/${enc(threadId)}`
const entryBase = (projectId: string, threadId: string, entryId: string) => `${threadBase(projectId, threadId)}/entries/${enc(entryId)}`

async function requestError(response: Response, fallback: string): Promise<ApiRequestError> {
  const body: unknown = await response.json().catch(() => null)
  const envelope = (body ?? {}) as { error?: unknown; details?: unknown }
  const message = typeof envelope.error === 'string' && envelope.error ? envelope.error : `${fallback}: ${response.status}`
  const details =
    envelope.details && typeof envelope.details === 'object' && !Array.isArray(envelope.details)
      ? (envelope.details as Record<string, unknown>)
      : null
  const reason = typeof details?.reason === 'string' ? details.reason : null
  return new ApiRequestError(message, response.status, reason, details)
}

async function request<T>(url: string, fallback: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) throw await requestError(response, fallback)
  return (await response.json()) as T
}

const postJson = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export function followMailThread(
  projectId: string,
  threadId: string,
  body: MailThreadFollowBody = {},
): Promise<MailThreadFollowResultView> {
  return request(`${threadBase(projectId, threadId)}/follow`, 'Failed to follow the mail thread', postJson(body))
}

export function unfollowMailThread(
  projectId: string,
  threadId: string,
  options: { userId?: string } = {},
): Promise<MailThreadUnfollowResultView> {
  const search = options.userId ? `?${new URLSearchParams({ userId: options.userId }).toString()}` : ''
  return request(`${threadBase(projectId, threadId)}/follow${search}`, 'Failed to end the follow', { method: 'DELETE' })
}

export function detachMailThreadEntry(
  projectId: string,
  threadId: string,
  entryId: string,
  body: MailThreadEntryDetachBody,
): Promise<MailThreadEntryDetachResultView> {
  return request(`${entryBase(projectId, threadId, entryId)}/detach`, 'Failed to detach the mail', postJson(body))
}

export function mailThreadEntryOriginalUrl(projectId: string, threadId: string, entryId: string): string {
  return `${entryBase(projectId, threadId, entryId)}/original`
}
