import type { DocumentReview as ReviewState, ReviewTool } from '../hooks/use-document-review'

export function toolOffered(tool: ReviewTool, review: ReviewState): boolean {
  if (tool === 'select') return true
  if (tool === 'ask') return review.piloti.available
  if (tool === 'measure') return review.tape.available
  return review.canAnnotate
}
