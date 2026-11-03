/**
 * The names a staged part is filed under (ADR-0137): safe to file and to
 * download, and distinct within one mail. Part of reading a message
 * (`./mime.ts`).
 */

import { splitDocumentName, MAX_DOCUMENT_NAME_LENGTH } from '@/lib/documents/display-name'
import { documentNameKey } from '@/lib/documents/name-match'
import { numberedFilename } from '@/lib/mail-import/naming'
import { singleLine, truncateGraphemes } from '@/lib/text/graphemes'

/** An extension is at most this long, the dot included; past it the name has none worth keeping. */
const MAX_EXTENSION_LENGTH = 16

/** What a name may be on Windows, where these devices are not files. */
const WINDOWS_RESERVED_STEM = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i


/**
 * A filename that is safe to file and to download: the last path segment only
 * (some mailers send `C:\Users\…\Plan.pdf`), one line without format or
 * control characters, NFC, no characters Windows refuses, no leading dots, no
 * trailing dots or spaces, no bare device name (`CON.pdf` becomes `CON_.pdf`),
 * cut between graphemes before the extension to
 * `MAX_DOCUMENT_NAME_LENGTH`. `''` when nothing is left.
 */
export function safeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? ''
  // U+FFFD is what an undeclared 8-bit name (a scanner's Latin-1) decodes to.
  const clean = documentNameKey(singleLine(base).replace(/\uFFFD/g, '_').replace(/[<>:"|?*]/g, '_'))
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '')
    // Windows reads `CON.pdf` and `con.tar.gz` as the device: the segment before the first dot counts.
    .replace(/^[^.]*/, (segment) => (WINDOWS_RESERVED_STEM.test(segment) ? `${segment}_` : segment))
  const { stem, extension } = splitDocumentName(clean)
  const kept = extension.length <= MAX_EXTENSION_LENGTH ? extension : ''
  const head = kept ? stem : clean
  if (head.length + kept.length <= MAX_DOCUMENT_NAME_LENGTH) return clean
  return truncateGraphemes(head, MAX_DOCUMENT_NAME_LENGTH - kept.length).replace(/[.\s]+$/, '') + kept
}

/**
 * Distinct names in one pass: the second `Plan.pdf` becomes `Plan (2).pdf`,
 * compared on the documents' own identity key (`documentNameKey`). The same
 * bytes under the same name are staged once. Linear: each name keeps its next
 * free number, so a thousand `image.png` never rescan from `(2)`.
 */
export class NameLedger {
  private readonly taken = new Set<string>()
  private readonly digestsByName = new Map<string, Set<string>>()
  private readonly nextNumber = new Map<string, number>()

  /** The name to stage under, or null when these bytes already went under this name. */
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

  /** Whether these bytes, nameless, are new to this mail (and now claimed). */
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
