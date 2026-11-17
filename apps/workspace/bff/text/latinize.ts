const GERMAN: ReadonlyArray<readonly [RegExp, string]> = [
  [/ä/g, 'ae'],
  [/ö/g, 'oe'],
  [/ü/g, 'ue'],
  [/Ä/g, 'Ae'],
  [/Ö/g, 'Oe'],
  [/Ü/g, 'Ue'],
  [/ß/g, 'ss'],
  [/ẞ/g, 'SS'],
]

const NON_DECOMPOSING_LATIN: ReadonlyArray<readonly [RegExp, string]> = [
  [/ø/g, 'oe'],
  [/Ø/g, 'Oe'],
  [/æ/g, 'ae'],
  [/Æ/g, 'Ae'],
  [/œ/g, 'oe'],
  [/Œ/g, 'Oe'],
  [/ł/g, 'l'],
  [/Ł/g, 'L'],
  [/đ/g, 'd'],
  [/Đ/g, 'D'],
  [/ð/g, 'd'],
  [/Ð/g, 'D'],
  [/þ/g, 'th'],
  [/Þ/g, 'Th'],
  [/ı/g, 'i'],
]

export function transliterateGerman(value: string): string {
  return GERMAN.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), value.normalize('NFC'))
}

export function foldDiacritics(value: string): string {
  const spelled = NON_DECOMPOSING_LATIN.reduce(
    (acc, [pattern, replacement]) => acc.replace(pattern, replacement),
    value
  )
  return spelled.normalize('NFKD').replace(/\p{M}/gu, '')
}

export function latinize(value: string): string {
  return foldDiacritics(transliterateGerman(value))
}

export function fileSlug(value: string, options: { maxLength?: number; lowercase?: boolean } = {}): string {
  const { maxLength = 60, lowercase = true } = options
  const cleaned = latinize(value)
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const cased = lowercase ? cleaned.toLowerCase() : cleaned
  return cased.slice(0, maxLength).replace(/-+$/, '')
}
