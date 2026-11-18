import { splitDocumentName, MAX_DOCUMENT_NAME_LENGTH } from '@/lib/documents/display-name'
import { documentNameKey } from '@/lib/documents/name-match'
import { numberedFilename } from '@/lib/mail-import/naming'
import { singleLine, truncateGraphemes } from '@/lib/text/graphemes'

const MAX_EXTENSION_LENGTH = 16

const WINDOWS_RESERVED_STEM = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i


export function safeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? ''
  const clean = documentNameKey(singleLine(base).replace(/\uFFFD/g, '_').replace(/[<>:"|?*]/g, '_'))
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '')
    .replace(/^[^.]*/, (segment) => (WINDOWS_RESERVED_STEM.test(segment) ? `${segment}_` : segment))
  const { stem, extension } = splitDocumentName(clean)
  const kept = extension.length <= MAX_EXTENSION_LENGTH ? extension : ''
  const head = kept ? stem : clean
  if (head.length + kept.length <= MAX_DOCUMENT_NAME_LENGTH) return clean
  return truncateGraphemes(head, MAX_DOCUMENT_NAME_LENGTH - kept.length).replace(/[.\s]+$/, '') + kept
}

const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/

export function safeMediaType(declared: string): string {
  const type = (declared.split(';', 1)[0] ?? '').trim().toLowerCase()
  return MEDIA_TYPE.test(type) ? type : 'application/octet-stream'
}

export class NameLedger {
  private readonly taken = new Set<string>()
  private readonly digestsByName = new Map<string, Set<string>>()
  private readonly nextNumber = new Map<string, number>()

  claim(name: string, digest: string): string | null {
    const key = documentNameKey(name)
    const digests = this.digestsByName.get(key) ?? new Set<string>()
    if (digests.has(digest)) return null
    digests.add(digest)
    this.digestsByName.set(key, digests)
    const filename = this.taken.has(key) ? this.numbered(name, key) : name
    this.taken.add(documentNameKey(filename))
    return filename
  }

  private readonly namelessDigests = new Set<string>()

  claimNameless(digest: string): boolean {
    if (this.namelessDigests.has(digest)) return false
    this.namelessDigests.add(digest)
    return true
  }

  private numbered(name: string, key: string): string {
    let n = this.nextNumber.get(key) ?? 2
    while (this.taken.has(documentNameKey(numberedFilename(name, n)))) n += 1
    this.nextNumber.set(key, n + 1)
    return documentNameKey(numberedFilename(name, n))
  }
}
