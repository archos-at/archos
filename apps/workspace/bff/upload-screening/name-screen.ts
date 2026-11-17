import type { UploadScreeningPolicy } from './policy'
import { SPLIT_TERM_MIN, splitTermEnd, TERM_FRAGMENT, withoutIgnorables } from './reading'

export type NameSegmentKind = 'file' | 'folder'

export interface NameMatch {
  term: string
  segment: string
  kind: NameSegmentKind
}

export interface NameVerdict {
  blocked: boolean
  matches: NameMatch[]
}

export interface ScreenedName {
  filename: string
  originPath?: string | null
  folderPath?: string | null
}

const UMLAUTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/ä/g, 'ae'],
  [/ö/g, 'oe'],
  [/ü/g, 'ue'],
  [/ß/g, 'ss'],
]

export function foldForScreening(text: string): string {
  let folded = text.normalize('NFKC').toLocaleLowerCase('de')
  for (const [pattern, replacement] of UMLAUTS) folded = folded.replace(pattern, replacement)
  return folded
}

const NAME_JOINERS = ' -_.\u2010\u2011'

function foldName(text: string): string {
  return foldForScreening(withoutIgnorables(text))
}

function occurrences(haystack: string, needle: string): Array<[number, number]> {
  const spans: Array<[number, number]> = []
  if (!needle) return spans
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at < 0) return spans
    spans.push([at, at + needle.length])
    from = at + 1
  }
}

function termOccurrences(haystack: string, term: string): Array<[number, number]> {
  if (term.length < SPLIT_TERM_MIN) return occurrences(haystack, term)
  return occurrences(haystack, term.slice(0, TERM_FRAGMENT)).flatMap(
    ([at]): Array<[number, number]> => {
      const end = splitTermEnd(haystack, at, term, NAME_JOINERS)
      return end > at ? [[at, end]] : []
    }
  )
}

function coveredBy(span: [number, number], covers: Array<[number, number]>): boolean {
  return covers.some(([start, end]) => start <= span[0] && span[1] <= end)
}

function matchSegment(
  segment: string,
  terms: readonly { raw: string; folded: string }[],
  exceptions: readonly string[]
): string | null {
  const folded = foldName(segment)
  const excepted = exceptions.flatMap((exception) => termOccurrences(folded, exception))
  for (const term of terms) {
    const hit = termOccurrences(folded, term.folded).some((span) => !coveredBy(span, excepted))
    if (hit) return term.raw
  }
  return null
}

function pathSegments(path: string | null | undefined): string[] {
  if (!path) return []
  return path
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function segmentsOf(name: ScreenedName): Array<{ segment: string; kind: NameSegmentKind }> {
  const origin = pathSegments(name.originPath)
  const originFolders = origin.length > 0 ? origin.slice(0, -1) : []
  const targetFolders = pathSegments(name.folderPath)
  const seen = new Set<string>()
  const out: Array<{ segment: string; kind: NameSegmentKind }> = []
  const add = (segment: string, kind: NameSegmentKind): void => {
    const key = `${kind}:${segment}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ segment, kind })
  }
  add(name.filename, 'file')
  for (const folder of [...originFolders, ...targetFolders]) add(folder, 'folder')
  return out
}

export function screenUploadName(policy: UploadScreeningPolicy, name: ScreenedName): NameVerdict {
  if (!policy.enabled || policy.nameTerms.length === 0) return { blocked: false, matches: [] }
  const terms = policy.nameTerms.map((raw) => ({ raw, folded: foldName(raw) }))
  const exceptions = policy.nameExceptions.map(foldName)
  const matches: NameMatch[] = []
  for (const { segment, kind } of segmentsOf(name)) {
    const term = matchSegment(segment, terms, exceptions)
    if (term) matches.push({ term, segment, kind })
  }
  return { blocked: matches.length > 0, matches }
}
