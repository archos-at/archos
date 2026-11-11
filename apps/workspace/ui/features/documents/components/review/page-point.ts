/**
 * A share of the page, kept on it, to four decimals: a tenth of a millimetre
 * on an A1 sheet, and no 0.30000000000000004 in a stored mark.
 */
export const onPage = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 10_000) / 10_000

/** The point on a page an event hit, as shares of the page, clamped onto it. */
export function pointIn(
  element: HTMLElement,
  event: { clientX: number; clientY: number }
): { x: number; y: number } | null {
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  return { x: onPage((event.clientX - rect.left) / rect.width), y: onPage((event.clientY - rect.top) / rect.height) }
}
