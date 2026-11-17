export const MIN_HEAD = 6
export const TAIL_CHARS = 8

const ELLIPSIS = '…'
const BREAK_AFTER = new Set([' ', '_', '-', '–', '/'])
const EXTENSION = /\.[\p{L}\p{N}]{1,6}$/u

export interface FitNameOptions {
  width: number
  lines: number
  measure: (text: string) => number
  cut?: 'middle' | 'end'
  firstLineInset?: number
}

export interface FittedName {
  lines: string[]
  cut: boolean
}

type Width = (index: number) => number

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

function tailOf(base: string): string {
  const chars = Array.from(base)
  if (chars.length <= TAIL_CHARS) return base
  const start = chars.length - TAIL_CHARS
  const window = chars.slice(start)
  if (BREAK_AFTER.has(chars[start - 1] ?? '')) return window.join('').replace(/^[\s_\-–/]+/u, '')
  const firstBreak = window.findIndex((char) => BREAK_AFTER.has(char))
  if (firstBreak >= 0 && firstBreak < window.length - 1) return window.slice(firstBreak + 1).join('')
  return window.join('')
}

function middleCut(text: string, width: Width, max: number, measure: (text: string) => number): string[] | null {
  const extension = EXTENSION.exec(text)?.[0] ?? ''
  const base = text.slice(0, text.length - extension.length)
  const tail = tailOf(base) + extension
  const chars = Array.from(base)
  const room = chars.length - Array.from(tailOf(base)).length - 1
  const attempt = (head: number) => layout(`${chars.slice(0, head).join('').trimEnd()}${ELLIPSIS}${tail}`, width, max, measure)
  if (room < MIN_HEAD || !attempt(MIN_HEAD)) return null
  let low = MIN_HEAD
  let high = room
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (attempt(mid)) low = mid
    else high = mid - 1
  }
  return attempt(low)
}

function endCut(text: string, width: Width, max: number, measure: (text: string) => number): string[] {
  const lines: string[] = []
  let rest = text
  while (lines.length < max - 1) {
    const at = lines.length
    const one = layout(rest, (index) => width(at + index), 1, measure)
    if (one) return [...lines, ...one]
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
