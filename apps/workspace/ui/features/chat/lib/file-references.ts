export const FILE_REFERENCE_ANCHOR_PREFIX = 'file-ref-'

const FILE_TYPE_RE =
  /\.(pdf|docx?|odt|rtf|txt|md|xlsx?|ods|csv|tsv|pptx?|odp|png|jpe?g|webp|tiff?|gif|svg|dwg|dxf|ifc|ifczip|zip|eml|msg)\b/i

export const mentionsAnyFileType = (markdown: string): boolean => FILE_TYPE_RE.test(markdown)

export const fileNamesPresentIn = (
  markdown: string,
  fileNames: Iterable<string>
): string[] => {
  const haystack = markdown.toLowerCase()
  const found: string[] = []
  const seen = new Set<string>()
  for (const name of fileNames) {
    const trimmed = name.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    if (!haystack.includes(key)) continue
    seen.add(key)
    found.push(trimmed)
  }
  return found.sort((a, b) => b.length - a.length || a.localeCompare(b))
}

export const fileReferenceHref = (fileName: string): string =>
  `#${FILE_REFERENCE_ANCHOR_PREFIX}${encodeURIComponent(fileName)}`

export const fileNameFromHref = (href: string): string | null => {
  const id = href.startsWith('#') ? href.slice(1) : href
  if (!id.startsWith(FILE_REFERENCE_ANCHOR_PREFIX)) return null
  const encoded = id.slice(FILE_REFERENCE_ANCHOR_PREFIX.length)
  if (!encoded) return null
  try {
    return decodeURIComponent(encoded) || null
  } catch {
    return null
  }
}
