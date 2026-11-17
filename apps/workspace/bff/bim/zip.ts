const MAX_ENTRY_BYTES = 0xffffffff
const MAX_ENTRIES = 0xffff

const FLAG_UTF8_NAMES = 0x0800

const DOS_DATE = (1 << 5) | 1
const DOS_TIME = 0

export interface ZipEntry {
  path: string
  content: string | Uint8Array
}

const DOS_DIRECTORY = 0x10

const isDirectoryPath = (path: string): boolean => path.endsWith('/')

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

class ByteWriter {
  private readonly chunks: Uint8Array[] = []
  private length = 0

  u16(value: number): void {
    this.push(new Uint8Array([value & 0xff, (value >>> 8) & 0xff]))
  }

  u32(value: number): void {
    this.push(
      new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff])
    )
  }

  bytes(value: Uint8Array): void {
    this.push(value)
  }

  get offset(): number {
    return this.length
  }

  finish(): Uint8Array {
    const out = new Uint8Array(this.length)
    let at = 0
    for (const chunk of this.chunks) {
      out.set(chunk, at)
      at += chunk.length
    }
    return out
  }

  private push(chunk: Uint8Array): void {
    this.chunks.push(chunk)
    this.length += chunk.length
  }
}

const encoder = new TextEncoder()

const toBytes = (content: string | Uint8Array): Uint8Array =>
  typeof content === 'string' ? encoder.encode(content) : content

export function createZip(entries: readonly ZipEntry[]): Uint8Array {
  if (entries.length > MAX_ENTRIES) {
    throw new Error(`Cannot write ${entries.length} zip entries; the format caps at ${MAX_ENTRIES}`)
  }
  const seen = new Set<string>()
  const body = new ByteWriter()
  const directory = new ByteWriter()

  for (const entry of entries) {
    if (
      entry.path === '' ||
      entry.path.startsWith('/') ||
      entry.path.includes('\\') ||
      entry.path.split('/').includes('..')
    ) {
      throw new Error(`Invalid zip entry path: ${JSON.stringify(entry.path)}`)
    }
    if (seen.has(entry.path)) throw new Error(`Duplicate zip entry path: ${entry.path}`)
    seen.add(entry.path)

    const name = encoder.encode(entry.path)
    const data = toBytes(entry.content)
    if (data.length > MAX_ENTRY_BYTES) {
      throw new Error(`Zip entry ${entry.path} is too large for a non-zip64 archive`)
    }
    const checksum = crc32(data)
    const localOffset = body.offset

    body.u32(0x04034b50)
    body.u16(20) // version needed to extract
    body.u16(FLAG_UTF8_NAMES)
    body.u16(0) // stored
    body.u16(DOS_TIME)
    body.u16(DOS_DATE)
    body.u32(checksum)
    body.u32(data.length)
    body.u32(data.length)
    body.u16(name.length)
    body.u16(0) // extra field length
    body.bytes(name)
    body.bytes(data)

    directory.u32(0x02014b50)
    directory.u16(20) // version made by
    directory.u16(20) // version needed to extract
    directory.u16(FLAG_UTF8_NAMES)
    directory.u16(0) // stored
    directory.u16(DOS_TIME)
    directory.u16(DOS_DATE)
    directory.u32(checksum)
    directory.u32(data.length)
    directory.u32(data.length)
    directory.u16(name.length)
    directory.u16(0) // extra field length
    directory.u16(0) // comment length
    directory.u16(0) // disk number start
    directory.u16(0) // internal attributes
    directory.u32(isDirectoryPath(entry.path) ? DOS_DIRECTORY : 0) // external attributes
    directory.u32(localOffset)
    directory.bytes(name)
  }

  const out = new ByteWriter()
  out.bytes(body.finish())
  const directoryOffset = out.offset
  out.bytes(directory.finish())
  const directorySize = out.offset - directoryOffset

  out.u32(0x06054b50)
  out.u16(0) // this disk
  out.u16(0) // disk with the central directory
  out.u16(entries.length)
  out.u16(entries.length)
  out.u32(directorySize)
  out.u32(directoryOffset)
  out.u16(0) // archive comment length
  return out.finish()
}
