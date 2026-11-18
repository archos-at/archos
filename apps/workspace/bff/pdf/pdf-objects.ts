import {
  afterLiteralString,
  decodeStream,
  dictionaryAt,
  integerIn,
  PdfMetadataError,
  readPdfStructure,
  refIn,
  type PdfStructure,
  type XrefEntry,
} from './pdf-structure'

export interface ByteSpan {
  readonly start: number
  readonly end: number
}

export interface PdfIndirectObject extends ByteSpan {
  readonly number: number
  readonly body: string
  readonly data: ByteSpan | null
}

export interface PdfObjects {
  readonly structure: PdfStructure
  readonly objects: readonly PdfIndirectObject[]
  readonly objectStreams: readonly string[]
}

const WHITESPACE = '\0\t\n\f\r '
const DELIMITERS = '()<>[]{}/%'
const isRegular = (char: string | undefined): boolean =>
  char !== undefined && !WHITESPACE.includes(char) && !DELIMITERS.includes(char)

export const decodeName = (name: string): string =>
  name.replace(/#([0-9A-Fa-f]{2})/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)))

function skipWhitespace(text: string, start: number): number {
  let index = start
  while (index < text.length && WHITESPACE.includes(text[index])) index += 1
  return index
}

function skipBlank(text: string, start: number): number {
  let index = skipWhitespace(text, start)
  while (text[index] === '%') {
    while (index < text.length && text[index] !== '\n' && text[index] !== '\r') index += 1
    index = skipWhitespace(text, index)
  }
  return index
}

function tokenEnd(text: string, start: number): number {
  const char = text[start]
  if (char === '(') return afterLiteralString(text, start)
  if (text.startsWith('<<', start) || text.startsWith('>>', start)) return start + 2
  if (char === '<') {
    const end = text.indexOf('>', start)
    if (end === -1) throw new PdfMetadataError('unterminated hex string')
    return end + 1
  }
  if ('[]{}'.includes(char)) return start + 1
  let end = char === '/' ? start + 1 : start
  while (isRegular(text[end])) end += 1
  if (end === start) throw new PdfMetadataError(`unreadable token at byte ${start}`)
  return end
}

function normalized(token: string): string {
  if (token.startsWith('(')) return '()'
  if (token.startsWith('<') && token !== '<<') return '<>'
  if (token.startsWith('/')) return decodeName(token)
  return token
}

type LengthOf = (dictionary: string) => number

interface Tokens {
  body: string
  keyword: 'stream' | 'endobj'
  after: number
}

function tokensUntilKeyword(text: string, start: number, number: number): Tokens {
  const parts: string[] = []
  let at = start
  for (;;) {
    at = skipBlank(text, at)
    if (at >= text.length) throw new PdfMetadataError(`object ${number} has no endobj`)
    const end = tokenEnd(text, at)
    const token = text.slice(at, end)
    if (token === 'stream' || token === 'endobj') return { body: parts.join(' '), keyword: token, after: end }
    if (token === 'obj' || token === 'endstream') throw new PdfMetadataError(`object ${number} is not closed`)
    parts.push(normalized(token))
    at = end
  }
}

function afterKeyword(text: string, start: number, keyword: string, number: number): number {
  if (!text.startsWith(keyword, start) || isRegular(text[start + keyword.length])) {
    throw new PdfMetadataError(`object ${number} has no ${keyword} where its stream ends`)
  }
  return start + keyword.length
}

function streamData(text: string, tokens: Tokens, number: number, lengthOf: LengthOf): { data: ByteSpan; closed: number } {
  const dictionary = tokens.body
  if (!dictionary.startsWith('<<') || !dictionary.endsWith('>>')) {
    throw new PdfMetadataError(`object ${number} has a stream without a dictionary`)
  }
  const eol = /^(\r\n|\n|\r)/.exec(text.slice(tokens.after, tokens.after + 2))
  if (!eol) throw new PdfMetadataError(`object ${number} has no line end after stream`)
  const start = tokens.after + eol[0].length
  const end = start + lengthOf(dictionary)
  if (end > text.length) throw new PdfMetadataError(`object ${number} has a stream longer than the file`)
  const endstream = afterKeyword(text, skipWhitespace(text, end), 'endstream', number)
  const closed = afterKeyword(text, skipBlank(text, endstream), 'endobj', number)
  return { data: { start, end }, closed }
}

export function readIndirectObject(text: string, offset: number, number: number, lengthOf: LengthOf): PdfIndirectObject {
  const header = /^(\d+)\s+(\d+)\s+obj/.exec(text.slice(offset, offset + 40))
  if (!header || Number(header[1]) !== number || isRegular(text[offset + header[0].length])) {
    throw new PdfMetadataError(`the cross-reference does not point at object ${number}`)
  }
  const tokens = tokensUntilKeyword(text, offset + header[0].length, number)
  if (tokens.keyword === 'endobj') return { number, start: offset, end: tokens.after, body: tokens.body, data: null }
  const { data, closed } = streamData(text, tokens, number, lengthOf)
  return { number, start: offset, end: closed, body: tokens.body, data }
}

interface ObjectStream {
  text: string
  members: Map<number, number>
}

function objectStreamOf(bytes: Uint8Array, object: PdfIndirectObject): ObjectStream {
  if (!object.data) throw new PdfMetadataError(`object stream ${object.number} has no data`)
  const text = Buffer.from(decodeStream(object.body, bytes.subarray(object.data.start, object.data.end))).toString('latin1')
  const count = integerIn(object.body, 'N')
  const first = integerIn(object.body, 'First')
  if (count === null || first === null || first > text.length) {
    throw new PdfMetadataError(`object stream ${object.number} has no readable /N or /First`)
  }
  const numbers = text.slice(0, first).trim().split(/\s+/).filter(Boolean).map(Number)
  if (numbers.length !== count * 2 || numbers.some((value) => !Number.isInteger(value))) {
    throw new PdfMetadataError(`object stream ${object.number} has a malformed header`)
  }
  const members = new Map<number, number>()
  for (let index = 0; index < count; index += 1) {
    if (first + numbers[index * 2 + 1] > text.length) throw new PdfMetadataError(`object stream ${object.number} is short`)
    members.set(numbers[index * 2], index)
  }
  return { text, members }
}

const isObjectStream = (object: PdfIndirectObject): boolean => /\/Type \/ObjStm(?= |$)/.test(object.body)

class ObjectWalker {
  private readonly newest = new Map<number, XrefEntry>()
  private readonly objectStreams = new Map<number, ObjectStream>()

  constructor(
    private readonly bytes: Uint8Array,
    private readonly structure: PdfStructure,
  ) {
    for (const section of structure.xrefSections) {
      for (const [number, entry] of section.entries) if (!this.newest.has(number)) this.newest.set(number, entry)
    }
  }

  readonly lengthOf: LengthOf = (dictionary) => {
    const direct = integerIn(dictionary, 'Length')
    if (direct !== null) return direct
    const ref = refIn(dictionary, 'Length')
    if (!ref) throw new PdfMetadataError('a stream has no readable /Length')
    const entry = this.newest.get(ref.number)
    if (entry?.kind !== 'offset') throw new PdfMetadataError(`the /Length of a stream is not a plain object`)
    const length = readIndirectObject(this.structure.text, entry.offset, ref.number, () => {
      throw new PdfMetadataError('a stream /Length is itself a stream')
    })
    if (!/^\d+$/.test(length.body)) throw new PdfMetadataError(`object ${ref.number} is not a stream length`)
    return Number(length.body)
  }

  objectOffsets(): Map<number, number> {
    const offsets = new Map<number, number>()
    const record = (offset: number, number: number) => {
      const known = offsets.get(offset)
      if (known !== undefined && known !== number) throw new PdfMetadataError(`objects ${known} and ${number} share an offset`)
      offsets.set(offset, number)
    }
    for (const section of this.structure.xrefSections) {
      for (const [number, entry] of section.entries) if (entry.kind === 'offset') record(entry.offset, number)
      if (section.kind === 'stream') {
        const header = /^(\d+)\s+\d+\s+obj/.exec(this.structure.text.slice(section.at, section.at + 40))
        if (!header) throw new PdfMetadataError('the cross-reference stream is not an object')
        record(section.at, Number(header[1]))
      }
    }
    return offsets
  }

  tableSpans(): ByteSpan[] {
    const { text } = this.structure
    return this.structure.xrefSections
      .filter((section) => section.kind === 'table')
      .map((section) => {
        const opening = text.indexOf('<<', text.indexOf('trailer', section.at))
        return { start: section.at, end: opening + dictionaryAt(text, opening).length }
      })
  }

  readObjectStreams(objects: readonly PdfIndirectObject[]): string[] {
    const texts: string[] = []
    for (const object of objects) {
      if (!isObjectStream(object)) continue
      const stream = objectStreamOf(this.bytes, object)
      texts.push(stream.text)
      const entry = this.newest.get(object.number)
      if (entry?.kind === 'offset' && entry.offset === object.start) this.objectStreams.set(object.number, stream)
    }
    for (const [number, entry] of this.newest) {
      if (entry.kind === 'compressed' && !this.objectStreams.get(entry.stream)?.members.has(number)) {
        throw new PdfMetadataError(`object ${number} is not in object stream ${entry.stream}`)
      }
    }
    return texts
  }
}

function refuseOverlaps(spans: readonly ByteSpan[]): void {
  const sorted = [...spans].sort((a, b) => a.start - b.start)
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].start < sorted[index - 1].end) {
      throw new PdfMetadataError(`the object at byte ${sorted[index].start} lies inside the one at byte ${sorted[index - 1].start}`)
    }
  }
}

export function readPdfObjects(bytes: Uint8Array): PdfObjects {
  const structure = readPdfStructure(bytes)
  const walker = new ObjectWalker(bytes, structure)
  const objects = [...walker.objectOffsets()].map(([offset, number]) =>
    readIndirectObject(structure.text, offset, number, walker.lengthOf),
  )
  refuseOverlaps([...objects, ...walker.tableSpans()])
  return { structure, objects, objectStreams: walker.readObjectStreams(objects) }
}
