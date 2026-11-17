import 'server-only'
import { createHash } from 'node:crypto'
import { unzipSync } from 'fflate'
import { ApiError, BadRequestError } from '@/lib/api/errors'

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

const AMBIGUOUS = ''

const ZIP_MAGIC: readonly (readonly number[])[] = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08],
]

const startsAsZip = (bytes: Uint8Array): boolean => ZIP_MAGIC.some((magic) => magic.every((byte, index) => bytes[index] === byte))

export const corpusName = (name: string): string => name.normalize('NFC').trim()

const unsafeMember = (path: string): boolean => path.includes('\0') || path.includes('\\') || path.split('/').includes('..')

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
  let unpacked = 0
  const paths = new Set<string>()
  try {
    members = unzipSync(bytes, {
      filter: (member) => {
        unsafe ||= unsafeMember(member.name)
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
