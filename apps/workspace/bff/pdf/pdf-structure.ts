import { unzlibSync } from 'fflate'

export class PdfMetadataError extends Error {
  constructor(reason: string) {
    super(`cannot add metadata to this PDF: ${reason}`)
    this.name = 'PdfMetadataError'
  }
}

export interface ObjectRef {
  number: number
  generation: number
}

type XrefEntry =
  | { kind: 'free' }
  | { kind: 'offset'; offset: number; generation: number }
  | { kind: 'compressed'; stream: number; index: number }

export type XrefKind = 'table' | 'stream'

export interface PdfStructure {
  readonly text: string
  readonly xrefKind: XrefKind
  readonly startxref: number
  readonly root: ObjectRef
  readonly size: number
  readonly info: ObjectRef | null
  readonly id: string
  dictionaryOf(ref: ObjectRef): string
}

const MAX_SECTIONS = 64

export const refIn = (dictionary: string, key: string): ObjectRef | null => {
  const match = new RegExp(`/${key}\\s+(\\d+)\\s+(\\d+)\\s+R`).exec(dictionary)
  return match ? { number: Number(match[1]), generation: Number(match[2]) } : null
}

const integerIn = (dictionary: string, key: string): number | null => {
  const match = new RegExp(`/${key}\\s+(\\d+)(?!\\s+\\d+\\s+R)`).exec(dictionary)
  return match ? Number(match[1]) : null
}

const arrayIn = (dictionary: string, key: string): number[] | null => {
  const match = new RegExp(`/${key}\\s*\\[([^\\]]*)\\]`).exec(dictionary)
  return match ? match[1].trim().split(/\s+/).filter(Boolean).map(Number) : null
}

export function dictionaryAt(text: string, start: number): string {
  if (start < 0 || !text.startsWith('<<', start)) throw new PdfMetadataError('no dictionary')
  let depth = 0
  let index = start
  while (index < text.length) {
    if (text.startsWith('<<', index)) {
      depth += 1
      index += 2
    } else if (text.startsWith('>>', index)) {
      depth -= 1
      index += 2
      if (depth === 0) return text.slice(start, index)
    } else if (text[index] === '(') {
      index = afterLiteralString(text, index)
    } else if (text[index] === '<') {
      const end = text.indexOf('>', index)
      if (end === -1) throw new PdfMetadataError('unterminated hex string')
      index = end + 1
    } else {
      index += 1
    }
  }
  throw new PdfMetadataError('unterminated dictionary')
}

export function afterLiteralString(text: string, start: number): number {
  let depth = 0
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (char === '\\') index += 1
    else if (char === '(') depth += 1
    else if (char === ')' && --depth === 0) return index + 1
  }
  throw new PdfMetadataError('unterminated string')
}

function unpredict(data: Uint8Array, columns: number): Uint8Array {
  const rowLength = columns + 1
  if (data.length % rowLength !== 0) throw new PdfMetadataError('predicted stream has a partial row')
  const rows = data.length / rowLength
  const out = new Uint8Array(rows * columns)
  for (let row = 0; row < rows; row += 1) {
    const filter = data[row * rowLength]
    for (let column = 0; column < columns; column += 1) {
      const raw = data[row * rowLength + 1 + column]
      const left = column > 0 ? out[row * columns + column - 1] : 0
      const up = row > 0 ? out[(row - 1) * columns + column] : 0
      const upLeft = row > 0 && column > 0 ? out[(row - 1) * columns + column - 1] : 0
      out[row * columns + column] = (raw + predictorTerm(filter, left, up, upLeft)) & 0xff
    }
  }
  return out
}

function predictorTerm(filter: number, left: number, up: number, upLeft: number): number {
  if (filter === 0) return 0
  if (filter === 1) return left
  if (filter === 2) return up
  if (filter === 3) return (left + up) >> 1
  if (filter !== 4) throw new PdfMetadataError(`unknown PNG predictor ${filter}`)
  const estimate = left + up - upLeft
  const [a, b, c] = [Math.abs(estimate - left), Math.abs(estimate - up), Math.abs(estimate - upLeft)]
  if (a <= b && a <= c) return left
  return b <= c ? up : upLeft
}

export function decodeStream(dictionary: string, raw: Uint8Array): Uint8Array {
  const filter = /\/Filter\s*(\[\s*)?\/(\w+)/.exec(dictionary)?.[2]
  if (filter === undefined) return raw
  if (filter !== 'FlateDecode' || /\/Filter\s*\[\s*\/\w+\s*\/\w+/.test(dictionary)) {
    throw new PdfMetadataError(`unsupported stream filter ${filter}`)
  }
  let decoded: Uint8Array
  try {
    decoded = unzlibSync(raw)
  } catch {
    throw new PdfMetadataError('a Flate stream does not inflate')
  }
  const predictor = integerIn(dictionary, 'Predictor') ?? 1
  if (predictor === 1) return decoded
  if (predictor < 10) throw new PdfMetadataError(`unsupported predictor ${predictor}`)
  return unpredict(decoded, integerIn(dictionary, 'Columns') ?? 1)
}

interface StreamObject {
  dictionary: string
  data: Uint8Array
}

class PdfReader {
  private readonly sections: Map<number, XrefEntry>[] = []
  private readonly objectStreams = new Map<number, { text: string; offsets: Map<number, number> }>()

  constructor(
    readonly bytes: Uint8Array,
    readonly text: string,
  ) {}

  addSection(entries: Map<number, XrefEntry>): void {
    this.sections.push(entries)
  }

  entryOf(number: number): XrefEntry | undefined {
    for (const section of this.sections) {
      const entry = section.get(number)
      if (entry) return entry
    }
    return undefined
  }

  streamAt(offset: number, number?: number): StreamObject {
    const header = /^(\d+)\s+(\d+)\s+obj\b/.exec(this.text.slice(offset, offset + 40))
    if (!header || (number !== undefined && Number(header[1]) !== number)) {
      throw new PdfMetadataError('the cross-reference does not point at the object')
    }
    const opening = this.text.indexOf('<<', offset)
    const dictionary = dictionaryAt(this.text, opening)
    const after = opening + dictionary.length
    const keyword = /^\s*stream(\r\n|\n|\r)/.exec(this.text.slice(after, after + 16))
    if (!keyword) throw new PdfMetadataError('a stream object has no stream')
    const start = after + keyword[0].length
    const length = this.lengthOf(dictionary)
    return { dictionary, data: this.bytes.subarray(start, start + length) }
  }

  private lengthOf(dictionary: string): number {
    const direct = integerIn(dictionary, 'Length')
    if (direct !== null) return direct
    const ref = refIn(dictionary, 'Length')
    const entry = ref ? this.entryOf(ref.number) : undefined
    if (!ref || entry?.kind !== 'offset') throw new PdfMetadataError('a stream has no readable /Length')
    const value = /^\d+\s+\d+\s+obj\s*(\d+)/.exec(this.text.slice(entry.offset, entry.offset + 64))
    if (!value) throw new PdfMetadataError('a stream has no readable /Length')
    return Number(value[1])
  }

  dictionaryOf(ref: ObjectRef): string {
    const entry = this.entryOf(ref.number)
    if (!entry || entry.kind === 'free') throw new PdfMetadataError(`object ${ref.number} is not in the file`)
    if (entry.kind === 'offset') {
      const header = /^(\d+)\s+(\d+)\s+obj\b/.exec(this.text.slice(entry.offset, entry.offset + 40))
      if (!header || Number(header[1]) !== ref.number) {
        throw new PdfMetadataError('the cross-reference does not point at the object')
      }
      return dictionaryAt(this.text, this.text.indexOf('<<', entry.offset))
    }
    const stream = this.objectStream(entry.stream)
    const at = stream.offsets.get(ref.number)
    if (at === undefined) throw new PdfMetadataError(`object ${ref.number} is not in its object stream`)
    return dictionaryAt(stream.text, stream.text.indexOf('<<', at))
  }

  private objectStream(number: number): { text: string; offsets: Map<number, number> } {
    const cached = this.objectStreams.get(number)
    if (cached) return cached
    const entry = this.entryOf(number)
    if (entry?.kind !== 'offset') throw new PdfMetadataError(`object stream ${number} is not in the file`)
    const { dictionary, data } = this.streamAt(entry.offset, number)
    const text = Buffer.from(decodeStream(dictionary, data)).toString('latin1')
    const count = integerIn(dictionary, 'N') ?? 0
    const first = integerIn(dictionary, 'First') ?? 0
    const numbers = text.slice(0, first).trim().split(/\s+/).map(Number)
    const offsets = new Map<number, number>()
    for (let index = 0; index < count; index += 1) {
      offsets.set(numbers[index * 2], first + numbers[index * 2 + 1])
    }
    const parsed = { text, offsets }
    this.objectStreams.set(number, parsed)
    return parsed
  }
}

function tableSection(text: string, at: number): { entries: Map<number, XrefEntry>; trailer: string } {
  const trailerAt = text.indexOf('trailer', at)
  if (trailerAt === -1) throw new PdfMetadataError('no trailer after the cross-reference table')
  const lines = text.slice(at, trailerAt).split(/\r?\n|\r/)
  const entries = new Map<number, XrefEntry>()
  let line = 1
  while (line < lines.length) {
    const subsection = /^\s*(\d+)\s+(\d+)\s*$/.exec(lines[line])
    if (!subsection) break
    const first = Number(subsection[1])
    const count = Number(subsection[2])
    for (let index = 0; index < count; index += 1) {
      const entry = /^(\d{10})\s+(\d{5})\s+([nf])/.exec(lines[line + 1 + index] ?? '')
      if (!entry) throw new PdfMetadataError('a cross-reference table line is malformed')
      entries.set(
        first + index,
        entry[3] === 'n'
          ? { kind: 'offset', offset: Number(entry[1]), generation: Number(entry[2]) }
          : { kind: 'free' },
      )
    }
    line += 1 + count
  }
  return { entries, trailer: dictionaryAt(text, text.indexOf('<<', trailerAt)) }
}

function streamSection(reader: PdfReader, at: number): { entries: Map<number, XrefEntry>; trailer: string } {
  const { dictionary, data } = reader.streamAt(at)
  if (!/\/Type\s*\/XRef\b/.test(dictionary)) throw new PdfMetadataError('startxref points at neither a table nor a stream')
  const widths = arrayIn(dictionary, 'W')
  const size = integerIn(dictionary, 'Size')
  if (!widths || widths.length !== 3 || size === null) throw new PdfMetadataError('the cross-reference stream has no /W or /Size')
  const index = arrayIn(dictionary, 'Index') ?? [0, size]
  const decoded = decodeStream(dictionary, data)
  const rowLength = widths[0] + widths[1] + widths[2]
  const entries = new Map<number, XrefEntry>()
  let row = 0
  const field = (start: number, width: number, fallback: number): number => {
    if (width === 0) return fallback
    let value = 0
    for (let byte = 0; byte < width; byte += 1) value = value * 256 + decoded[start + byte]
    return value
  }
  for (let pair = 0; pair + 1 < index.length; pair += 2) {
    for (let number = index[pair]; number < index[pair] + index[pair + 1]; number += 1) {
      const start = row * rowLength
      if (start + rowLength > decoded.length) throw new PdfMetadataError('the cross-reference stream is short')
      const type = field(start, widths[0], 1)
      const second = field(start + widths[0], widths[1], 0)
      const third = field(start + widths[0] + widths[1], widths[2], 0)
      entries.set(
        number,
        type === 1
          ? { kind: 'offset', offset: second, generation: third }
          : type === 2
            ? { kind: 'compressed', stream: second, index: third }
            : { kind: 'free' },
      )
      row += 1
    }
  }
  return { entries, trailer: dictionary }
}

export function readPdfStructure(pdf: Uint8Array): PdfStructure {
  const text = Buffer.from(pdf).toString('latin1')
  if (!text.startsWith('%PDF-')) throw new PdfMetadataError('the file does not start with %PDF-')
  const startxref = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(text.slice(-1024))
  if (!startxref) throw new PdfMetadataError('no startxref at the end of the file')
  const reader = new PdfReader(pdf, text)
  const newest = Number(startxref[1])
  const xrefKind: XrefKind = text.startsWith('xref', newest) ? 'table' : 'stream'

  let trailer = ''
  const visited = new Set<number>()
  let next: number | null = newest
  while (next !== null) {
    if (visited.has(next) || visited.size >= MAX_SECTIONS) throw new PdfMetadataError('the cross-reference chain loops')
    visited.add(next)
    const section = text.startsWith('xref', next) ? tableSection(text, next) : streamSection(reader, next)
    reader.addSection(section.entries)
    if (!trailer) trailer = section.trailer
    const hybrid = integerIn(section.trailer, 'XRefStm')
    if (hybrid !== null && !visited.has(hybrid)) {
      visited.add(hybrid)
      reader.addSection(streamSection(reader, hybrid).entries)
    }
    next = integerIn(section.trailer, 'Prev')
  }

  if (/\/Encrypt\b/.test(trailer)) throw new PdfMetadataError('the file is encrypted')
  const root = refIn(trailer, 'Root')
  const size = integerIn(trailer, 'Size')
  if (!root || size === null) throw new PdfMetadataError('the trailer names no /Root or /Size')
  return {
    text,
    xrefKind,
    startxref: newest,
    root,
    size,
    info: refIn(trailer, 'Info'),
    id: /\/ID\s*\[[^\]]*\]/.exec(trailer)?.[0] ?? '',
    dictionaryOf: (ref) => reader.dictionaryOf(ref),
  }
}
