import type { SourceStatusView } from '@/lib/base-knowledge/platform/source-service'
import type { AddDocumentResult } from '@/lib/base-knowledge/platform/document-add-wire'
import type { CaptureView, ChangeRequestSummary, ProposalView } from '@/lib/base-knowledge/platform/wire'

const BASE = '/api/platform/knowledge'

export class Refused extends Error {}

async function json<T>(response: Response): Promise<T> {
  if (response.ok) return (await response.json()) as T
  const body = (await response.json().catch(() => null)) as { detail?: string; error?: string } | null
  throw new Refused(body?.detail ?? body?.error ?? String(response.status))
}

const post = (url: string, body: unknown): Promise<Response> => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export async function draftFor(countryId: string, title: string): Promise<string> {
  const { changeRequests } = await json<{ changeRequests: ChangeRequestSummary[] }>(await fetch(`${BASE}/change-requests?countryId=${countryId}&status=draft&origin=operator&limit=1`))
  const open = changeRequests[0]
  if (open) return open.id
  return (await json<{ id: string }>(await post(`${BASE}/change-requests`, { title, countryId }))).id
}

export function sourceFor(url: string, sources: readonly SourceStatusView[]): string | null {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
  return sources.find((source) => source.hosts.some((one) => one.state === 'active' && one.host.toLowerCase() === host))?.sourceKey ?? null
}

export async function capture(requestId: string, page: { url: string; sourceId: string | null; text: string }): Promise<CaptureView> {
  const body = page.sourceId ? { basis: 'fetched', sourceId: page.sourceId, url: page.url } : { basis: 'operator_supplied', url: page.url, text: page.text, note: 'Pasted in the law map.' }
  return json<CaptureView>(await post(`${BASE}/change-requests/${requestId}/captures`, body))
}

export async function propose(requestId: string, records: unknown[], dryRun: boolean): Promise<ProposalView> {
  const response = await post(`${BASE}/change-requests/${requestId}/records`, { records, dryRun })
  if (response.status === 422) {
    const body = (await response.json().catch(() => null)) as (ProposalView & { detail?: string; details?: ProposalView }) | null
    if (body?.results) return body
    if (body?.details?.results) return { ...body.details, valid: false }
    throw new Refused(body?.detail ?? '422')
  }
  return json<ProposalView>(response)
}

export async function addDocument(countryId: string, input: { workKey: string; label: string; inForceFrom: string | null; url: string; file: File | null; titleText: string }): Promise<AddDocumentResult> {
  if (input.file) {
    const form = new FormData()
    form.append('file', input.file)
    form.append('work', JSON.stringify({ workKey: input.workKey }))
    form.append('label', input.label)
    form.append('inForceFrom', input.inForceFrom ?? '')
    form.append('publishedAt', input.url)
    form.append('titleText', input.titleText)
    return json<AddDocumentResult>(await fetch(`${BASE}/countries/${countryId}/documents/upload`, { method: 'POST', body: form }))
  }
  return json<AddDocumentResult>(await post(`${BASE}/countries/${countryId}/documents`, { url: input.url, work: { workKey: input.workKey }, label: input.label, inForceFrom: input.inForceFrom }))
}
