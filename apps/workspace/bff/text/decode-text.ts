export type DecodedTextEncoding = 'utf-8-sig' | 'utf-16le' | 'utf-16be' | 'utf-8' | 'windows-1252'

export interface DecodedText {
  text: string
  encoding: DecodedTextEncoding
}

const BOMS: ReadonlyArray<{ bytes: readonly number[]; encoding: 'utf-8-sig' | 'utf-16le' | 'utf-16be' }> = [
  { bytes: [0xef, 0xbb, 0xbf], encoding: 'utf-8-sig' },
  { bytes: [0xff, 0xfe], encoding: 'utf-16le' },
  { bytes: [0xfe, 0xff], encoding: 'utf-16be' },
]

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.length <= bytes.length && prefix.every((byte, index) => bytes[index] === byte)
}

function strictUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

// prettier-ignore
const CP1252_80_9F = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f,
  0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178,
] as const

function decodeWindows1252(bytes: Uint8Array): string {
  const codes = Array.from(bytes, (byte) => (byte >= 0x80 && byte <= 0x9f ? CP1252_80_9F[byte - 0x80] : byte))
  let text = ''
  for (let start = 0; start < codes.length; start += 0x2000) {
    text += String.fromCharCode(...codes.slice(start, start + 0x2000))
  }
  return text
}

function incompleteUtf8Tail(bytes: Uint8Array): number {
  for (let back = 1; back <= Math.min(3, bytes.length); back++) {
    const byte = bytes[bytes.length - back]
    if ((byte & 0xc0) === 0x80) continue // continuation byte: keep looking for the lead
    if (byte < 0x80) return 0 // ASCII: the text ends on a boundary
    const length = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : 2
    return length > back ? back : 0
  }
  return 0
}

export function decodeTextBytes(bytes: Uint8Array, { truncated = false }: { truncated?: boolean } = {}): DecodedText {
  for (const bom of BOMS) {
    if (!startsWith(bytes, bom.bytes)) continue
    const label = bom.encoding === 'utf-8-sig' ? 'utf-8' : bom.encoding
    return { text: new TextDecoder(label).decode(bytes), encoding: bom.encoding }
  }
  const body = truncated ? bytes.subarray(0, bytes.length - incompleteUtf8Tail(bytes)) : bytes
  const utf8 = strictUtf8(body)
  if (utf8 !== null) return { text: utf8, encoding: 'utf-8' }
  return { text: decodeWindows1252(bytes), encoding: 'windows-1252' }
}
