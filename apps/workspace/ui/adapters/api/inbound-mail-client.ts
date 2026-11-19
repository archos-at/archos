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
import type { MailThreadListQuery, MailThreadListView, MailThreadView } from '@/lib/mail-thread/mail-thread-wire'
import { ApiRequestError } from './api-error'

const enc = encodeURIComponent
const projectBase = (projectId: string) => `/api/projects/${enc(projectId)}`

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

async function request<T>(url: string, fallback: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) throw await requestError(response, fallback)
  return (await response.json()) as T
}

const postJson = (body: unknown, signal?: AbortSignal): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
  signal,
})

function searchOf(query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value))
  const text = params.toString()
  return text ? `?${text}` : ''
}

export function getInboundMailAddress(projectId: string, signal?: AbortSignal): Promise<InboundMailAddressView> {
  return request(`${projectBase(projectId)}/inbound-mail-address`, 'Failed to load the project mail address', { signal })
}

export function createInboundMailAddress(projectId: string): Promise<InboundMailAddressView> {
  return request(`${projectBase(projectId)}/inbound-mail-address`, 'Failed to create the project mail address', { method: 'POST' })
}

export function rotateInboundMailAddress(projectId: string): Promise<InboundMailAddressView> {
  return request(`${projectBase(projectId)}/inbound-mail-address/rotate`, 'Failed to replace the project mail address', { method: 'POST' })
}

export function setInboundMailForwardedFrom(projectId: string, forwardedFrom: readonly string[]): Promise<InboundMailAddressView> {
  return request(`${projectBase(projectId)}/inbound-mail-address`, 'Failed to save the forwarding addresses', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ forwardedFrom }),
  })
}

export function deleteInboundMailAddress(projectId: string): Promise<InboundMailAddressView> {
  return request(`${projectBase(projectId)}/inbound-mail-address`, 'Failed to switch off the project mail address', { method: 'DELETE' })
}

export function listInboundMails(
  projectId: string,
  query: Partial<InboundMailListQuery> = {},
  signal?: AbortSignal,
): Promise<InboundMailListView> {
  const search = searchOf({ status: query.status, outcome: query.outcome, limit: query.limit, cursor: query.cursor })
  return request(`${projectBase(projectId)}/inbound-mails${search}`, 'Failed to load the project mail', { signal })
}

export function getInboundMail(projectId: string, mailId: string, signal?: AbortSignal): Promise<InboundMailView> {
  return request(`${projectBase(projectId)}/inbound-mails/${enc(mailId)}`, 'Failed to load the mail', { signal })
}

export function getInboundMailText(projectId: string, mailId: string, signal?: AbortSignal): Promise<InboundMailTextView> {
  return request(`${projectBase(projectId)}/inbound-mails/${enc(mailId)}/text`, 'Failed to load the mail text', { signal })
}

export function fileInboundMails(projectId: string, body: FileInboundMailsBody): Promise<InboundMailDecisionResultView> {
  return request(`${projectBase(projectId)}/inbound-mails/file`, 'Failed to file the mail', postJson(body))
}

export function dismissInboundMails(projectId: string, body: DismissInboundMailsBody): Promise<{ mails: InboundMailView[] }> {
  return request(`${projectBase(projectId)}/inbound-mails/dismiss`, 'Failed to dismiss the mail', postJson(body))
}

export function restoreInboundMail(projectId: string, mailId: string): Promise<InboundMailView> {
  return request(`${projectBase(projectId)}/inbound-mails/${enc(mailId)}/restore`, 'Failed to restore the mail', { method: 'POST' })
}

export function reportInboundMail(projectId: string, mailId: string): Promise<InboundMailReportResultView> {
  return request(`${projectBase(projectId)}/inbound-mails/${enc(mailId)}/report`, 'Failed to report the mail', { method: 'POST' })
}

export function inboundMailPartContentUrl(projectId: string, mailId: string, partId: string): string {
  return `${projectBase(projectId)}/inbound-mails/${enc(mailId)}/parts/${enc(partId)}/content`
}

export function inboundMailOriginalUrl(projectId: string, mailId: string): string {
  return `${projectBase(projectId)}/inbound-mails/${enc(mailId)}/original`
}

export function listMailThreads(
  projectId: string,
  query: Partial<MailThreadListQuery> = {},
  signal?: AbortSignal,
): Promise<MailThreadListView> {
  const search = searchOf({ documentId: query.documentId, limit: query.limit, cursor: query.cursor })
  return request(`${projectBase(projectId)}/mail-threads${search}`, 'Failed to load the mail threads', { signal })
}

export function getMailThread(projectId: string, threadId: string, signal?: AbortSignal): Promise<MailThreadView> {
  return request(`${projectBase(projectId)}/mail-threads/${enc(threadId)}`, 'Failed to load the mail thread', { signal })
}
