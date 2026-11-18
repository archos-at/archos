export function documentNameKey(name: string): string {
  return name.normalize('NFC').trim()
}

export function documentNameVariants(name: string): string[] {
  const key = documentNameKey(name)
  const decomposed = key.normalize('NFD')
  return decomposed === key ? [key] : [key, decomposed]
}

export function documentAliasKey(name: string): string {
  return documentNameKey(name).toLowerCase()
}

export function originBaseName(path: string | null | undefined): string | null {
  if (!path) return null
  const segments = path.split(/[\\/]+/).filter(Boolean)
  return segments.length > 0 ? segments[segments.length - 1] : null
}
