export const MAX_DOCUMENT_NAME_LENGTH = 200

export interface NamedDocument {
  filename: string
  displayName?: string | null
}

export function documentDisplayName(document: NamedDocument): string {
  const renamed = document.displayName?.trim()
  return renamed ? renamed : document.filename
}

export function splitDocumentName(name: string): { stem: string; extension: string } {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return { stem: name, extension: '' }
  return { stem: name.slice(0, dot), extension: name.slice(dot) }
}

export type DocumentNameError = 'empty' | 'tooLong' | 'invalidCharacters'

export type DocumentNameResult =
  | { ok: true; value: string }
  | { ok: false; reason: DocumentNameError }

// eslint-disable-next-line no-control-regex -- catching control characters is the point
const INVALID_NAME_CHARACTERS = /[/\\\u0000-\u001f\u007f]/

export function validateDocumentName(input: string): DocumentNameResult {
  const value = input.trim()
  if (value === '') return { ok: false, reason: 'empty' }
  if (value.length > MAX_DOCUMENT_NAME_LENGTH) return { ok: false, reason: 'tooLong' }
  if (INVALID_NAME_CHARACTERS.test(value)) return { ok: false, reason: 'invalidCharacters' }
  return { ok: true, value }
}

export function composeDocumentName(stem: string, originalName: string): string {
  const { extension } = splitDocumentName(originalName)
  const trimmed = stem.trim()
  if (extension === '') return trimmed
  return trimmed.toLowerCase().endsWith(extension.toLowerCase()) ? trimmed : `${trimmed}${extension}`
}
