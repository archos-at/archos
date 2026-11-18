export const DEFAULT_TAIL_LENGTH = 16

export interface MiddleSplit {
  head: string
  tail: string
}

export const MAX_TAIL_LENGTH = 28

const SEPARATORS = new Set(['_', '-', ' ', '.', '(', '['])

const SNAP_BACK = 6

const atBoundary = (chars: readonly string[], at: number): boolean =>
  SEPARATORS.has(chars[at - 1] ?? '') || SEPARATORS.has(chars[at] ?? '')

function snapToBoundary(chars: readonly string[], cut: number, keep: number): number {
  for (let at = cut; at >= Math.max(1, cut - SNAP_BACK); at -= 1) if (atBoundary(chars, at)) return at
  const forward = Math.floor(keep / 2)
  for (let at = cut + 1; at <= Math.min(chars.length - 1, cut + forward); at += 1) if (atBoundary(chars, at)) return at
  return cut
}

export function splitForMiddleTruncation(text: string, tailLength = DEFAULT_TAIL_LENGTH): MiddleSplit {
  const keep = Math.max(1, Math.trunc(tailLength))
  const chars = Array.from(text)
  if (chars.length <= keep + 3) return { head: '', tail: text }
  const cut = snapToBoundary(chars, chars.length - keep, keep)
  if (cut <= 3) return { head: '', tail: text }
  return {
    head: chars.slice(0, cut).join(''),
    tail: chars.slice(cut).join(''),
  }
}

export function distinguishingTailLength(
  name: string,
  other: string,
  { min = DEFAULT_TAIL_LENGTH, max = MAX_TAIL_LENGTH }: { min?: number; max?: number } = {},
): number {
  const a = Array.from(name)
  const b = Array.from(other)
  let common = 0
  while (common < a.length && common < b.length && a[common] === b[common]) common += 1
  if (common === a.length) return Math.min(min, a.length)
  let start = common
  while (start > 0 && !SEPARATORS.has(a[start - 1] ?? '')) start -= 1
  if (start > 0) {
    start -= 1
    while (start > 0 && !SEPARATORS.has(a[start - 1] ?? '')) start -= 1
  }
  return Math.max(min, Math.min(max, a.length - start))
}
