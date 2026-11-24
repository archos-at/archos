const fold = (text: string): string => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('de')

export function matchesEveryWord(fields: readonly (string | null | undefined)[], query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = fold(fields.filter(Boolean).join(' '))
  return words.every((word) => haystack.includes(word))
}
