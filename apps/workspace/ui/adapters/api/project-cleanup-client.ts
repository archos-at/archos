import type { CleanupProposal } from '@/lib/projects/cleanup-types'
import { ApiRequestError } from './api-error'

export type { CleanupProposal }

export interface CleanupRequest {
  documentIds: string[]
  proposedIds: string[]
  aiUsed: boolean
}

export class CleanupRequestError extends ApiRequestError {
  readonly body: unknown

  constructor(status: number, body: unknown) {
    super(`Failed to run the clean-out: ${status}`, status)
    this.name = 'CleanupRequestError'
    this.body = body
  }
}

const jsonHeaders: HeadersInit = { 'Content-Type': 'application/json' }

export const requestCleanupProposal = async (projectId: string, locale: 'de' | 'en'): Promise<CleanupProposal> => {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/cleanup/proposal`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ locale }),
  })
  if (!response.ok) {
    throw new ApiRequestError(`Failed to propose a clean-out: ${response.status}`, response.status)
  }
  return (await response.json()) as CleanupProposal
}

export const runCleanup = async (projectId: string, request: CleanupRequest): Promise<void> => {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/cleanup`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(request),
  })
  if (!response.ok) throw new CleanupRequestError(response.status, await response.json().catch(() => null))
}
