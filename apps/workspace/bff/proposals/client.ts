import type { ZodType } from 'zod'
import {
  proposalListResponseSchema,
  proposalResponseSchema,
  type ApplyProposalBody,
  type ProposalListQuery,
  type ProposalListResponse,
  type ProposalResponse,
} from './types'

export type ProposalFetch = (path: string, init?: RequestInit) => Promise<Response>

const defaultFetch: ProposalFetch = (path, init) => fetch(path, init)

export class ProposalRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'ProposalRequestError'
  }
}

export const proposalPath = (id: string) => `/api/proposals/${encodeURIComponent(id)}`

async function request(
  run: ProposalFetch,
  path: string,
  method: 'GET' | 'POST',
  payload?: unknown
): Promise<ProposalResponse> {
  return requestAs(proposalResponseSchema, run, path, method, payload)
}

async function requestAs<T>(
  schema: ZodType<T, unknown>,
  run: ProposalFetch,
  path: string,
  method: 'GET' | 'POST',
  payload?: unknown
): Promise<T> {
  const init: RequestInit =
    payload === undefined
      ? { method }
      : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }
  const response = await run(path, init)
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error = (body ?? {}) as { error?: string; code?: string }
    throw new ProposalRequestError(
      response.status,
      error.code ?? 'UNKNOWN',
      error.error ?? `Request failed with ${response.status}`
    )
  }
  return schema.parse(body)
}

export function proposalListPath(query: ProposalListQuery): string {
  const params = new URLSearchParams()
  if (query.projectId) params.set('projectId', query.projectId)
  else params.set('shelf', 'office_shelf')
  if (query.kind) params.set('kind', query.kind)
  if (query.limit) params.set('limit', String(query.limit))
  if (query.cursor) params.set('cursor', query.cursor)
  return `/api/proposals?${params.toString()}`
}

export function listOpenProposals(
  query: ProposalListQuery,
  run: ProposalFetch = defaultFetch
): Promise<ProposalListResponse> {
  return requestAs(proposalListResponseSchema, run, proposalListPath(query), 'GET')
}

export function getProposal(id: string, run: ProposalFetch = defaultFetch): Promise<ProposalResponse> {
  return request(run, proposalPath(id), 'GET')
}

export function applyProposal(id: string, run?: ProposalFetch): Promise<ProposalResponse>
export function applyProposal(id: string, body: ApplyProposalBody, run?: ProposalFetch): Promise<ProposalResponse>
export function applyProposal(
  id: string,
  bodyOrRun?: ApplyProposalBody | ProposalFetch,
  maybeRun?: ProposalFetch
): Promise<ProposalResponse> {
  const body = typeof bodyOrRun === 'function' ? undefined : bodyOrRun
  const run = (typeof bodyOrRun === 'function' ? bodyOrRun : maybeRun) ?? defaultFetch
  return request(run, `${proposalPath(id)}/apply`, 'POST', body)
}

export function dismissProposal(id: string, run: ProposalFetch = defaultFetch): Promise<ProposalResponse> {
  return request(run, `${proposalPath(id)}/dismiss`, 'POST')
}
