/**
 * Fitting a name into a few lines of a known width: the one rule every file
 * name on a tile or a row follows (Dateien, 2026-11-10 review).
 *
 * 1. The whole name, broken only after a space, `_`, `-`, `–` or `/`, never
 *    inside a word: „Tragwerksplan/ung“ and „Baustellenbesprechun/g.pdf“ were
 *    a tile's `overflow-wrap: anywhere` breaking where the width ran out.
 * 2. When it does not fit, the middle goes: the head as long as it can be,
 *    „…“, then the end of the name with its extension (`_Index-D.pdf`), which
 *    is what tells two Fassungen apart. The head keeps at least
 *    {@link MIN_HEAD} characters: „R…Stand-2026-11-03.pdf“ is a lone letter,
 *    not a name.
 * 3. When not even that fits, the end goes, behind „…“ on the last line.
 *
 * The lines come back drawn: the caller renders each as a line of its own, so
 * what a test measures here is what the reader sees, and the browser's own line
 * breaker (which differs on `-5` and on `_`) has no say. Pure: the width of a
 * string is the caller's `measure`, a canvas in the browser, a count in a test.
 */

/** Fewer characters of the head than this read as a fragment, not a name. */
export const MIN_HEAD = 6
/** The end kept after „…“, before the extension: enough for `Index-D`, `11-03`, `Süd-West`. */
export const TAIL_CHARS = 8

const ELLIPSIS = '…'
// Not after „…“: the cut stays inside the word it falls in („Baustel…prechung.pdf“), never a line's lone end.
const BREAK_AFTER = new Set([' ', '_', '-', '–', '/'])
const EXTENSION = /\.[\p{L}\p{N}]{1,6}$/u

export interface FitNameOptions {
  /** The width a line has, in the unit `measure` returns. */
  width: number
  /** How many lines the name may take. */
  lines: number
  measure: (text: string) => number
  /** `middle` for a file's name (its end tells it apart), `end` for one whose start does (a folder's). */
  cut?: 'middle' | 'end'
  /** What the first line gives up at its end: a tile's ⋯ stands there, on the name's first line. */
  firstLineInset?: number
}

export interface FittedName {
  /** The lines to draw, in order; never more than asked for. */
  lines: string[]
  /** Whether anything was left out, so the caller offers the whole name (a title). */
  cut: boolean
}

/** The width line `index` (from 0) has. */
type Width = (index: number) => number

/** The text split after each break chance: every piece but the last ends in its break character. */
function pieces(text: string): string[] {
  const out: string[] = []
  let current = ''
  for (const char of text) {
    current += char
    if (BREAK_AFTER.has(char)) {
      out.push(current)
      current = ''
    }
  }
  if (current) out.push(current)
  return out
}

/** Greedy lines over the break chances, or null when they need more than `max` lines or a word is wider than a line. */
function layout(text: string, width: Width, max: number, measure: (text: string) => number): string[] | null {
  const lines: string[] = []
  let current = ''
  for (const piece of pieces(text)) {
    const joined = current + piece
    if (measure(joined.trimEnd()) <= width(lines.length)) {
      current = joined
      continue
    }
    if (!current) return null
    lines.push(current.trimEnd())
    current = piece
    if (lines.length >= max || measure(piece.trimEnd()) > width(lines.length)) return null
  }
  if (current) lines.push(current.trimEnd())
  return lines.length <= max ? lines : null
}

/** The end kept after „…“: up to {@link TAIL_CHARS} of the name before its extension, starting on a word where one starts in it. */
function tailOf(base: string): string {
  const chars = Array.from(base)
  if (chars.length <= TAIL_CHARS) return base
  const start = chars.length - TAIL_CHARS
  const window = chars.slice(start)
  // Starts on a word already (after a separator): keep it whole, without a leading separator.
  if (BREAK_AFTER.has(chars[start - 1] ?? '')) return window.join('').replace(/^[\s_\-–/]+/u, '')
  const firstBreak = window.findIndex((char) => BREAK_AFTER.has(char))
  if (firstBreak >= 0 && firstBreak < window.length - 1) return window.slice(firstBreak + 1).join('')
  return window.join('')
}

/** The longest head (at least {@link MIN_HEAD} characters) that fits before „…“ and the tail, or null. */
function middleCut(text: string, width: Width, max: number, measure: (text: string) => number): string[] | null {
  const extension = EXTENSION.exec(text)?.[0] ?? ''
  const base = text.slice(0, text.length - extension.length)
  const tail = tailOf(base) + extension
  const chars = Array.from(base)
  const room = chars.length - Array.from(tailOf(base)).length - 1
  const attempt = (head: number) => layout(`${chars.slice(0, head).join('').trimEnd()}${ELLIPSIS}${tail}`, width, max, measure)
  if (room < MIN_HEAD || !attempt(MIN_HEAD)) return null
  // The lines a head of `n` takes only grow with `n`: the longest that fits, by halving.
  let low = MIN_HEAD
  let high = room
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (attempt(mid)) low = mid
    else high = mid - 1
  }
  return attempt(low)
}

/** The first lines whole where they can be, the last one cut at its end behind „…“. */
function endCut(text: string, width: Width, max: number, measure: (text: string) => number): string[] {
  const lines: string[] = []
  let rest = text
  while (lines.length < max - 1) {
    const at = lines.length
    const one = layout(rest, (index) => width(at + index), 1, measure)
    if (one) return [...lines, ...one]
    // The longest run of whole pieces that fits one line; none fits: the last line takes the word.
    const parts = pieces(rest)
    let line = ''
    for (const part of parts) {
      if (measure((line + part).trimEnd()) > width(lines.length)) break
      line += part
    }
    if (!line) break
    lines.push(line.trimEnd())
    rest = rest.slice(line.length)
  }
  const chars = Array.from(rest)
  let keep = chars.length
  while (keep > 0 && measure(`${chars.slice(0, keep).join('').trimEnd()}${ELLIPSIS}`) > width(lines.length)) keep -= 1
  return [...lines, `${chars.slice(0, keep).join('').trimEnd()}${ELLIPSIS}`]
}

export function fitName(text: string, { width: lineWidth, lines, measure, cut = 'middle', firstLineInset = 0 }: FitNameOptions): FittedName {
  const max = Math.max(1, lines)
  const width: Width = (index) => (index === 0 ? lineWidth - firstLineInset : lineWidth)
  const whole = layout(text, width, max, measure)
  if (whole) return { lines: whole, cut: false }
  const middle = cut === 'middle' ? middleCut(text, width, max, measure) : null
  return { lines: middle ?? endCut(text, width, max, measure), cut: true }
}
