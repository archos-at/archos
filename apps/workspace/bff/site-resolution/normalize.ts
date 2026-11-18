function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function expandAbbreviations(folded: string): string {
  return folded.replace(/str\b\.?/g, 'strasse').replace(/\bst\b\.?/g, 'sankt ')
}

function squeeze(text: string): string {
  return text.replace(/[^\p{L}\p{N}]/gu, '')
}

export function streetKey(name: string): string {
  return squeeze(expandAbbreviations(fold(name)))
}

export function placeKey(name: string): string {
  return squeeze(expandAbbreviations(fold(name)))
}

export function houseKey(number: string): string {
  return fold(number).replace(/\s+/g, '')
}
