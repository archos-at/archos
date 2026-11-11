/**
 * What a plain base-corpus upload would store, by file name: the sha256 of
 * the one PDF, or of each PDF in a ZIP under its base name, as the corpus
 * keeps it (`_extract_zip_pdfs` on the api tier). The upload route hands this
 * to `refuseReplacingNamedTexts` (ADR-0165): the bytes of a file a record
 * names change only in a change request.
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

const baseName = (path: string): string => path.split(/[/\\]/).pop() ?? path

export async function uploadedPdfHashes(file: File): Promise<Map<string, string>> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const name = file.name.trim()
  if (!name.toLowerCase().endsWith('.zip')) return new Map([[name, sha256(bytes)]])
  let members: Record<string, Uint8Array>
  try {
    members = unzipSync(bytes, { filter: (member) => member.name.toLowerCase().endsWith('.pdf') })
  } catch {
    throw new BadRequestError('The ZIP could not be read; upload its PDFs one by one.')
  }
  const hashes = new Map<string, string>()
  for (const [path, content] of Object.entries(members)) {
    const member = baseName(path)
    const hash = sha256(content)
    hashes.set(member, hashes.has(member) && hashes.get(member) !== hash ? AMBIGUOUS : hash)
  }
  return hashes
}
