export function documentNameKey(name: string): string {
  return name.normalize('NFC').trim()
}

export function documentNameMatchKey(name: string): string {
  return name.normalize('NFC').trim().toLowerCase()
}

interface NamedDocument {
  filename: string
  displayName?: string | null
}

export function heldDocumentName(document: NamedDocument, name: string): string | null {
  const key = documentNameMatchKey(name)
  if (documentNameMatchKey(document.filename) === key) return document.filename
  if (document.displayName && documentNameMatchKey(document.displayName) === key) return document.displayName
  return null
}

export function holdsDocumentName(document: NamedDocument, name: string): boolean {
  return heldDocumentName(document, name) !== null
}

export function documentNameVariants(name: string): string[] {
  const key = documentNameKey(name)
  const decomposed = key.normalize('NFD')
  return decomposed === key ? [key] : [key, decomposed]
}

export function documentAliasKey(name: string): string {
  return documentNameMatchKey(name)
}

export function originBaseName(path: string | null | undefined): string | null {
  if (!path) return null
  const segments = path.split(/[\\/]+/).filter(Boolean)
  return segments.length > 0 ? segments[segments.length - 1] : null
}
