import type { CitationRef, CitedDocument } from './model'

export const CITATION_PARAM = 'cite'

const SEPARATOR = ','

const toBase64Url = (text: string): string => {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const fromBase64Url = (value: string): string | null => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
    return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)))
  } catch {
    return null
  }
}

export interface CitationLink {
  documentId: string
  locusKey?: string
}

export const encodeCitationLink = (ref: CitationRef): string => {
  const document = encodeURIComponent(ref.document.id)
  const locus = ref.locus ? `${SEPARATOR}${encodeURIComponent(ref.locus.key)}` : ''
  return toBase64Url(`${document}${locus}`)
}

export const parseCitationLink = (value: string | null | undefined): CitationLink | null => {
  const raw = fromBase64Url((value ?? '').trim())
  if (!raw) return null
  const separatorAt = raw.indexOf(SEPARATOR)
  const documentPart = separatorAt === -1 ? raw : raw.slice(0, separatorAt)
  const locusPart = separatorAt === -1 ? undefined : raw.slice(separatorAt + 1)
  const decode = (part: string | undefined): string | undefined => {
    if (!part) return undefined
    try {
      return decodeURIComponent(part) || undefined
    } catch {
      return undefined
    }
  }
  const documentId = decode(documentPart)
  if (!documentId) return null
  return { documentId, locusKey: decode(locusPart) }
}

export const resolveCitationLink = (
  link: CitationLink | null,
  documents: CitedDocument[]
): CitationRef | null => {
  if (!link) return null
  const document = documents.find((candidate) => candidate.id === link.documentId)
  if (!document) return null
  if (!link.locusKey) return { document }
  const locus = document.loci.find((candidate) => candidate.key === link.locusKey)
  return locus ? { document, locus } : { document }
}

export const citationShareUrl = (
  ref: CitationRef,
  location: { origin: string; pathname: string; search?: string }
): string => {
  const params = new URLSearchParams(location.search ?? '')
  params.set(CITATION_PARAM, encodeCitationLink(ref))
  return `${location.origin}${location.pathname}?${params.toString()}`
}
