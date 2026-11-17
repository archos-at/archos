import { aiProvenanceXmp, type AiProvenanceMarking } from '@/lib/ai-provenance'

export class PdfMetadataError extends Error {
  constructor(reason: string) {
    super(`cannot add XMP metadata to this PDF: ${reason}`)
    this.name = 'PdfMetadataError'
  }
}

interface ObjectRef {
  number: number
  generation: number
}

export function withXmpMetadata(pdf: Uint8Array, xmp: string): Uint8Array {
  const text = Buffer.from(pdf).toString('latin1')
  const startxref = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(text.slice(-1024))
  if (!startxref) throw new PdfMetadataError('no startxref at the end of the file')
  const previousXref = Number(startxref[1])
  if (!text.startsWith('xref', previousXref)) {
    throw new PdfMetadataError('the cross-reference is a stream, not a table')
  }

  const trailerAt = text.indexOf('trailer', previousXref)
  if (trailerAt === -1) throw new PdfMetadataError('no trailer after the cross-reference table')
  const trailer = dictionaryAt(text, text.indexOf('<<', trailerAt))
  if (/\/Encrypt\b/.test(trailer)) throw new PdfMetadataError('the file is encrypted')
  const root = rootOf(trailer)
  const size = /\/Size\s+(\d+)/.exec(trailer)
  if (!root || !size) throw new PdfMetadataError('the trailer names no /Root or /Size')

  const catalogAt = offsetOf(text, previousXref, root)
  const header = /^(\d+)\s+(\d+)\s+obj\b/.exec(text.slice(catalogAt, catalogAt + 32))
  if (!header || Number(header[1]) !== root.number || Number(header[2]) !== root.generation) {
    throw new PdfMetadataError('the cross-reference does not point at the catalog')
  }
  const catalog = dictionaryAt(text, text.indexOf('<<', catalogAt))
  const metadata: ObjectRef = { number: Number(size[1]), generation: 0 }
  const body = catalog.slice(2, -2).replace(/\/Metadata\s+\d+\s+\d+\s+R/, '')
  const xmpBytes = Buffer.from(xmp, 'utf8')

  const parts: Buffer[] = [Buffer.from(pdf)]
  let offset = pdf.length
  const append = (chunk: string | Buffer) => {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'latin1') : chunk
    parts.push(bytes)
    offset += bytes.length
  }

  append('\n')
  const newCatalogAt = offset
  append(`${root.number} ${root.generation} obj\n<<${body} /Metadata ${metadata.number} 0 R >>\nendobj\n`)
  const metadataAt = offset
  append(`${metadata.number} 0 obj\n<< /Type /Metadata /Subtype /XML /Length ${xmpBytes.length} >>\nstream\n`)
  append(xmpBytes)
  append('\nendstream\nendobj\n')

  const xrefAt = offset
  append(
    'xref\n0 1\n0000000000 65535 f \n' +
      `${root.number} 1\n${xrefEntry(newCatalogAt, root.generation)}` +
      `${metadata.number} 1\n${xrefEntry(metadataAt, 0)}`
  )
  const info = /\/Info\s+\d+\s+\d+\s+R/.exec(trailer)?.[0] ?? ''
  const id = /\/ID\s*\[[^\]]*\]/.exec(trailer)?.[0] ?? ''
  append(
    `trailer\n<< /Size ${metadata.number + 1} /Root ${root.number} ${root.generation} R ` +
      `${info} ${id} /Prev ${previousXref} >>\nstartxref\n${xrefAt}\n%%EOF\n`
  )
  return new Uint8Array(Buffer.concat(parts))
}

export const withAiProvenanceXmp = (pdf: Uint8Array, marking: AiProvenanceMarking): Uint8Array =>
  withXmpMetadata(pdf, aiProvenanceXmp(marking))

const xrefEntry = (offset: number, generation: number): string =>
  `${String(offset).padStart(10, '0')} ${String(generation).padStart(5, '0')} n \n`

function rootOf(trailer: string): ObjectRef | null {
  const match = /\/Root\s+(\d+)\s+(\d+)\s+R/.exec(trailer)
  return match ? { number: Number(match[1]), generation: Number(match[2]) } : null
}

function offsetOf(text: string, xrefAt: number, ref: ObjectRef): number {
  const lines = text.slice(xrefAt, text.indexOf('trailer', xrefAt)).split(/\r?\n|\r/)
  let line = 1
  while (line < lines.length) {
    const subsection = /^(\d+)\s+(\d+)\s*$/.exec(lines[line])
    if (!subsection) break
    const first = Number(subsection[1])
    const count = Number(subsection[2])
    if (ref.number >= first && ref.number < first + count) {
      const entry = /^(\d{10})\s+(\d{5})\s+n/.exec(lines[line + 1 + ref.number - first])
      if (entry) return Number(entry[1])
      break
    }
    line += 1 + count
  }
  throw new PdfMetadataError(`object ${ref.number} is not in the last cross-reference section`)
}

function dictionaryAt(text: string, start: number): string {
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

function afterLiteralString(text: string, start: number): number {
  let depth = 0
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (char === '\\') index += 1
    else if (char === '(') depth += 1
    else if (char === ')' && --depth === 0) return index + 1
  }
  throw new PdfMetadataError('unterminated string')
}
