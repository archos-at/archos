import 'server-only'

const LOCAL_HEADER_SIGNATURE = 0x04034b50
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50
const ZIP64_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06064b50

const ZIP64_EXTRA_FIELD_ID = 0x0001

const SIZE_OVERFLOW = 0xffffffff

const MAX_END_OF_CENTRAL_DIRECTORY_SCAN = 22 + 0xffff

const MODEL_ENTRY = /\.(ifc|ifcxml)$/i

export class IfcArchiveError extends Error {
  constructor(
    readonly code: 'not-ifc' | 'too-large',
    message: string
  ) {
    super(message)
    this.name = 'IfcArchiveError'
  }
}

export interface IfcArchiveEntry {
  name: string
  uncompressedBytes: number
}

export function isZipArchive(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 4) return false
  return new DataView(buffer).getUint32(0, true) === LOCAL_HEADER_SIGNATURE
}

function findEndOfCentralDirectory(view: DataView): number {
  const from = Math.max(0, view.byteLength - MAX_END_OF_CENTRAL_DIRECTORY_SCAN)
  for (let offset = view.byteLength - 22; offset >= from; offset -= 1) {
    if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) return offset
  }
  return -1
}

function readDirectoryLocation(view: DataView): { offset: number; entries: number } | null {
  const eocd = findEndOfCentralDirectory(view)
  if (eocd < 0) return null

  let entries = view.getUint16(eocd + 10, true)
  let offset = view.getUint32(eocd + 16, true)

  if (entries === 0xffff || offset === SIZE_OVERFLOW) {
    const locator = eocd - 20
    if (locator < 0 || view.getUint32(locator, true) !== ZIP64_LOCATOR_SIGNATURE) return null
    const record = Number(view.getBigUint64(locator + 8, true))
    if (
      !Number.isSafeInteger(record) ||
      record < 0 ||
      record + 56 > view.byteLength ||
      view.getUint32(record, true) !== ZIP64_END_OF_CENTRAL_DIRECTORY_SIGNATURE
    ) {
      return null
    }
    entries = Number(view.getBigUint64(record + 32, true))
    offset = Number(view.getBigUint64(record + 48, true))
  }

  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= view.byteLength) return null
  return { offset, entries }
}

function readZip64UncompressedSize(view: DataView, extraStart: number, extraLength: number): number | null {
  let cursor = extraStart
  const end = extraStart + extraLength
  while (cursor + 4 <= end) {
    const id = view.getUint16(cursor, true)
    const size = view.getUint16(cursor + 2, true)
    if (cursor + 4 + size > end) return null
    if (id === ZIP64_EXTRA_FIELD_ID && size >= 8) {
      const value = Number(view.getBigUint64(cursor + 4, true))
      return Number.isSafeInteger(value) ? value : null
    }
    cursor += 4 + size
  }
  return null
}

export function readArchiveModelEntries(buffer: ArrayBuffer): IfcArchiveEntry[] {
  const view = new DataView(buffer)
  const location = readDirectoryLocation(view)
  if (!location) {
    throw new IfcArchiveError('not-ifc', 'The archive directory could not be read')
  }

  const entries: IfcArchiveEntry[] = []
  let cursor = location.offset
  for (let index = 0; index < location.entries; index += 1) {
    if (cursor + 46 > view.byteLength) {
      throw new IfcArchiveError('not-ifc', 'The archive directory could not be read')
    }
    if (view.getUint32(cursor, true) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new IfcArchiveError('not-ifc', 'The archive directory could not be read')
    }
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const nameStart = cursor + 46
    if (nameStart + nameLength + extraLength + commentLength > view.byteLength) {
      throw new IfcArchiveError('not-ifc', 'The archive directory could not be read')
    }

    const name = new TextDecoder('utf-8').decode(
      new Uint8Array(buffer, nameStart, nameLength)
    )
    let uncompressedBytes = view.getUint32(cursor + 24, true)
    if (uncompressedBytes === SIZE_OVERFLOW) {
      const wide = readZip64UncompressedSize(view, nameStart + nameLength, extraLength)
      if (wide === null) {
        throw new IfcArchiveError('not-ifc', 'The archive directory could not be read')
      }
      uncompressedBytes = wide
    }

    const basename = name.slice(name.lastIndexOf('/') + 1)
    if (MODEL_ENTRY.test(basename) && !basename.startsWith('._')) {
      entries.push({ name, uncompressedBytes })
    }
    cursor = nameStart + nameLength + extraLength + commentLength
  }
  return entries
}

export async function unwrapIfcArchive(
  buffer: ArrayBuffer,
  maxBytes: number
): Promise<{ bytes: ArrayBuffer; archived: boolean }> {
  if (!isZipArchive(buffer)) return { bytes: buffer, archived: false }

  const entries = readArchiveModelEntries(buffer)
  if (entries.length === 0) {
    throw new IfcArchiveError('not-ifc', 'The archive contains no IFC file')
  }
  if (entries.length > 1) {
    throw new IfcArchiveError(
      'not-ifc',
      `The archive contains ${entries.length} IFC files; it must contain exactly one`
    )
  }

  const [entry] = entries
  if (entry.uncompressedBytes > maxBytes) {
    throw new IfcArchiveError('too-large', tooLargeMessage(entry.uncompressedBytes, maxBytes))
  }

  const { unwrapIfcZip } = await import('@ifc-lite/parser')
  let bytes: ArrayBuffer
  try {
    bytes = await unwrapIfcZip(buffer)
  } catch (error) {
    throw new IfcArchiveError(
      'not-ifc',
      `The archive could not be opened: ${error instanceof Error ? error.message : 'unknown error'}`
    )
  }
  if (bytes.byteLength > maxBytes) {
    throw new IfcArchiveError('too-large', tooLargeMessage(bytes.byteLength, maxBytes))
  }
  return { bytes, archived: true }
}

function tooLargeMessage(bytes: number, maxBytes: number): string {
  const mb = (value: number): number => Math.round(value / 1024 / 1024)
  return `Unpacked model is ${mb(bytes)} MB, above the ${mb(maxBytes)} MB extraction limit`
}
