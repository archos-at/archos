import { latinize } from './latinize'
import vocabulary from './operation-search-vocabulary.json'

export interface SearchableOperation {
  name: string
  summary: string
  description: string
}

export const PREFIX_MATCH_MIN_LENGTH = 5

const TERMS: ReadonlyArray<readonly [string, readonly string[]]> = Object.entries(vocabulary.terms)

const INFLECTIONS: ReadonlySet<string> = new Set(vocabulary.inflections)

function isFormOf(word: string, term: string): boolean {
  if (term.length < PREFIX_MATCH_MIN_LENGTH) return word === term
  return word.startsWith(term) && INFLECTIONS.has(word.slice(term.length))
}

export function foldSearchText(text: string): string {
  return latinize(text).toLowerCase()
}

function meaningsOf(word: string): string[] {
  const found = new Set<string>()
  for (const [term, meanings] of TERMS) {
    if (isFormOf(word, term)) for (const meaning of meanings) found.add(meaning)
  }
  found.delete(word)
  return [...found]
}

export const COMPOUND_MIN_LENGTH = 10

export const MIN_WORD_LENGTH = 2

function compoundParts(word: string): string[] {
  if (word.length < COMPOUND_MIN_LENGTH) return []
  const found: { at: number; term: string }[] = []
  for (const [term] of TERMS) {
    if (term.length < PREFIX_MATCH_MIN_LENGTH) continue
    const at = word.indexOf(term)
    if (at >= 0) found.push({ at, term })
  }
  found.sort((a, b) => a.at - b.at || b.term.length - a.term.length)
  const parts: string[] = []
  let end = 0
  for (const { at, term } of found) {
    if (at < end) continue
    parts.push(term)
    end = at + term.length
  }
  return parts.length >= 2 ? parts : []
}

export function searchWordGroups(query: string): string[][] {
  const words = foldSearchText(query)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= MIN_WORD_LENGTH)
  return words.flatMap((word) => {
    const parts = compoundParts(word)
    if (parts.length > 0) return parts.map((part) => [part, ...meaningsOf(part)])
    return [[word, ...meaningsOf(word)]]
  })
}

export const STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'about', 'all', 'am', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'does', 'for',
  'from', 'get', 'give', 'has', 'have', 'how', 'i', 'in', 'into', 'is', 'it', 'its', 'me', 'my', 'of', 'on', 'or',
  'our', 'please', 'show', 'some', 'tell', 'that', 'the', 'their', 'there', 'this', 'to', 'under', 'us', 'want',
  'was', 'we', 'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with', 'you', 'your',
  'auf', 'aus', 'bei', 'bitte', 'das', 'dem', 'den', 'der', 'des', 'die', 'ein', 'eine', 'einem', 'einen', 'einer',
  'eines', 'es', 'fuer', 'gibt', 'hat', 'ich', 'im', 'ist', 'mir', 'mit', 'sagt', 'sind', 'und', 'unser', 'unsere',
  'von', 'vom', 'was', 'welche', 'welcher', 'welches', 'wer', 'wie', 'wir', 'zu', 'zum', 'zur',
])

export function stemSearchWord(word: string): string {
  if (word.length <= 4) return word
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.endsWith('ing') && word.length >= 6) return word.slice(0, -3)
  if (word.endsWith('ed') && word.length >= 5) return word.slice(0, -2)
  if (/(?:ss|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2)
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

function wordsOf(text: string): string[] {
  return foldSearchText(text)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= MIN_WORD_LENGTH)
}

export const WORD_PREFIX_MIN_LENGTH = 4

function wordMatches(word: string, token: string): boolean {
  if (token === word) return true
  if (word.length >= WORD_PREFIX_MIN_LENGTH && token.startsWith(word)) return true
  return stemSearchWord(token) === stemSearchWord(word)
}

interface IndexedOperation {
  name: readonly string[]
  summary: readonly string[]
  description: readonly string[]
}

function indexOperation(op: SearchableOperation): IndexedOperation {
  return { name: wordsOf(op.name), summary: wordsOf(op.summary), description: wordsOf(op.description) }
}

const contains = (words: readonly string[], word: string): boolean => words.some((token) => wordMatches(word, token))

function rarityOf(corpus: readonly IndexedOperation[]): (word: string) => number {
  if (corpus.length === 0) return () => 1
  const cache = new Map<string, number>()
  return (word) => {
    const known = cache.get(word)
    if (known !== undefined) return known
    const df = corpus.filter((op) => contains(op.name, word) || contains(op.summary, word) || contains(op.description, word)).length
    const weight = Math.log(1 + corpus.length / (1 + df))
    cache.set(word, weight)
    return weight
  }
}

function rankedWordGroups(query: string): string[][] {
  const all = searchWordGroups(query)
  const meaningful = all.filter((group) => !STOPWORDS.has(group[0]))
  return meaningful.length > 0 ? meaningful : all
}

export function queryLineMatcher(query: string): (line: string) => boolean {
  const words = rankedWordGroups(query).flat()
  if (words.length === 0) return () => false
  return (line) => {
    const tokens = wordsOf(line)
    return words.some((word) => contains(tokens, word))
  }
}

export function operationScorer(
  query: string,
  corpus: readonly SearchableOperation[] = [],
): (op: SearchableOperation) => number {
  const groups = rankedWordGroups(query)
  const listsAll = query.trim() === ''
  const rarity = rarityOf(corpus.map(indexOperation))
  return (op) => {
    if (groups.length === 0) return listsAll ? 1 : 0
    const indexed = indexOperation(op)
    const lead = indexed.summary[0]
    const placeOf = (word: string): number =>
      (contains(indexed.name, word) ? 3 : 0) +
      (contains(indexed.summary, word) ? 2 : 0) +
      (contains(indexed.description, word) ? 1 : 0) +
      (lead !== undefined && wordMatches(word, lead) ? 1 : 0)
    let total = 0
    let matched = 0
    for (const group of groups) {
      const score = Math.max(...group.map((word) => placeOf(word) * rarity(word)))
      if (score > 0) matched += 1
      total += score
    }
    return Math.round(total * (matched / groups.length) * 1e6) / 1e6
  }
}
