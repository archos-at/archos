/**
 * What a plain base-corpus upload would store, by file name: the sha256 of
 * the one PDF, or of each PDF in a ZIP under its base name, as the corpus
 * keeps it (`agent_host.corpus_upload` on the api tier). The upload route
 * hands this to `refuseReplacingNamedTexts` (ADR-0165): the bytes of a file a
 * record names change only in a change request.
 *
 * Both tiers read one upload as the same thing. ZIP or PDF is decided by the
 * first bytes ({@link ZIP_MAGIC}, the api tier's `ZIP_MAGIC`), never by the
 * part's content type, and the name has to agree. A name is compared as
 * {@link corpusName} gives it. A member whose name two readers could take for
 * two names (a NUL, a backslash, a `..` step) refuses the whole upload.
 *
 * This is the early refusal with the helpful message. The rule itself is the
 * api tier's, the one place that writes: a name the corpus keeps never takes
 * other bytes (`oib_sync.store_and_request`), whatever this tier read.
 *
 * Fails closed: a ZIP this tier cannot read is refused, and a ZIP that holds
 * one base name twice with different bytes has no hash for that name, so a
 * record that names it refuses the upload whichever copy the corpus would keep.
 */

import 'server-only'
import { createHash } from 'node:crypto'
import { unzipSync } from 'fflate'
import { BadRequestError } from '@/lib/api/errors'

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

/** The hash no bytes have: a name whose bytes this tier cannot tell. */
const AMBIGUOUS = ''

/** What a ZIP's bytes start with: a local file header, an empty archive's end record, a spanned archive's marker. */
const ZIP_MAGIC: readonly (readonly number[])[] = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08],
]

const startsAsZip = (bytes: Uint8Array): boolean => ZIP_MAGIC.some((magic) => magic.every((byte, index) => bytes[index] === byte))

/** A file name as the corpus compares it: NFC, no surrounding whitespace (the api tier's `normalised_name`). */
export const corpusName = (name: string): string => name.normalize('NFC').trim()

/** A member name two readers could keep under two names: a NUL, a backslash, a `..` step. */
const unsafeMember = (path: string): boolean => path.includes('\0') || path.includes('\\') || path.split('/').includes('..')

export async function uploadedPdfHashes(file: File): Promise<Map<string, string>> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const name = corpusName(file.name)
  const isZip = startsAsZip(bytes)
  if (isZip !== name.toLowerCase().endsWith('.zip')) {
    throw new BadRequestError('The file’s name and its content disagree: a ZIP archive is named .zip, and nothing else is.')
  }
  if (!isZip) return new Map([[name, sha256(bytes)]])
  let members: Record<string, Uint8Array>
  let unsafe = false
  let twice = false
  const paths = new Set<string>()
  try {
    members = unzipSync(bytes, {
      filter: (member) => {
        unsafe ||= unsafeMember(member.name)
        // Directory entries aside, every member is counted, a PDF or not.
        if (!member.name.endsWith('/')) {
          const path = corpusName(member.name)
          twice ||= paths.has(path)
          paths.add(path)
        }
        return member.name.toLowerCase().endsWith('.pdf')
      },
    })
  } catch {
    throw new BadRequestError('The ZIP could not be read; upload its PDFs one by one.')
  }
  // One path twice: this reader keeps the last copy and the api tier's the first, so the hash here would not be of
  // the bytes stored there. Refused whole, as the api tier refuses it (`_open_archive`).
  if (twice) throw new BadRequestError('The ZIP holds one member path twice; remove the duplicate.')
  if (unsafe) {
    throw new BadRequestError('The ZIP holds a member whose name has a NUL, a backslash or a ".." step; rename it, or upload its PDFs one by one.')
  }
  const hashes = new Map<string, string>()
  for (const [path, content] of Object.entries(members)) {
    const member = corpusName(path.split('/').pop() ?? path)
    const hash = sha256(content)
    hashes.set(member, hashes.has(member) && hashes.get(member) !== hash ? AMBIGUOUS : hash)
  }
  return hashes
}
