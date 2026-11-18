import type { OfficeConventionsView } from '@/lib/office-conventions/office-conventions-wire'
import { ApiRequestError } from './api-error'

export type { OfficeConventionsView }

export type OfficeConventionDecision = 'confirmed' | 'declined' | 'undecided'

const ENDPOINT = '/api/organization/office-conventions'

const jsonHeaders: HeadersInit = { 'Content-Type': 'application/json' }

export const getOfficeConventions = async (): Promise<OfficeConventionsView> => {
  const response = await fetch(ENDPOINT)
  if (!response.ok) {
    throw new ApiRequestError(`Failed to load office conventions: ${response.status}`, response.status)
  }
  return (await response.json()) as OfficeConventionsView
}

export const decideOfficeConvention = async (
  lineKey: string,
  decision: OfficeConventionDecision,
): Promise<OfficeConventionsView> => {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ lineKey, decision }),
  })
  if (!response.ok) {
    throw new ApiRequestError(`Failed to save office convention: ${response.status}`, response.status)
  }
  return (await response.json()) as OfficeConventionsView
}
