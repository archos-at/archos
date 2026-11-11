/**
 * The calls "+ Add" makes, each to a route the door already serves: find or
 * open the country's draft, capture the page, propose records (a dry run
 * first), add a document by URL or upload. Nothing here decides what holds;
 * the routes and their kit do.
 */

import type { SourceStatusView } from '@/lib/base-knowledge/platform/source-service'
import type { AddDocumentResult } from '@/lib/base-knowledge/platform/document-add-wire'
import type { CaptureView, ChangeRequestSummary, ProposalView } from '@/lib/base-knowledge/platform/wire'

const BASE = '/api/platform/knowledge'

/** A refusal, in the route's own words. */
export class Refused extends Error {}

async function json<T>(response: Response): Promise<T> {
  if (response.ok) return (await response.json()) as T
  const body = (await response.json().catch(() => null)) as { detail?: string; error?: string } | null
  throw new Refused(body?.detail ?? body?.error ?? String(response.status))
}

const post = (url: string, body: unknown): Promise<Response> => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

/** The country's open draft, or a new one with this title: where additions go, as the document flow does it. */
export async function draftFor(countryId: string, title: string): Promise<string> {
  // The newest operator draft, as the document flow finds it (`document-add.ts`); a monitor's draft is its own.
  const { changeRequests } = await json<{ changeRequests: ChangeRequestSummary[] }>(await fetch(`${BASE}/change-requests?countryId=${countryId}&status=draft&origin=operator&limit=1`))
  const open = changeRequests[0]
  if (open) return open.id
  return (await json<{ id: string }>(await post(`${BASE}/change-requests`, { title, countryId }))).id
}

/** The configured source whose hosts a page is on, for a fetched capture; none means the person pastes the text. */
export function sourceFor(url: string, sources: readonly SourceStatusView[]): string | null {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
  // Only an active host: one still testing in another request's draft is refused for this one.
  return sources.find((source) => source.hosts.some((one) => one.state === 'active' && one.host.toLowerCase() === host))?.sourceKey ?? null
}

export async function capture(requestId: string, page: { url: string; sourceId: string | null; text: string }): Promise<CaptureView> {
  const body = page.sourceId ? { basis: 'fetched', sourceId: page.sourceId, url: page.url } : { basis: 'operator_supplied', url: page.url, text: page.text, note: 'Pasted in the law map.' }
  return json<CaptureView>(await post(`${BASE}/change-requests/${requestId}/captures`, body))
}

export async function propose(requestId: string, records: unknown[], dryRun: boolean): Promise<ProposalView> {
  const response = await post(`${BASE}/change-requests/${requestId}/records`, { records, dryRun })
  // A refused batch (422) still answers with its results: read them, never a bare status.
  if (response.status === 422) {
    // A dry run answers its results in the body; a refused write puts them in the problem's `details` (`problem.ts`).
    const body = (await response.json().catch(() => null)) as (ProposalView & { detail?: string; details?: ProposalView }) | null
    if (body?.results) return body
    if (body?.details?.results) return { ...body.details, valid: false }
    throw new Refused(body?.detail ?? '422')
  }
  return json<ProposalView>(response)
}

/**
 * One edition's text: fetched by the platform from `url` (its origin then proven), or uploaded, when `url` is
 * where the publisher has it and `titleText` the title lines the records quote, for the reviewer to check.
 */
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
