/**
 * A traced Skizze's way back (S6, slice 1): the review of the document it lies
 * on, opened at its page. The page rides as the preview's `page`
 * (`lib/document-locus.ts`), which the review opens at.
 *
 * Its own top-level module, apart from the index and from `sketch-review.ts`:
 * the underlay banner is drawn on every sketch canvas, and either of those
 * would put the review's whole subtree below it (`task workspace:blast-radius`).
 */

import { withDocumentLocus } from './lib/document-locus'
import { reviewFilesHref } from './lib/open-review'

export function pageReviewHref(projectId: string, documentId: string, page: number): string {
  return withDocumentLocus(reviewFilesHref(projectId, { documentId }), { page })
}
