import { isDelimiterRow } from '@/lib/text/markdown-table'

export const TARGET_LAG_MS = 1200
export const MAX_LAG_MS = 2500
export const MIN_CHARS_PER_SECOND = 45
const CREDIT_CAP_MS = 200
export const FINISH_MIN_MS = 300
export const FINISH_MAX_MS = 500
const FINISH_MS_PER_CHAR = 0.5

export interface PaceState {
  shown: number
  credit: number
  arrivals: number[]
  arrivedAt: number[]
}

export const initialPace = (length: number): PaceState => ({
  shown: length,
  credit: 0,
  arrivals: [],
  arrivedAt: [],
})

export function isCleanCut(text: string): boolean {
  const fences = text.match(/^\s*(```|~~~)/gm)?.length ?? 0
  if (fences % 2 === 1) return false
  const lineStart = text.lastIndexOf('\n') + 1
  const line = text.slice(lineStart)
  if (/^\s*\|/.test(line)) return /\|\s*$/.test(line) && /[^|\s]/.test(line) && tableHasDelimiter(text, lineStart)
  if (line === '' && lineStart > 0 && /^\s*\|/.test(lineBefore(text, lineStart))) {
    return tableHasDelimiter(text, lineStart) && !isDelimiterRow(lineBefore(text, lineStart))
  }
  if ((line.match(/`/g)?.length ?? 0) % 2 === 1) return false
  if ((line.match(/\[/g)?.length ?? 0) !== (line.match(/\]/g)?.length ?? 0)) return false
  if ((line.match(/\(/g)?.length ?? 0) > (line.match(/\)/g)?.length ?? 0)) return false
  return true
}

const lineBefore = (text: string, lineStart: number): string =>
  text.slice(text.lastIndexOf('\n', lineStart - 2) + 1, lineStart - 1)

function tableHasDelimiter(text: string, lineStart: number): boolean {
  let end = lineStart - 1
  while (end > 0) {
    const start = text.lastIndexOf('\n', end - 1) + 1
    const line = text.slice(start, end)
    if (!/^\s*\|/.test(line)) return false
    if (isDelimiterRow(line)) return true
    end = start - 1
  }
  return false
}

const isWordGap = (text: string, i: number): boolean => text[i - 1] === ' ' || text[i - 1] === '\n'

function* cleanCutsAfter(text: string, from: number): Generator<number> {
  let lineStart = from === 0 ? 0 : text.lastIndexOf('\n', from - 1) + 1
  let fencesAbove = text.slice(0, lineStart).match(/^\s*(```|~~~)/gm)?.length ?? 0
  let line = new LineScan(text, lineStart)
  for (let i = lineStart; i <= text.length; i++) {
    if (i > lineStart) {
      const char = text[i - 1]
      if (char === '\n') {
        if (line.fence) fencesAbove++
        lineStart = i
        line = new LineScan(text, lineStart)
      } else line.add(char, i - 1)
    }
    if (i > from && isWordGap(text, i) && line.isClean(fencesAbove)) yield i
  }
}

class LineScan {
  fence = false
  private length = 0
  private firstSolid = -1
  private lastSolid = ''
  private hasCellText = false
  private backticks = 0
  private brackets = 0
  private unclosedParens = 0
  private delimiterAbove: boolean | undefined

  constructor(
    private readonly text: string,
    private readonly start: number
  ) {}

  add(char: string, at: number): void {
    this.length++
    if (!/\s/.test(char)) {
      if (this.firstSolid < 0) this.firstSolid = at
      this.lastSolid = char
      if (char !== '|') this.hasCellText = true
    }
    if (this.firstSolid >= 0 && at === this.firstSolid + 2) {
      const opening = this.text.slice(this.firstSolid, at + 1)
      this.fence = opening === '```' || opening === '~~~'
    }
    if (char === '`') this.backticks++
    else if (char === '[') this.brackets++
    else if (char === ']') this.brackets--
    else if (char === '(') this.unclosedParens++
    else if (char === ')') this.unclosedParens--
  }

  isClean(fencesAbove: number): boolean {
    if ((fencesAbove + (this.fence ? 1 : 0)) % 2 === 1) return false
    const { text, start } = this
    if (this.firstSolid >= 0 && text[this.firstSolid] === '|') {
      return this.lastSolid === '|' && this.hasCellText && this.hasDelimiter()
    }
    if (this.length === 0 && start > 0 && /^\s*\|/.test(lineBefore(text, start))) {
      return this.hasDelimiter() && !isDelimiterRow(lineBefore(text, start))
    }
    if (this.backticks % 2 === 1) return false
    if (this.brackets !== 0) return false
    return this.unclosedParens <= 0
  }

  private hasDelimiter(): boolean {
    this.delimiterAbove ??= tableHasDelimiter(this.text, this.start)
    return this.delimiterAbove
  }
}

export function furthestCleanCut(text: string, from: number, limit: number): number {
  const end = Math.min(limit, text.length)
  let furthest = from
  for (const cut of cleanCutsAfter(text, from)) {
    if (cut > end) break
    furthest = cut
  }
  return furthest
}

export function nextCleanCut(text: string, from: number): number | undefined {
  for (const cut of cleanCutsAfter(text, from)) return cut
  return undefined
}

export function keepThroughRewrite(text: string, shown: number): number {
  const keep = Math.min(shown, text.length)
  if (keep === text.length || keep === 0) return keep
  if (isWordGap(text, keep) && isCleanCut(text.slice(0, keep))) return keep
  return nextCleanCut(text, keep) ?? text.length
}

export function noteArrival(state: PaceState, length: number, now: number): PaceState {
  if (length <= (state.arrivals.at(-1) ?? state.shown)) return state
  return { ...state, arrivals: [...state.arrivals, length], arrivedAt: [...state.arrivedAt, now] }
}

export interface PaceTuning {
  targetLagMs?: number
  maxLagMs?: number
}

export function advancePace(
  state: PaceState,
  text: string,
  elapsedMs: number,
  now: number,
  { targetLagMs = TARGET_LAG_MS, maxLagMs = MAX_LAG_MS }: PaceTuning = {}
): PaceState {
  const length = text.length
  if (state.shown >= length) return { ...state, shown: length, credit: 0, arrivals: [], arrivedAt: [] }

  const backlog = length - state.shown
  const perSecond = Math.max(MIN_CHARS_PER_SECOND, (backlog * 1000) / targetLagMs)
  const credit = state.credit + (perSecond * elapsedMs) / 1000
  const limit = Math.min(length, state.shown + Math.floor(credit))

  let due = state.shown
  state.arrivals.forEach((boundary, i) => {
    if (now - (state.arrivedAt[i] ?? now) >= maxLagMs) due = Math.max(due, boundary)
  })

  const first = state.shown === 0 ? (nextCleanCut(text, 0) ?? 0) : 0
  const cut = Math.max(due, first, furthestCleanCut(text, state.shown, limit))
  const shown = Math.min(length, cut)
  const keep = state.arrivals.map((b, i) => [b, state.arrivedAt[i] ?? now] as const).filter(([b]) => b > shown)
  const nextWord = shown < length ? (nextCleanCut(text, shown) ?? length) - shown : 0
  const cap = Math.max((perSecond * CREDIT_CAP_MS) / 1000, nextWord)
  return {
    shown,
    credit: Math.max(0, Math.min(credit - (shown - state.shown), cap)),
    arrivals: keep.map(([b]) => b),
    arrivedAt: keep.map(([, t]) => t),
  }
}

export const finishDuration = (remaining: number): number =>
  Math.min(FINISH_MAX_MS, Math.max(FINISH_MIN_MS, FINISH_MIN_MS + remaining * FINISH_MS_PER_CHAR))

export function finishCut(text: string, from: number, shown: number, elapsedMs: number, durationMs: number): number {
  if (elapsedMs >= durationMs) return text.length
  const progress = 1 - (1 - elapsedMs / durationMs) ** 2
  const target = from + Math.floor((text.length - from) * progress)
  return Math.max(shown, furthestCleanCut(text, shown, target))
}
