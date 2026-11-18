import { crc32 } from '@/lib/bim/zip'

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
export const PNG_XMP_KEYWORD = 'XML:com.adobe.xmp'
const MAX_CHUNKS = 100_000

export interface PngChunk {
  type: string
  data: Uint8Array
}

export class PngStructureError extends Error {
  constructor(reason: string) {
    super(`not a well-formed PNG: ${reason}`)
    this.name = 'PngStructureError'
  }
}

const latin1 = new TextDecoder('latin1')
const encoder = new TextEncoder()

const u32 = (bytes: Uint8Array, at: number): number =>
  ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= SIGNATURE.length && SIGNATURE.every((byte, index) => bytes[index] === byte)
}

export function readPngChunks(bytes: Uint8Array): PngChunk[] {
  if (!isPng(bytes)) throw new PngStructureError('no PNG signature')
  const chunks: PngChunk[] = []
  let at = SIGNATURE.length
  while (at < bytes.length) {
    if (at + 12 > bytes.length || chunks.length >= MAX_CHUNKS) throw new PngStructureError('truncated chunk')
    const length = u32(bytes, at)
    const end = at + 12 + length
    if (end > bytes.length) throw new PngStructureError('chunk runs past the end')
    const typeAndData = bytes.subarray(at + 4, at + 8 + length)
    if (crc32(typeAndData) !== u32(bytes, at + 8 + length)) throw new PngStructureError('bad chunk CRC')
    const chunk = { type: latin1.decode(bytes.subarray(at + 4, at + 8)), data: bytes.subarray(at + 8, at + 8 + length) }
    if (chunks.length === 0 && (chunk.type !== 'IHDR' || length !== 13)) throw new PngStructureError('IHDR is not first')
    chunks.push(chunk)
    at = end
    if (chunk.type === 'IEND') break
  }
  if (chunks.at(-1)?.type !== 'IEND' || at !== bytes.length) throw new PngStructureError('no IEND at the end')
  return chunks
}

function encodeChunk(chunk: PngChunk): Uint8Array {
  const out = new Uint8Array(12 + chunk.data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, chunk.data.length)
  out.set(encoder.encode(chunk.type), 4)
  out.set(chunk.data, 8)
  view.setUint32(8 + chunk.data.length, crc32(out.subarray(4, 8 + chunk.data.length)))
  return out
}

function isXmpChunk(chunk: PngChunk): boolean {
  if (chunk.type !== 'iTXt') return false
  const keyword = encoder.encode(`${PNG_XMP_KEYWORD}\0`)
  return keyword.every((byte, index) => chunk.data[index] === byte)
}

export function xmpChunkData(xmp: string): Uint8Array {
  const header = encoder.encode(`${PNG_XMP_KEYWORD}\0`)
  const body = encoder.encode(xmp)
  const data = new Uint8Array(header.length + 4 + body.length)
  data.set(header, 0)
  data.set([0, 0, 0, 0], header.length)
  data.set(body, header.length + 4)
  return data
}

export function withPngXmp(chunks: readonly PngChunk[], xmp: string): Uint8Array {
  const kept = chunks.filter((chunk) => !isXmpChunk(chunk))
  const written = [kept[0], { type: 'iTXt', data: xmpChunkData(xmp) }, ...kept.slice(1)].map(encodeChunk)
  const out = new Uint8Array(SIGNATURE.length + written.reduce((sum, chunk) => sum + chunk.length, 0))
  out.set(SIGNATURE, 0)
  let at = SIGNATURE.length
  for (const chunk of written) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}
