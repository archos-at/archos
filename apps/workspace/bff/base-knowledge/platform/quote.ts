/**
 * Whether a quote is in a captured text (KC-6, ADR-0170). Pure.
 *
 * Verbatim, up to what a page's rendering changes and a person cannot see:
 * Unicode compatibility forms (NFKC), the typographic quotes, dashes and
 * spaces a statute portal prints, line breaks and runs of whitespace, and case.
 * Nothing else: no stemming, no fuzzy match, so a quote a model paraphrased or
 * made up is not found.
 */

/**
 * The shortest quote that shows anything: three words, or fifteen characters.
 * Shorter ones match by accident ("Wi" is in "Wien"), so they prove nothing.
 */
export const MIN_QUOTE_WORDS = 3
export const MIN_QUOTE_CHARS = 15

const EQUIVALENTS: readonly [RegExp, string][] = [
  [/[\u2018\u2019\u201a\u201b\u2032\u00b4`]/g, "'"],
  [/[\u201c\u201d\u201e\u201f\u2033\u00ab\u00bb\u2039\u203a]/g, '"'],
  [/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-'],
  [/\u00ad/g, ''],
  [/\s+/gu, ' '],
]

/** A text as the quote check compares it. */
export function normalizeForQuote(text: string): string {
  let normalized = text.normalize('NFKC')
  for (const [pattern, replacement] of EQUIVALENTS) normalized = normalized.replace(pattern, replacement)
  return normalized.trim().toLocaleLowerCase('de')
}

/** Whether a quote is long enough to show anything ({@link MIN_QUOTE_WORDS}, {@link MIN_QUOTE_CHARS}). */
export function quoteLongEnough(quote: string): boolean {
  const normalized = normalizeForQuote(quote)
  return normalized.length >= MIN_QUOTE_CHARS || normalized.split(' ').filter(Boolean).length >= MIN_QUOTE_WORDS
}

export function quoteFound(quote: string, text: string): boolean {
  const needle = normalizeForQuote(quote)
  if (!quoteLongEnough(quote)) return false
  return normalizeForQuote(text).includes(needle)
}
