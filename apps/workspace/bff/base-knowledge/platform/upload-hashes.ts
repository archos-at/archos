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
import { ApiError, BadRequestError } from '@/lib/api/errors'

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

/** The most one upload holds, and the most a ZIP's PDFs unpack to: the api tier's `MAX_OIB_UPLOAD_BYTES`. */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024

export async function uploadedPdfHashes(file: File, maxBytes = MAX_UPLOAD_BYTES): Promise<Map<string, string>> {
  const tooLarge = `The upload is larger than ${Math.floor(maxBytes / (1024 * 1024))} MB, itself or unpacked; upload its PDFs in smaller parts.`
  if (file.size > maxBytes) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', tooLarge)
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
  // What the PDFs would unpack to, by the sizes the archive declares: unzipSync allocates each member's declared
  // size, so a small archive of zeros is refused before anything is inflated. A stored member is copied by its
  // compressed size whatever it declares to unpack to, and many entries may point at one payload, so the larger
  // of the two sizes counts: an entry that declares nothing still costs its payload.
  let unpacked = 0
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
        if (!member.name.toLowerCase().endsWith('.pdf')) return false
        unpacked += Math.max(member.size, member.originalSize)
        return unpacked <= maxBytes
      },
    })
  } catch {
    throw new BadRequestError('The ZIP could not be read; upload its PDFs one by one.')
  }
  // One path twice: this reader keeps the last copy and the api tier's the first, so the hash here would not be of
  // the bytes stored there. Refused whole, as the api tier refuses it (`_open_archive`).
  if (unpacked > maxBytes) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', tooLarge)
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
