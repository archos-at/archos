import { EMPTY_REVISION_LINKS, type RevisionLinks } from '@/lib/documents/revision-links'

export interface RevisionLinkAnswer {
  newer: RevisionLinks
  older: RevisionLinks
}

export class RevisionRequestError extends Error {
  constructor(readonly status: number) {
    super(`Fassung request failed (${status})`)
    this.name = 'RevisionRequestError'
  }
}

interface WireAnswer {
  revision?: RevisionLinks | null
  older?: { revision?: RevisionLinks | null } | null
}

export async function requestRevisionLink(newerId: string, olderId: string, linked: boolean): Promise<RevisionLinkAnswer> {
  let res: Response
  try {
    res = await fetch(`/api/documents/${encodeURIComponent(newerId)}/revision`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ older: olderId, linked }),
    })
  } catch {
    throw new RevisionRequestError(0)
  }
  if (!res.ok) throw new RevisionRequestError(res.status)
  const body = ((await res.json().catch(() => ({}))) ?? {}) as WireAnswer
  return { newer: body.revision ?? EMPTY_REVISION_LINKS, older: body.older?.revision ?? EMPTY_REVISION_LINKS }
}

export async function setRevisionLink(newerId: string, olderId: string, linked: boolean): Promise<RevisionLinks> {
  return (await requestRevisionLink(newerId, olderId, linked)).newer
}
