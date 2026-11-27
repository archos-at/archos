import { splitDocumentName } from './display-name'
import { documentNameKey, documentNameMatchKey } from './name-match'

const NUMBERED_STEM = /^(.*\S) ([1-9]\d{0,2})$/

export function documentNameFamily(name: string): { stem: string; next: number; extension: string } {
  const { stem, extension } = splitDocumentName(documentNameKey(name))
  const numbered = NUMBERED_STEM.exec(stem)
  return numbered
    ? { stem: numbered[1], next: Number(numbered[2]) + 1, extension }
    : { stem, next: 2, extension }
}

export function nextFreeDocumentName(name: string, takenKeys: ReadonlySet<string>): string {
  const { stem, next, extension } = documentNameFamily(name)
  for (let number = next; ; number += 1) {
    const candidate = `${stem} ${number}${extension}`
    if (!takenKeys.has(documentNameMatchKey(candidate))) return candidate
  }
}
