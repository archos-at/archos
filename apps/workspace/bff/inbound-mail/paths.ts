import type { InboundMailListStatus, InboundMailOutcome } from '@/lib/inbound-mail/inbound-mail-wire'

export const INBOUND_MAIL_READY_ANCHOR = 'ready'

export const INBOUND_MAIL_QUERY_PARAM = 'q'

export interface InboundMailListFilter {
  status: InboundMailListStatus
  outcome: InboundMailOutcome | null
  query?: string
}

export interface InboundMailPaths {
  list: (filter: InboundMailListFilter) => string
  mail: (mailId: string, filter: InboundMailListFilter) => string
  files: string
}

function filterQuery({ status, outcome, query = '' }: InboundMailListFilter): string {
  const params = new URLSearchParams()
  if (status !== 'waiting') params.set('status', status)
  if (status === 'handled' && outcome) params.set('outcome', outcome)
  if (query.trim() !== '') params.set(INBOUND_MAIL_QUERY_PARAM, query)
  const text = params.toString()
  return text ? `?${text}` : ''
}

export function inboundMailPaths(projectId: string): InboundMailPaths {
  const base = `/app/projects/${encodeURIComponent(projectId)}/files/mail`
  return {
    list: (filter) => `${base}${filterQuery(filter)}`,
    mail: (mailId, filter) => `${base}/${encodeURIComponent(mailId)}${filterQuery(filter)}`,
    files: `/app/projects/${encodeURIComponent(projectId)}/files`,
  }
}

export function inboundMailReadyPath(projectId: string): string {
  return `${inboundMailPaths(projectId).list({ status: 'waiting', outcome: null })}#${INBOUND_MAIL_READY_ANCHOR}`
}
