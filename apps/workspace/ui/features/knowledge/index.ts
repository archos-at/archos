/**
 * What another feature may take from `components/`, `hooks/` and `lib/` here.
 *
 * The E-Mail-Eingang draws an attachment's first page with the shared pdf.js
 * runtime. The older importers of `lib/pdfjs-runtime` (documents,
 * project-intake) predate the seam check and are listed in
 * `.dependency-cruiser-known-violations.json`. Add here only what another
 * feature imports.
 */

export { documentParameters, loadPdfjs } from './lib/pdfjs-runtime'

// The receipt of a proposed calibration draws the page clip with the reference
// span on it (`features/cards/components/CalibrationProposalPreview.tsx`).
export { PageRegionThumbnail } from './components/page-region-thumbnail'
export { SpanMark } from './components/span-mark'
export type { PagePlace } from './lib/page-place'
