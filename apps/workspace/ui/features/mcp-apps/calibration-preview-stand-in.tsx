/**
 * What an MCP Apps view draws where the receipt of a proposed calibration
 * would draw the page clip with the reference span
 * (`features/cards/components/CalibrationProposalPreview.tsx`): nothing.
 *
 * The clip is fetched from the document's own routes in the reader's session
 * and rasterized by pdf.js, loaded from the app's origin. A view has no cookie
 * and no network (`connect-src 'none'`, ADR-0142), so neither can load, and
 * the view is one inline script: pdf.js would be bundled into it whole.
 * `scripts/build-mcp-app-views.ts` resolves the preview's module to this file
 * for the views only. The receipt there is the generic one: the action, what
 * it acts on and every input, which is what is stored and decided either way.
 * `view-build.spec.ts` holds that pdf.js and the document routes stay out.
 */

export function CalibrationProposalPreview(_props: {
  operation: string
  input: Record<string, unknown>
  targets?: readonly unknown[]
}): null {
  return null
}
