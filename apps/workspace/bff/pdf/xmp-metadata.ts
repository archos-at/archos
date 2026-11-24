import { AI_GENERATOR_NAME, aiProvenanceXmp, type AiProvenanceMarking } from '@/lib/ai-provenance'
import {
  afterLiteralString,
  dictionaryAt,
  PdfMetadataError,
  readPdfStructure,
  type ObjectRef,
  type PdfStructure,
} from './pdf-structure'

export { PdfMetadataError } from './pdf-structure'

export interface PdfMetadataUpdate {
  xmp: string
  info?: Readonly<Record<string, string>>
}

interface AppendedObject {
  ref: ObjectRef
  chunks: (string | Buffer)[]
}

const DELIMITER = /[\s/[\]<>()%]/

function skipArray(text: string, start: number): number {
  let depth = 0
  let index = start
  while (index < text.length) {
    if (text[index] === '(') {
      index = afterLiteralString(text, index)
      continue
    }
    if (text.startsWith('<<', index)) {
      index += dictionaryAt(text, index).length
      continue
    }
    if (text[index] === '[') depth += 1
    if (text[index] === ']' && --depth === 0) return index + 1
    index += 1
  }
  throw new PdfMetadataError('unterminated array')
}

function skipValue(text: string, start: number): number {
  let index = start
  while (index < text.length && /\s/.test(text[index])) index += 1
  if (text.startsWith('<<', index)) return index + dictionaryAt(text, index).length
  if (text[index] === '<') return text.indexOf('>', index) + 1
  if (text[index] === '(') return afterLiteralString(text, index)
  if (text[index] === '[') return skipArray(text, index)
  if (text[index] === '/') {
    index += 1
    while (index < text.length && !DELIMITER.test(text[index])) index += 1
    return index
  }
  const token = /^[^\s/[\]<>()%]+(\s+\d+\s+R\b)?/.exec(text.slice(index, index + 64))
  if (!token) throw new PdfMetadataError('unreadable dictionary value')
  return index + token[0].length
}

export function withoutKeys(body: string, keys: ReadonlySet<string>): string {
  let out = ''
  let index = 0
  for (;;) {
    while (index < body.length && /\s/.test(body[index])) index += 1
    if (index >= body.length) return out
    if (body[index] !== '/') throw new PdfMetadataError('a dictionary key is not a name')
    let end = index + 1
    while (end < body.length && !DELIMITER.test(body[end])) end += 1
    const valueEnd = skipValue(body, end)
    if (!keys.has(body.slice(index + 1, end))) out += ` ${body.slice(index, valueEnd).trim()}`
    index = valueEnd
  }
}

const literalString = (value: string): string => `(${value.replace(/[\\()]/g, (char) => `\\${char}`)})`

const xrefEntry = (offset: number, generation: number): string =>
  `${String(offset).padStart(10, '0')} ${String(generation).padStart(5, '0')} n \n`

function groupedByNumber<T extends { ref: ObjectRef }>(items: readonly T[]): T[][] {
  const sorted = [...items].sort((a, b) => a.ref.number - b.ref.number)
  const groups: T[][] = []
  for (const item of sorted) {
    const last = groups.at(-1)
    if (last && last[last.length - 1].ref.number + 1 === item.ref.number) last.push(item)
    else groups.push([item])
  }
  return groups
}

function infoBody(structure: PdfStructure, info: Readonly<Record<string, string>>): string {
  let kept = ''
  if (structure.info) {
    try {
      kept = withoutKeys(structure.dictionaryOf(structure.info).slice(2, -2), new Set(Object.keys(info)))
    } catch {
      kept = ''
    }
  }
  const added = Object.entries(info)
    .map(([key, value]) => ` /${key} ${literalString(value)}`)
    .join('')
  return `${kept}${added}`
}

interface PlannedUpdate {
  objects: AppendedObject[]
  info: ObjectRef | null
  next: number
}

function planUpdate(structure: PdfStructure, update: PdfMetadataUpdate): PlannedUpdate {
  const catalog = structure.dictionaryOf(structure.root)
  const body = withoutKeys(catalog.slice(2, -2), new Set(['Metadata']))
  let next = structure.size
  const metadata: ObjectRef = { number: next++, generation: 0 }
  const xmpBytes = Buffer.from(update.xmp, 'utf8')
  const objects: AppendedObject[] = [
    { ref: structure.root, chunks: [`<<${body} /Metadata ${metadata.number} 0 R >>`] },
    {
      ref: metadata,
      chunks: [`<< /Type /Metadata /Subtype /XML /Length ${xmpBytes.length} >>\nstream\n`, xmpBytes, '\nendstream'],
    },
  ]
  let info = structure.info
  if (update.info) {
    info = { number: next++, generation: 0 }
    objects.push({ ref: info, chunks: [`<<${infoBody(structure, update.info)} >>`] })
  }
  return { objects, info, next }
}

class Appender {
  private readonly parts: Buffer[]
  offset: number

  constructor(pdf: Uint8Array) {
    this.parts = [Buffer.from(pdf)]
    this.offset = pdf.length
  }

  append(chunk: string | Buffer): void {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'latin1') : chunk
    this.parts.push(bytes)
    this.offset += bytes.length
  }

  finish(): Uint8Array {
    return new Uint8Array(Buffer.concat(this.parts))
  }
}

function xrefStreamData(groups: readonly AppendedObject[][], offsets: ReadonlyMap<number, number>): Buffer {
  const rows = groups.flat()
  const data = Buffer.alloc(rows.length * 7)
  rows.forEach((object, row) => {
    data.writeUInt8(1, row * 7)
    data.writeUInt32BE(offsets.get(object.ref.number) ?? 0, row * 7 + 1)
    data.writeUInt16BE(object.ref.generation, row * 7 + 5)
  })
  return data
}

export function withPdfMetadata(pdf: Uint8Array, update: PdfMetadataUpdate): Uint8Array {
  const structure = readPdfStructure(pdf)
  const { objects, info, next } = planUpdate(structure, update)
  const out = new Appender(pdf)

  out.append('\n')
  const offsets = new Map<number, number>()
  for (const object of objects) {
    offsets.set(object.ref.number, out.offset)
    out.append(`${object.ref.number} ${object.ref.generation} obj\n`)
    for (const chunk of object.chunks) out.append(chunk)
    out.append('\nendobj\n')
  }

  const trailerKeys =
    `/Root ${structure.root.number} ${structure.root.generation} R ` +
    `${info ? `/Info ${info.number} ${info.generation} R ` : ''}${structure.id} /Prev ${structure.startxref}`
  const xrefAt = out.offset

  if (structure.xrefKind === 'table') {
    let table = 'xref\n0 1\n0000000000 65535 f \n'
    for (const group of groupedByNumber(objects)) {
      table += `${group[0].ref.number} ${group.length}\n`
      for (const object of group) table += xrefEntry(offsets.get(object.ref.number) ?? 0, object.ref.generation)
    }
    out.append(table)
    out.append(`trailer\n<< /Size ${next} ${trailerKeys} >>\nstartxref\n${xrefAt}\n%%EOF\n`)
    return out.finish()
  }

  const xref: AppendedObject = { ref: { number: next, generation: 0 }, chunks: [] }
  offsets.set(xref.ref.number, xrefAt)
  const groups = groupedByNumber([...objects, xref])
  const data = xrefStreamData(groups, offsets)
  const index = groups.map((group) => `${group[0].ref.number} ${group.length}`).join(' ')
  out.append(
    `${xref.ref.number} 0 obj\n<< /Type /XRef /Size ${next + 1} /W [1 4 2] /Index [${index}] ${trailerKeys} ` +
      `/Length ${data.length} >>\nstream\n`,
  )
  out.append(data)
  out.append(`\nendstream\nendobj\nstartxref\n${xrefAt}\n%%EOF\n`)
  return out.finish()
}

export function withXmpMetadata(pdf: Uint8Array, xmp: string): Uint8Array {
  return withPdfMetadata(pdf, { xmp })
}

export const withAiProvenanceXmp = (pdf: Uint8Array, marking: AiProvenanceMarking): Uint8Array =>
  withXmpMetadata(pdf, aiProvenanceXmp(marking))

export const withAiProvenancePdf = (pdf: Uint8Array, marking: AiProvenanceMarking): Uint8Array =>
  withPdfMetadata(pdf, {
    xmp: aiProvenanceXmp(marking),
    info: { Keywords: marking, Creator: AI_GENERATOR_NAME, Producer: AI_GENERATOR_NAME },
  })
