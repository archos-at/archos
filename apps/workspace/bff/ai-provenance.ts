/**
 * The machine-readable AI marking, in the one place both exporters read it.
 *
 * ## Why this is a module and not two sets of string literals
 *
 * The printed *"KI-generiert — nicht geprüft"* block is for the reader. This is
 * for everything else — a records system, a Behörde's intake, a compliance scan
 * — which is what the AI Act's transparency obligation actually asks for:
 * marking that does not depend on somebody reading page one and believing it.
 *
 * A detector matches on NAMES. The moment the same document is offered in two
 * formats, "the same marking" is a claim about four strings agreeing across two
 * files that share no code — and the failure mode is silent: a `.pdf` marked
 * `AIGenerated` and a `.docx` marked `AiGenerated` both look marked, and a scan
 * configured for one finds nothing in the other. So the names live here, and
 * `answer-export/docx.ts`, `pdf/markdown-pdf.ts` and `diagrams/svg.ts` are all
 * readers of them.
 *
 * ## And a reader, not only a writer
 *
 * {@link markingIsInBytes} is the other half, and it is why this module grew
 * past being a formatter. The marking used to be applied at each producer and
 * checked nowhere, and two of the three producers shipped unmarked. Writing the
 * marking and being able to FIND it in a finished file are one concern, so they
 * live in one module and `fileGeneratedDocument` uses both at its one seam.
 *
 * Nothing here is server-only: it is constants, a formatter and a byte scan,
 * and the modules that use them carry their own `server-only` where they need
 * it.
 */

import { PRODUCT_NAME } from '@/lib/brand'

/**
 * The name a downstream detector matches on. Stable: it is an interface.
 *
 * It is the product's name rather than the library's on purpose — `react-pdf`
 * and this repo's OOXML writer are implementation details that will change, and
 * an office searching its archive for machine-written documents searches for
 * the thing that wrote them.
 */
export const AI_GENERATOR_NAME = PRODUCT_NAME

/**
 * The property names, spelled once.
 *
 * `.docx` writes them as typed OOXML custom properties; `.pdf` writes them into
 * the Info dictionary's `Keywords` (see {@link aiProvenanceMarking} for why
 * that field and not another); an `.svg` writes them as the root's `<desc>`.
 * Different carriers, one vocabulary.
 */
export const AI_PROVENANCE_PROPERTIES = {
  generated: 'AIGenerated',
  generator: 'AIGenerator',
  humanReviewed: 'AIHumanReviewed',
  runId: 'AIRunId',
  /** The IPTC property's own name, so the `.docx` and the XMP packet agree on it. */
  digitalSourceType: 'DigitalSourceType',
} as const

/**
 * The standard's word for "a model made this": IPTC NewsCodes Digital Source
 * Type `trainedAlgorithmicMedia`, the term every metadata-reading detector
 * (exiftool, the large platforms' upload scanners, C2PA's `digitalSourceType`
 * assertion) already matches on.
 *
 * ## Why this beside the vocabulary above, and not instead of it
 *
 * Article 50(2) AI Act asks for marking that is machine-readable AND
 * interoperable, and the Commission's Code of Practice on Transparency of
 * AI-Generated Content (final, 2026-06-10), Measure 1.1.1, asks that a format
 * which carries metadata — "containerised text", its glossary's word for text
 * inside a PDF or a Word document — record in that metadata whether the content
 * is AI-generated. `AIGenerated=true` answers the first half and only a
 * detector configured for this product answers the second. This URI answers
 * both, so it is written into every carrier, and the four names above stay
 * because an office's archive search already matches on them.
 */
export const IPTC_TRAINED_ALGORITHMIC_MEDIA =
  'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia'

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
}

/**
 * An XMP packet (ISO 16684-1) that says a model wrote the file.
 *
 * `Iptc4xmpExt:DigitalSourceType` is where IPTC puts the term in XMP;
 * `xmp:CreatorTool` names what wrote it; `pdf:Keywords` repeats the
 * {@link AiProvenanceMarking} because a PDF's XMP and its Info dictionary are
 * meant to agree (ISO 32000-1, 14.3.2), and so that {@link markingIsInBytes}
 * finds the marking in the packet too. A PDF carries it as the catalog's
 * `/Metadata` stream (`@/lib/pdf/xmp-metadata`).
 */
export function aiProvenanceXmp(marking: AiProvenanceMarking): string {
  const escape = (value: string) => value.replace(/[&<>"]/g, (char) => XML_ESCAPES[char])
  const { digitalSourceType } = AI_PROVENANCE_PROPERTIES
  return (
    '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>\n' +
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">\n' +
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n' +
    '<rdf:Description rdf:about=""\n' +
    ' xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"\n' +
    ' xmlns:xmp="http://ns.adobe.com/xap/1.0/"\n' +
    ' xmlns:pdf="http://ns.adobe.com/pdf/1.3/">\n' +
    `<Iptc4xmpExt:${digitalSourceType}>${IPTC_TRAINED_ALGORITHMIC_MEDIA}</Iptc4xmpExt:${digitalSourceType}>\n` +
    `<xmp:CreatorTool>${escape(AI_GENERATOR_NAME)}</xmp:CreatorTool>\n` +
    `<pdf:Keywords>${escape(marking)}</pdf:Keywords>\n` +
    '</rdf:Description>\n' +
    '</rdf:RDF>\n' +
    '</x:xmpmeta>\n' +
    '<?xpacket end="r"?>'
  )
}

/** What a machine is told about how the document came to exist. */
export interface AiProvenance {
  /**
   * The agent run that produced the content, when the caller knows it. Absent
   * rather than empty when it does not: a run id nobody can look up is worse
   * than no run id, because it reads like an audit trail.
   */
  runId?: string
}

/**
 * A marking string this repository built, rather than any string at all.
 *
 * ## Why a brand and not `string`
 *
 * `fileGeneratedDocument` requires every producer to hand back the marking its
 * bytes carry, and then checks the bytes really carry it. A plain `string`
 * would let a producer satisfy the type with a sentence of its own invention —
 * marked, in a vocabulary no detector matches, and passing every check. The
 * brand makes {@link aiProvenanceMarking} the ONLY way to obtain the type, so
 * "this rendering is marked" and "it is marked in the one vocabulary the
 * `.pdf`, the `.docx` and the `.svg` share" are the same statement.
 *
 * The cast that mints it lives in that one function and nowhere else.
 */
declare const aiProvenanceMarkingBrand: unique symbol
export type AiProvenanceMarking = string & { readonly [aiProvenanceMarkingBrand]: 'ai-provenance' }

/**
 * The marking as one string, in the vocabulary above.
 *
 * ## The limit this function exists to work around, stated plainly
 *
 * A `.docx` is an OPC package, so the marking gets its own part with its own
 * named, typed properties. **A PDF written by `@react-pdf/renderer` 4.6.0 has
 * no equivalent.** `<Document>` accepts exactly the Info-dictionary fields —
 * `title`, `author`, `subject`, `keywords`, `creator`, `producer`, `language`,
 * `creationDate`, `modificationDate` (checked against
 * `node_modules/@react-pdf/renderer/index.d.ts`, `interface DocumentProps`) —
 * and `renderer/lib/react-pdf.js` maps them one-for-one onto PDFKit's `info`.
 * There is no custom-key facility and no XMP hook: the underlying
 * `@react-pdf/pdfkit` does have `appendXML`, but it is reachable only through
 * the `subset` option (PDF/A, PDF/UA), which `<Document>` does not expose.
 *
 * So the closest supported field carries the whole marking, and `Keywords` is
 * the one Info field that is a LIST by convention — a reader that splits it on
 * `;` gets the four properties back, and a reader that does not still sees the
 * words. `Creator` carries {@link AI_GENERATOR_NAME} alongside it so a tool
 * that only reads the obvious field is not left with nothing.
 *
 * The SVG producer carries the SAME string in the root's `<desc>`, which is why
 * this is no longer called `aiProvenanceKeywords`: `Keywords` is where the PDF
 * puts it, not what it is. One string, three carriers, one detector regex.
 *
 * The XMP the renderer cannot write is added after it, to the finished bytes,
 * as an incremental update (`@/lib/pdf/xmp-metadata`, {@link aiProvenanceXmp});
 * the Info fields stay, for the readers that only look there.
 */
export function aiProvenanceMarking(provenance: AiProvenance): AiProvenanceMarking {
  const parts = [
    `${AI_PROVENANCE_PROPERTIES.generated}=true`,
    `${AI_PROVENANCE_PROPERTIES.generator}=${AI_GENERATOR_NAME}`,
    `${AI_PROVENANCE_PROPERTIES.humanReviewed}=false`,
    // The standard's term in the string too, so a carrier that has only this
    // string (Markdown's fenced block, an SVG's <desc>, a PDF's Keywords) still
    // says `trainedAlgorithmicMedia` to a detector not built for this product.
    `${AI_PROVENANCE_PROPERTIES.digitalSourceType}=${IPTC_TRAINED_ALGORITHMIC_MEDIA}`,
  ]
  if (provenance.runId) parts.push(`${AI_PROVENANCE_PROPERTIES.runId}=${provenance.runId}`)
  // The one place the brand is minted. Everything downstream that holds an
  // `AiProvenanceMarking` holds a string this function built.
  return parts.join('; ') as AiProvenanceMarking
}

/**
 * Is the marking actually IN these bytes?
 *
 * ## Why the check is on bytes and not on the object that described them
 *
 * Every producer here builds a file through a library — react-pdf, this repo's
 * SVG serialiser — and every one of those libraries is free to drop what it was
 * handed. `diagram_pdf` set no `keywords` at all and `diagram_svg` set nothing
 * anywhere, and both shipped: the marking was applied by convention at each
 * producer, and a convention is exactly what nothing checks. An assertion on
 * the element tree, or on the options object, would have passed for both.
 *
 * So the question asked at the filing seam is the only one that matters to the
 * person who ends up with the file: **do the stored bytes say a machine wrote
 * them?**
 *
 * ## Two encodings, because a PDF string has two spellings
 *
 * PDFKit writes an Info string as a literal `(…)` when every character is
 * ASCII, and as UTF-16BE with a byte-order mark when any character is not
 * (`@react-pdf/pdfkit`, `PDFObject.convert`). The marking is ASCII today —
 * `AIGenerated=true; AIGenerator=Piloti; …` — but a reference carrying one
 * non-ASCII character flips the WHOLE string to the second spelling, and a
 * scan that only knew the first would refuse to file a report that is in fact
 * correctly marked. Both spellings are searched for that reason, and for no
 * other: nothing writes UTF-16 deliberately.
 */
export function markingIsInBytes(bytes: Uint8Array, marking: AiProvenanceMarking): boolean {
  return (
    includesBytes(bytes, new TextEncoder().encode(marking)) ||
    includesBytes(bytes, utf16beBytes(marking))
  )
}

/** The same characters as UTF-16BE, the second spelling a PDF string takes. */
function utf16beBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2)
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    out[index * 2] = code >> 8
    out[index * 2 + 1] = code & 0xff
  }
  return out
}

/**
 * A byte-exact substring search.
 *
 * Written out rather than done by decoding the haystack to a string first,
 * because every single-byte decoding available in both runtimes lies somewhere:
 * `TextDecoder('latin1')` is an alias for windows-1252 in the Encoding
 * Standard, which does NOT map 0x80–0x9F one-to-one, and those are ordinary
 * bytes inside a PDF's compressed streams. A file whose marking happened to sit
 * next to one would be searched in a haystack that is not the file.
 */
function includesBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false
  const last = haystack.length - needle.length
  for (let start = 0; start <= last; start += 1) {
    let matched = 0
    while (matched < needle.length && haystack[start + matched] === needle[matched]) matched += 1
    if (matched === needle.length) return true
  }
  return false
}
