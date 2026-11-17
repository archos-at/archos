import { readFileSync } from 'node:fs'
import path from 'node:path'

const REPO_ROOT = path.resolve(__dirname, '../../../..')

interface GermanStems {
  stems: string[]
  prose_words: string[]
}

const LIST = JSON.parse(readFileSync(path.join(REPO_ROOT, 'ci', 'german_stems.json'), 'utf8')) as GermanStems

export const GERMAN_STEMS: readonly string[] = LIST.stems
const STEM = new RegExp(LIST.stems.join('|'))
const PROSE_WORDS = new Set(LIST.prose_words)
const UMLAUT = /[äöüÄÖÜß]/
const IDENTIFIER_WORDS = /[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+/g

export function germanIdentifierWords(identifier: string): string[] {
  const words = identifier.split('_').flatMap((part) => part.match(IDENTIFIER_WORDS) ?? [])
  return words.map((word) => word.toLowerCase()).filter((word) => STEM.test(word))
}

export function germanProseWords(text: string): string[] {
  const words = text.match(/\p{L}+/gu) ?? []
  return words.filter((word) => {
    const lower = word.toLowerCase()
    return UMLAUT.test(word) || STEM.test(lower) || PROSE_WORDS.has(lower)
  })
}
