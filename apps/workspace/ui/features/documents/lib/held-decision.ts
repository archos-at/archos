import type { AnnotationStatus, UpdateAnnotationRequest } from '@/lib/annotations/types'

export interface HeldDecision {
  documentId: string
  status: 'open' | 'resolved' | 'dismissed'
  expectedStatus: AnnotationStatus
  onFailed?: () => void
}

export function rebased(input: UpdateAnnotationRequest, held: HeldDecision): UpdateAnnotationRequest {
  const { status, expectedStatus, ...rest } = input
  if (status === undefined || status === held.expectedStatus) return rest
  return { ...rest, status, expectedStatus: expectedStatus === held.status ? held.expectedStatus : expectedStatus }
}
