/**
 * Give a finished PDF an XMP metadata stream, as an incremental update.
 *
 * ## Why after the renderer and not inside it
 *
 * `@react-pdf/renderer` writes only the Info dictionary: `<Document>` has no
 * metadata-stream prop, and PDFKit's `appendXML` is reachable only through the
 * PDF/A `subset` path (see `@/lib/ai-provenance`, `aiProvenanceMarking`). The
 * standard marking for "a model wrote this" lives in XMP
 * (`Iptc4xmpExt:DigitalSourceType`), so it is added to the bytes the renderer
 * finished.
 *
 * ## Why an incremental update and not a rewrite
 *
 * ISO 32000-1, 7.5.6: a PDF is changed by APPENDING the changed objects, a new
 * cross-reference section and a trailer whose `/Prev` points at the old one.
 * The renderer's bytes stay byte-for-byte as they were, so nothing it laid out,
 * subset or compressed can be disturbed by a second writer; and appending is
 * the same mechanism a later digital signature (the Code of Practice's
 * Sub-measure 1.1.1) uses. `pdf-lib` was considered and not taken: it saves by
 * re-serialising the whole file, which is the opposite of that, and it pulls a
 * second PDF writer into production for two objects. pdf.js, the app's own
 * viewer, is the independent reader the spec checks the result with.
 *
 * Refuses, loudly, what it was not built for: an encrypted file, or one whose
 * cross-reference is a stream (PDF 1.5) rather than PDFKit's classic table. A
 * renderer upgrade that changes either fails the spec instead of shipping
 * unmarked files.
 */

import { aiProvenanceXmp, type AiProvenanceMarking } from '@/lib/ai-provenance'

/** The finished PDF was not in a shape this module can append to. */
export class PdfMetadataError extends Error {
  constructor(reason: string) {
    super(`cannot add XMP metadata to this PDF: ${reason}`)
    this.name = 'PdfMetadataError'
  }
}

/** One indirect reference, `12 0 R`. */
interface ObjectRef {
  number: number
  generation: number
}

/** The PDF with `xmp` as its catalog's `/Metadata` stream. */
export function withXmpMetadata(pdf: Uint8Array, xmp: string): Uint8Array {
  // latin1 is a true one-byte-per-char mapping in Node's Buffer (unlike
  // `TextDecoder('latin1')`, which is windows-1252), so offsets in this string
  // are byte offsets and a slice re-encodes to the same bytes.
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
  const root = refIn(trailer, 'Root')
  const size = /\/Size\s+(\d+)/.exec(trailer)
  if (!root || !size) throw new PdfMetadataError('the trailer names no /Root or /Size')

  const catalogAt = offsetOf(text, previousXref, root)
  if (!new RegExp(`^${root.number}\\s+${root.generation}\\s+obj\\b`).test(text.slice(catalogAt))) {
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
    'xref\n' +
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

/**
 * The PDF, marked in XMP as written by a model: `trainedAlgorithmicMedia`
 * beside the {@link AiProvenanceMarking} its Info dictionary already carries.
 */
export const withAiProvenanceXmp = (pdf: Uint8Array, marking: AiProvenanceMarking): Uint8Array =>
  withXmpMetadata(pdf, aiProvenanceXmp(marking))

/** A 20-byte cross-reference entry for an object in use (ISO 32000-1, 7.5.4). */
const xrefEntry = (offset: number, generation: number): string =>
  `${String(offset).padStart(10, '0')} ${String(generation).padStart(5, '0')} n \n`

function refIn(dictionary: string, key: string): ObjectRef | null {
  const match = new RegExp(`/${key}\\s+(\\d+)\\s+(\\d+)\\s+R`).exec(dictionary)
  return match ? { number: Number(match[1]), generation: Number(match[2]) } : null
}

/** Where the cross-reference table at `xrefAt` says object `ref` starts. */
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

/**
 * The dictionary `<< … >>` starting at `start`, nested dictionaries included.
 *
 * Literal strings `( … )` and hex strings `< … >` are skipped whole, because
 * a `>>` inside a title is text, not the end of the dictionary.
 */
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

/** The index after the literal string opening at `start`: balanced parentheses, `\` escapes. */
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
