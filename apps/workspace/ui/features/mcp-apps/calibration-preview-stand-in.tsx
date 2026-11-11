/**
 * What an MCP Apps view makes of a proposed calibration where the chat draws
 * the page clip and asks its one question
 * (`features/cards/components/CalibrationProposalPreview.tsx`): nothing of its
 * own. The hook answers null, so the receipt is the generic one.
 *
 * The clip is fetched from the document's own routes in the reader's session
 * and rasterized by pdf.js, loaded from the app's origin. A view has no cookie
 * and no network (`connect-src 'none'`, ADR-0142), so neither can load, and
 * the view is one inline script: pdf.js would be bundled into it whole.
 * `scripts/build-mcp-app-views.ts` resolves the calibration's module to this
 * file for the views only. Without a clip nobody can check the span by eye, so
 * the view shows what the chat shows a reader who may not open the document:
 * the action, what it acts on and every input, which is what is stored and
 * decided either way. `view-build.spec.ts` holds that pdf.js and the document
 * routes stay out.
 */

export function useCalibrationReceipt(
  _operation: string,
  _input: Record<string, unknown>,
  _targets?: readonly unknown[]
): null {
  return null
}
