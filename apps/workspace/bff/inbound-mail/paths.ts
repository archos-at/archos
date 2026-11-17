import type { InboundMailListStatus, InboundMailOutcome } from '@/lib/inbound-mail/inbound-mail-wire'

export const INBOUND_MAIL_READY_ANCHOR = 'ready'

export interface InboundMailPaths {
  list: (filter: { status: InboundMailListStatus; outcome: InboundMailOutcome | null }) => string
  mail: (mailId: string, filter: { status: InboundMailListStatus; outcome: InboundMailOutcome | null }) => string
  files: string
}

function filterQuery({ status, outcome }: { status: InboundMailListStatus; outcome: InboundMailOutcome | null }): string {
  const params = new URLSearchParams()
  if (status !== 'waiting') params.set('status', status)
  if (status === 'handled' && outcome) params.set('outcome', outcome)
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
