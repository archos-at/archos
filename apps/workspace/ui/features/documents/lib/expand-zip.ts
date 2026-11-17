import { unzipSync, type UnzipFileInfo } from 'fflate'
import { formatBytes } from '@/lib/format'
import { mimeTypeForFileName } from '@/shared/config/file-upload'
import { stampRelativePath } from './dropped-entries'
import { isZipArchive } from './zip-types'

export const MAX_ZIP_ENTRIES = 2000

export const MAX_ZIP_UNPACKED_BYTES = 1024 * 1024 * 1024

export type ZipRefusal = 'unreadable' | 'empty' | 'tooManyFiles' | 'tooLarge'

export interface ZipNote {
  zip: string
  reason: ZipRefusal
  limit: string
}

export interface ZipExpansion {
  files: File[]
  notes: ZipNote[]
}

const JUNK_SEGMENT = /^(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini|\._.*|~\$.*)$/i

function safeSegments(entryName: string): string[] | null {
  const segments = entryName.replace(/\\/g, '/').split('/').filter((s) => s !== '' && s !== '.')
  if (segments.some((segment) => segment === '..')) return null
  return segments
}

const isJunk = (segments: readonly string[]): boolean =>
  segments.some((segment) => JUNK_SEGMENT.test(segment))

function rootFor(zipName: string, members: readonly string[][]): string | null {
  const first = members[0]?.[0]
  const sharesOneRoot = members.every((segments) => segments.length > 1 && segments[0] === first)
  return sharesOneRoot ? null : zipName.replace(/\.zip$/i, '')
}

function folderOf(zip: File): string[] {
  const segments = safeSegments(zip.webkitRelativePath ?? '') ?? []
  return segments.slice(0, -1)
}

interface Admission {
  admit: (info: UnzipFileInfo) => boolean
  entries: () => number
  unpackedBytes: () => number
}

function admission(): Admission {
  let entries = 0
  let unpackedBytes = 0
  const admit = (info: UnzipFileInfo): boolean => {
    if (info.name.endsWith('/')) return false
    const segments = safeSegments(info.name)
    if (!segments || segments.length === 0 || isJunk(segments)) return false
    entries += 1
    unpackedBytes += info.originalSize
    return entries <= MAX_ZIP_ENTRIES && unpackedBytes <= MAX_ZIP_UNPACKED_BYTES
  }
  return { admit, entries: () => entries, unpackedBytes: () => unpackedBytes }
}

const LIMIT_TEXT: Record<ZipRefusal, string> = {
  unreadable: '',
  empty: '',
  tooManyFiles: String(MAX_ZIP_ENTRIES),
  tooLarge: formatBytes(MAX_ZIP_UNPACKED_BYTES),
}

const refusal = (zip: File, reason: ZipRefusal): ZipExpansion => ({
  files: [],
  notes: [{ zip: zip.name, reason, limit: LIMIT_TEXT[reason] }],
})

async function expandZip(zip: File): Promise<ZipExpansion> {
  const gate = admission()
  let archive: Record<string, Uint8Array>
  try {
    archive = unzipSync(new Uint8Array(await zip.arrayBuffer()), { filter: gate.admit })
  } catch {
    return refusal(zip, 'unreadable')
  }
  if (gate.entries() > MAX_ZIP_ENTRIES) return refusal(zip, 'tooManyFiles')
  if (gate.unpackedBytes() > MAX_ZIP_UNPACKED_BYTES) return refusal(zip, 'tooLarge')

  const members = Object.entries(archive)
    .map(([name, bytes]) => ({ segments: safeSegments(name) ?? [], bytes }))
    .sort((a, b) => a.segments.join('/').localeCompare(b.segments.join('/')))
  if (members.length === 0) return refusal(zip, 'empty')

  const root = rootFor(zip.name, members.map((member) => member.segments))
  const base = [...folderOf(zip), ...(root ? [root] : [])]
  const files = members.map(({ segments, bytes }) => {
    const name = segments[segments.length - 1]
    const file = new File([bytes as BlobPart], name, { type: mimeTypeForFileName(name) })
    return stampRelativePath(file, [...base, ...segments].join('/'))
  })
  return { files, notes: [] }
}

export async function expandZips(files: readonly File[]): Promise<ZipExpansion> {
  const out: File[] = []
  const notes: ZipNote[] = []
  for (const file of files) {
    if (!isZipArchive(file)) {
      out.push(file)
      continue
    }
    const expanded = await expandZip(file)
    out.push(...expanded.files)
    notes.push(...expanded.notes)
  }
  return { files: out, notes }
}
