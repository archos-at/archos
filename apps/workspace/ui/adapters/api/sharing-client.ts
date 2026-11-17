import type {
  ResourceRole,
  ResourceSharingState,
  ResourceVisibility,
  ShareCandidate,
  ShareableResourceType,
} from '@/lib/sharing/types'
import { ApiRequestError } from './api-error'

export interface SharingFailure {
  reason: string | null
  message: string | null
  person?: string | null
  folders?: readonly string[]
}

export const NO_FAILURE_DETAIL: SharingFailure = { reason: null, message: null }

export type ShareCandidatesResponse = ShareCandidate[] | { candidates: ShareCandidate[] }

export class SharingRequestError extends ApiRequestError {
  readonly failure: SharingFailure

  constructor(failure: SharingFailure, status: number) {
    super(`Sharing change failed: ${status}`, status, failure.reason)
    this.name = 'SharingRequestError'
    this.failure = failure
  }
}

const sharingPath = (resourceType: ShareableResourceType, resourceId: string): string =>
  `/api/sharing/${encodeURIComponent(resourceType)}/${encodeURIComponent(resourceId)}`

const jsonRequest = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

async function readSharingFailure(response: Response): Promise<SharingFailure> {
  try {
    const body = (await response.json()) as {
      error?: string
      details?: { reason?: unknown; person?: unknown; folders?: unknown } | null
    }
    const details = body.details ?? {}
    const folders = Array.isArray(details.folders)
      ? details.folders.filter((folder): folder is string => typeof folder === 'string')
      : []
    return {
      reason: typeof details.reason === 'string' ? details.reason : null,
      message: body.error ?? null,
      person: typeof details.person === 'string' ? details.person : null,
      folders,
    }
  } catch {
    return NO_FAILURE_DETAIL
  }
}

const sendSharingChange = async (path: string, init: RequestInit): Promise<ResourceSharingState> => {
  const response = await fetch(path, init)
  if (!response.ok) throw new SharingRequestError(await readSharingFailure(response), response.status)
  return (await response.json()) as ResourceSharingState
}

export const getResourceSharing = async (
  resourceType: ShareableResourceType,
  resourceId: string,
): Promise<ResourceSharingState> => {
  const response = await fetch(sharingPath(resourceType, resourceId))
  if (!response.ok) throw new ApiRequestError(`Failed to load sharing: ${response.status}`, response.status)
  return (await response.json()) as ResourceSharingState
}

export const getShareCandidates = async (
  resourceType: ShareableResourceType,
  resourceId: string,
): Promise<ShareCandidatesResponse> => {
  const response = await fetch(`${sharingPath(resourceType, resourceId)}/candidates`)
  if (!response.ok) throw new ApiRequestError(`Failed to load share candidates: ${response.status}`, response.status)
  return (await response.json()) as ShareCandidatesResponse
}

export const setResourceVisibility = (
  resourceType: ShareableResourceType,
  resourceId: string,
  visibility: ResourceVisibility,
): Promise<ResourceSharingState> =>
  sendSharingChange(sharingPath(resourceType, resourceId), jsonRequest('PATCH', { visibility }))

export const grantResourceAccess = (
  resourceType: ShareableResourceType,
  resourceId: string,
  subjectUserId: string,
  role: ResourceRole,
): Promise<ResourceSharingState> =>
  sendSharingChange(`${sharingPath(resourceType, resourceId)}/grants`, jsonRequest('POST', { subjectUserId, role }))

export const changeResourceRole = (
  resourceType: ShareableResourceType,
  resourceId: string,
  subjectUserId: string,
  role: ResourceRole,
): Promise<ResourceSharingState> =>
  sendSharingChange(`${sharingPath(resourceType, resourceId)}/grants`, jsonRequest('PATCH', { subjectUserId, role }))

export const revokeResourceAccess = (
  resourceType: ShareableResourceType,
  resourceId: string,
  subjectUserId: string,
): Promise<ResourceSharingState> =>
  sendSharingChange(
    `${sharingPath(resourceType, resourceId)}/grants/${encodeURIComponent(subjectUserId)}`,
    { method: 'DELETE' },
  )

export const escalateResourceAccess = (
  resourceType: ShareableResourceType,
  resourceId: string,
): Promise<ResourceSharingState> =>
  sendSharingChange(`${sharingPath(resourceType, resourceId)}/grants`, jsonRequest('POST', { escalate: true }))
