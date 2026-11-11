import type { AnnotationStatus, UpdateAnnotationRequest } from '@/lib/annotations/types'

/** A status move held back for the undo window: where the key moved the mark, and where it stands on the server. */
export interface HeldDecision {
  /** The document the key was pressed on: the decision is sent there even if the pane has moved on. */
  documentId: string
  status: 'open' | 'resolved' | 'dismissed'
  expectedStatus: AnnotationStatus
  /** Said when the move, once sent, is refused for any reason but a colleague's move (that is the conflict notice). */
  onFailed?: () => void
}

/**
 * A change asked while a decision on the same mark is held: the decision is
 * let go, and the change is rebased onto where the mark really stands. Moving
 * it back to that status is no change at all.
 */
export function rebased(input: UpdateAnnotationRequest, held: HeldDecision): UpdateAnnotationRequest {
  const { status, expectedStatus, ...rest } = input
  if (status === undefined || status === held.expectedStatus) return rest
  return { ...rest, status, expectedStatus: expectedStatus === held.status ? held.expectedStatus : expectedStatus }
}
