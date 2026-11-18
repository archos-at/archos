import type { DocumentReview as ReviewState, ReviewTool } from '../hooks/use-document-review'

export const toolOffered = (tool: ReviewTool, review: ReviewState): boolean =>
  tool === 'select' || (tool === 'ask' ? review.piloti.available : review.canAnnotate)
