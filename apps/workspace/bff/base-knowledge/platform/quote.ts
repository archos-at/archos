/**
 * Whether a quote is in a captured text (KC-6, ADR-0170). Pure.
 *
 * Verbatim, up to what a page's rendering changes and a person cannot see:
 * Unicode compatibility forms (NFKC), the typographic quotes, dashes and
 * spaces a statute portal prints, line breaks and runs of whitespace, and case.
 * Nothing else: no stemming, no fuzzy match, so a quote a model paraphrased or
 * made up is not found.
 */

/** The shortest quote that says anything; shorter ones match by accident. */
export const MIN_QUOTE_CHARS = 2

const EQUIVALENTS: readonly [RegExp, string][] = [
  [/[‘’‚‛′´`]/g, "'"],
  [/[“”„‟″«»‹›]/g, '"'],
  [/[‐‑‒–—―−]/g, '-'],
  [/­/g, ''],
  [/\s+/gu, ' '],
]

/** A text as the quote check compares it. */
export function normalizeForQuote(text: string): string {
  let normalized = text.normalize('NFKC')
  for (const [pattern, replacement] of EQUIVALENTS) normalized = normalized.replace(pattern, replacement)
  return normalized.trim().toLocaleLowerCase('de')
}

export function quoteFound(quote: string, text: string): boolean {
  const needle = normalizeForQuote(quote)
  if (needle.length < MIN_QUOTE_CHARS) return false
  return normalizeForQuote(text).includes(needle)
}
