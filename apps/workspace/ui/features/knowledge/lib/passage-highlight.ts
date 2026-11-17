export interface TextChunk {
  text: string
  x: number
  y: number
  width: number
  height: number
  fontFamily?: string
}

export type MeasureText = (text: string, fontFamily: string | undefined) => number

export const countCharacters: MeasureText = (text) => text.length

export interface HighlightRect {
  x: number
  y: number
  width: number
  height: number
}

export type PassageMatcher = 'exact' | 'anchored' | 'windowed' | 'partial'

export interface PassageMatch {
  rects: HighlightRect[]
  matcher: PassageMatcher
  score: number
}

interface IndexedChar {
  ch: string
  chunk: number
  offset: number
}

export interface PassageIndex {
  chunks: TextChunk[]
  measure: MeasureText
  haystack: string
  chars: IndexedChar[]
}

export const MIN_WINDOW_SCORE = 0.66

const MIN_SCORING_WORD = 4

const STEM_LENGTH = 6

const ANCHOR_WORDS = [8, 6, 4, 3]

export const MIN_PARTIAL_HALF = 24

const CHARACTER_FOLDING: Record<string, string> = {
  '\u2010': '-',
  '\u2011': '-',
  '\u2012': '-',
  '\u2013': '-',
  '\u2014': '-',
  '\u2015': '-',
  '\u2212': '-',
  '\u00A0': ' ',
  '\u2007': ' ',
  '\u2009': ' ',
  '\u202F': ' ',
  '\u200B': '',
  '\u00AD': '',
  '\uFEFF': '',
}

const isWhitespace = (ch: string): boolean => /\s/.test(ch)
const isLetter = (ch: string): boolean => /\p{L}/u.test(ch)

const foldChar = (raw: string): string => {
  if (raw.length === 1) {
    const code = raw.charCodeAt(0)
    if (code < 256) return LATIN1_FOLDED[code]!
  }
  return foldSlowly(raw)
}

const foldSlowly = (raw: string): string => {
  const folded = CHARACTER_FOLDING[raw]
  if (folded !== undefined) return folded
  const normalized = raw.normalize('NFKD').toLowerCase()
  return normalized.replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}\s-]/gu, ' ')
}

const LATIN1_FOLDED: readonly string[] = Array.from({ length: 256 }, (_, code) =>
  foldSlowly(String.fromCharCode(code))
)

const collapse = (raw: IndexedChar[]): IndexedChar[] => {
  const out: IndexedChar[] = []
  const pushBoundary = (): void => {
    const previous = out[out.length - 1]
    if (!previous || previous.ch === ' ') return
    out.push({ ch: ' ', chunk: -1, offset: -1 })
  }

  for (let i = 0; i < raw.length; i += 1) {
    const entry = raw[i]!
    if (entry.ch === '-') {
      let j = i + 1
      while (j < raw.length && isWhitespace(raw[j]!.ch)) j += 1
      const broke = j > i + 1
      const previous = out[out.length - 1]
      if (broke && previous && isLetter(previous.ch) && j < raw.length && isLetter(raw[j]!.ch)) {
        i = j - 1
        continue
      }
      pushBoundary()
      continue
    }
    if (isWhitespace(entry.ch)) {
      pushBoundary()
      continue
    }
    out.push(entry)
  }
  while (out.length && out[out.length - 1]!.ch === ' ') out.pop()
  return out
}

export function buildPassageIndex(chunks: TextChunk[], measure: MeasureText = countCharacters): PassageIndex {
  const raw: IndexedChar[] = []
  chunks.forEach((chunk, chunkIndex) => {
    if (chunkIndex > 0) raw.push({ ch: ' ', chunk: -1, offset: -1 })
    for (let offset = 0; offset < chunk.text.length; offset += 1) {
      const folded = foldChar(chunk.text[offset]!)
      for (const ch of folded) raw.push({ ch, chunk: chunkIndex, offset })
    }
  })
  const chars = collapse(raw)
  return { chunks, chars, measure, haystack: chars.map((entry) => entry.ch).join('') }
}

export function normalizePassage(text: string): string {
  const raw: IndexedChar[] = []
  for (let offset = 0; offset < text.length; offset += 1) {
    for (const ch of foldChar(text[offset]!)) raw.push({ ch, chunk: 0, offset })
  }
  return collapse(raw)
    .map((entry) => entry.ch)
    .join('')
}

interface Word {
  text: string
  start: number
  end: number
}

const words = (text: string): Word[] => {
  const out: Word[] = []
  const pattern = /[^\s]+/g
  let match = pattern.exec(text)
  while (match) {
    out.push({ text: match[0], start: match.index, end: match.index + match[0].length })
    match = pattern.exec(text)
  }
  return out
}

interface Range {
  start: number
  end: number
}

const anchorMatch = (haystack: string, needle: string): Range | null => {
  const needleWords = words(needle)
  if (needleWords.length < 3) return null

  const findFrom = (count: number, fromEnd: boolean): number => {
    if (needleWords.length < count) return -1
    const slice = fromEnd ? needleWords.slice(-count) : needleWords.slice(0, count)
    const phrase = needle.slice(slice[0]!.start, slice[slice.length - 1]!.end)
    const first = haystack.indexOf(phrase)
    if (first === -1) return -1
    if (haystack.indexOf(phrase, first + 1) !== -1) return -1
    return fromEnd ? first + phrase.length : first
  }

  let start = -1
  let end = -1
  for (const count of ANCHOR_WORDS) {
    if (start === -1) start = findFrom(count, false)
    if (end === -1) end = findFrom(count, true)
    if (start !== -1 && end !== -1) break
  }

  if (start !== -1 && end !== -1 && end > start) {
    const span = end - start
    if (span >= needle.length * 0.5 && span <= needle.length * 2.5) return { start, end }
  }
  if (start !== -1) return { start, end: Math.min(haystack.length, start + needle.length) }
  if (end !== -1) return { start: Math.max(0, end - needle.length), end }
  return null
}

const windowMatch = (haystack: string, needle: string): { range: Range; score: number } | null => {
  const needleWords = words(needle).filter((word) => word.text.length >= MIN_SCORING_WORD)
  if (needleWords.length < 3) return null

  const stem = (word: string): string => word.slice(0, STEM_LENGTH)

  const wanted = new Map<string, number>()
  for (const word of needleWords) {
    const key = stem(word.text)
    wanted.set(key, (wanted.get(key) ?? 0) + 1)
  }

  const scoring = words(haystack).filter((word) => word.text.length >= MIN_SCORING_WORD)
  const size = needleWords.length
  if (scoring.length < size) return null

  const have = new Map<string, number>()
  let overlap = 0

  const add = (word: string): void => {
    const next = (have.get(word) ?? 0) + 1
    have.set(word, next)
    if (next <= (wanted.get(word) ?? 0)) overlap += 1
  }
  const remove = (word: string): void => {
    const current = have.get(word) ?? 0
    if (current <= (wanted.get(word) ?? 0)) overlap -= 1
    have.set(word, current - 1)
  }

  const windows: Array<{ range: Range; score: number }> = []
  for (let i = 0; i < scoring.length; i += 1) {
    add(stem(scoring[i]!.text))
    if (i >= size) remove(stem(scoring[i - size]!.text))
    if (i >= size - 1) {
      windows.push({
        range: { start: scoring[i - size + 1]!.start, end: scoring[i]!.end },
        score: overlap / size,
      })
    }
  }

  const best = windows.reduce<{ range: Range; score: number } | null>(
    (winner, candidate) => (!winner || candidate.score > winner.score ? candidate : winner),
    null,
  )
  if (!best || best.score < MIN_WINDOW_SCORE) return null

  const rival = windows.some(
    (candidate) =>
      candidate.score >= best.score &&
      (candidate.range.end <= best.range.start || candidate.range.start >= best.range.end),
  )
  return rival ? null : best
}

const partialMatch = (haystack: string, needle: string): Range | null => {
  if (needle.length < MIN_PARTIAL_HALF * 2) return null

  const middle = Math.floor(needle.length / 2)
  let split = -1
  for (let distance = 0; distance <= middle && split === -1; distance += 1) {
    if (needle[middle - distance] === ' ') split = middle - distance
    else if (needle[middle + distance] === ' ') split = middle + distance
  }
  if (split === -1) return null

  const halves = [needle.slice(0, split).trim(), needle.slice(split + 1).trim()]
    .filter((half) => half.length >= MIN_PARTIAL_HALF)
    .sort((a, b) => b.length - a.length)

  for (const half of halves) {
    const exact = haystack.indexOf(half)
    if (exact !== -1) return { start: exact, end: exact + half.length }
    const anchored = anchorMatch(haystack, half)
    if (anchored) return anchored
  }
  return null
}

const rangeToRects = (index: PassageIndex, range: Range): HighlightRect[] => {
  const spans = new Map<number, { from: number; to: number }>()
  for (let i = range.start; i < range.end && i < index.chars.length; i += 1) {
    const entry = index.chars[i]!
    if (entry.chunk < 0) continue
    const span = spans.get(entry.chunk)
    if (!span) spans.set(entry.chunk, { from: entry.offset, to: entry.offset })
    else {
      span.from = Math.min(span.from, entry.offset)
      span.to = Math.max(span.to, entry.offset)
    }
  }

  const rects: HighlightRect[] = []
  for (const [chunkIndex, span] of spans) {
    const chunk = index.chunks[chunkIndex]
    if (!chunk || !chunk.text.length || chunk.width <= 0) continue
    const covers = span.from === 0 && span.to >= chunk.text.length - 1
    if (covers) {
      rects.push({ x: chunk.x, y: chunk.y, width: chunk.width, height: chunk.height })
      continue
    }
    const at = advanceWithin(chunk, index.measure)
    const start = at(span.from)
    rects.push({ x: chunk.x + start, y: chunk.y, width: at(span.to + 1) - start, height: chunk.height })
  }
  return mergeRects(rects)
}

const advanceWithin = (chunk: TextChunk, measure: MeasureText): ((offset: number) => number) => {
  const whole = measure(chunk.text, chunk.fontFamily)
  if (!(whole > 0)) return (offset) => (offset / chunk.text.length) * chunk.width
  return (offset) => (measure(chunk.text.slice(0, offset), chunk.fontFamily) / whole) * chunk.width
}

const mergeRects = (rects: HighlightRect[]): HighlightRect[] => {
  if (rects.length < 2) return rects
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x)
  const merged: HighlightRect[] = []
  for (const rect of sorted) {
    const previous = merged[merged.length - 1]
    const sameLine =
      previous &&
      Math.abs(previous.y - rect.y) < Math.min(previous.height, rect.height) * 0.5 &&
      rect.x - (previous.x + previous.width) < previous.height
    if (!sameLine) {
      merged.push({ ...rect })
      continue
    }
    const right = Math.max(previous.x + previous.width, rect.x + rect.width)
    const bottom = Math.max(previous.y + previous.height, rect.y + rect.height)
    previous.x = Math.min(previous.x, rect.x)
    previous.y = Math.min(previous.y, rect.y)
    previous.width = right - previous.x
    previous.height = bottom - previous.y
  }
  return merged
}

export function findPassage(index: PassageIndex, snippet: string): PassageMatch | null {
  const needle = normalizePassage(snippet)
  if (needle.length < 8 || !index.haystack.length) return null

  const exact = index.haystack.indexOf(needle)
  if (exact !== -1) {
    const rects = rangeToRects(index, { start: exact, end: exact + needle.length })
    if (rects.length) return { rects, matcher: 'exact', score: 1 }
  }

  const anchored = anchorMatch(index.haystack, needle)
  if (anchored) {
    const rects = rangeToRects(index, anchored)
    if (rects.length) return { rects, matcher: 'anchored', score: 1 }
  }

  const windowed = windowMatch(index.haystack, needle)
  if (windowed) {
    const rects = rangeToRects(index, windowed.range)
    if (rects.length) return { rects, matcher: 'windowed', score: windowed.score }
  }

  const partial = partialMatch(index.haystack, needle)
  if (partial) {
    const rects = rangeToRects(index, partial)
    if (rects.length) return { rects, matcher: 'partial', score: 0.5 }
  }

  return null
}

export function locatePassageInText(
  text: string,
  snippet: string
): { start: number; end: number } | null {
  const needle = normalizePassage(snippet)
  if (needle.length < 8 || !text) return null

  const { haystack, offsets } = foldWholeText(text)
  if (!haystack.length) return null

  const exact = haystack.indexOf(needle)
  const range =
    exact !== -1 ? { start: exact, end: exact + needle.length } : anchorMatch(haystack, needle)
  if (!range) return null

  let start = -1
  let end = -1
  for (let i = range.start; i < range.end && i < offsets.length; i += 1) {
    const offset = offsets[i]!
    if (offset < 0) continue
    if (start === -1) start = offset
    end = offset + 1
  }
  return start === -1 ? null : { start, end }
}

const foldWholeText = (text: string): { haystack: string; offsets: number[] } => {
  const rawChars: string[] = []
  const rawOffsets: number[] = []
  for (let offset = 0; offset < text.length; offset += 1) {
    const code = text.charCodeAt(offset)
    const folded = code < 256 ? LATIN1_FOLDED[code]! : foldChar(text[offset]!)
    if (folded.length === 1) {
      rawChars.push(folded)
      rawOffsets.push(offset)
      continue
    }
    for (const ch of folded) {
      rawChars.push(ch)
      rawOffsets.push(offset)
    }
  }

  const chars: string[] = []
  const offsets: number[] = []
  const pushBoundary = (): void => {
    if (!chars.length || chars[chars.length - 1] === ' ') return
    chars.push(' ')
    offsets.push(-1)
  }

  for (let i = 0; i < rawChars.length; i += 1) {
    const ch = rawChars[i]!
    if (ch === '-') {
      let j = i + 1
      while (j < rawChars.length && isWhitespace(rawChars[j]!)) j += 1
      const broke = j > i + 1
      const previous = chars[chars.length - 1]
      if (broke && previous && isLetter(previous) && j < rawChars.length && isLetter(rawChars[j]!)) {
        i = j - 1
        continue
      }
      pushBoundary()
      continue
    }
    if (isWhitespace(ch)) {
      pushBoundary()
      continue
    }
    chars.push(ch)
    offsets.push(rawOffsets[i]!)
  }
  while (chars.length && chars[chars.length - 1] === ' ') {
    chars.pop()
    offsets.pop()
  }
  return { haystack: chars.join(''), offsets }
}

export function locatePassage(chunks: TextChunk[], snippet: string, measure?: MeasureText): PassageMatch | null {
  return findPassage(buildPassageIndex(chunks, measure), snippet)
}

export function passageBounds(rects: HighlightRect[]): HighlightRect | null {
  if (!rects.length) return null
  const left = Math.min(...rects.map((rect) => rect.x))
  const top = Math.min(...rects.map((rect) => rect.y))
  const right = Math.max(...rects.map((rect) => rect.x + rect.width))
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export const MIN_SEARCH_QUERY = 2

export function findOccurrences(index: PassageIndex, query: string, limit = 500): HighlightRect[][] {
  const needle = normalizePassage(query)
  if (needle.length < MIN_SEARCH_QUERY || !index.haystack.length) return []
  const found: HighlightRect[][] = []
  let from = index.haystack.indexOf(needle)
  while (from !== -1 && found.length < limit) {
    const rects = rangeToRects(index, { start: from, end: from + needle.length })
    if (rects.length) found.push(rects)
    from = index.haystack.indexOf(needle, from + needle.length)
  }
  return found
}
