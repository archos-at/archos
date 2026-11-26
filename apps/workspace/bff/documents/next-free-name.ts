import { splitDocumentName } from './display-name'
import { documentNameKey, documentNameMatchKey } from './name-match'

export function nextFreeDocumentName(name: string, takenKeys: ReadonlySet<string>): string {
  const { stem, extension } = splitDocumentName(documentNameKey(name))
  for (let number = 2; ; number += 1) {
    const candidate = `${stem} ${number}${extension}`
    if (!takenKeys.has(documentNameMatchKey(candidate))) return candidate
  }
}
