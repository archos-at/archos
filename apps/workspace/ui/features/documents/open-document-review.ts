/**
 * Open a document's review from another feature: a chat Skizze's „Als Skizze
 * bearbeiten“ files it once and opens the filed document's review, beside the
 * chat or in Dateien (`lib/open-review.ts`).
 *
 * Its own top-level module, apart from the index and from `sketch-review.ts`:
 * the sketch figure is drawn below every Markdown fence, and either of those
 * would put the review's whole subtree below it (`task workspace:blast-radius`).
 */

export { openReviewAt, type OpenReviewResult } from './lib/open-review'
