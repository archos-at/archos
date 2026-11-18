import { BadRequestError, FileTooLargeError } from '@/lib/api/errors'
import { DiagramSvgError, parseDiagramSvg, type DiagramSvgRejection, type SvgElement } from '@/lib/diagrams/svg'
import { readPdfStructure, decodeStream, dictionaryAt, PdfMetadataError } from '@/lib/pdf/pdf-structure'
import {
  AGENT_FILE_CONTENT_TYPES,
  AGENT_FILE_MAX_BYTES,
  AGENT_FILE_TYPES,
  agentFileTypeOf,
  normalizeContentType,
  REFUSED_AGENT_FILE_TYPES,
  type AgentFileContentType,
} from './agent-file-types'
import { checkOoxmlPackage, OoxmlRefusalError, type OoxmlEntries, type OoxmlFlavour } from './ooxml-check'
import { PngStructureError, readPngChunks, type PngChunk } from './png-xmp'

export const AGENT_FILE_REFUSALS = [
  'type-not-allowed',
  'not-the-declared-type',
  'malformed',
  'macro',
  'embedded-object',
  'external-relationship',
  'active-content',
] as const
export type AgentFileRefusal = (typeof AGENT_FILE_REFUSALS)[number]

export class AgentFileRefusedError extends BadRequestError {
  constructor(
    readonly refusal: AgentFileRefusal,
    message: string,
    readonly detail?: string,
  ) {
    super(message, { refusal, ...(detail ? { detail } : {}) })
    this.name = 'AgentFileRefusedError'
  }
}

export type CheckedAgentFile =
  | { kind: 'ooxml'; contentType: AgentFileContentType; entries: OoxmlEntries }
  | { kind: 'pdf'; contentType: AgentFileContentType; bytes: Uint8Array }
  | { kind: 'png'; contentType: AgentFileContentType; chunks: PngChunk[] }
  | { kind: 'svg'; contentType: AgentFileContentType; root: SvgElement }

const REFUSAL_MESSAGES: Record<AgentFileRefusal, string> = {
  'type-not-allowed': `This file type cannot be filed. Allowed: ${AGENT_FILE_CONTENT_TYPES.join(', ')}.`,
  'not-the-declared-type': 'The bytes are not a file of the declared content type.',
  malformed: 'The file is damaged or cannot be read.',
  macro: 'The file contains macros, which are never filed. Save it without macros (.docx, .xlsx, .pptx).',
  'embedded-object': 'The file embeds an object or program (OLE, ActiveX, an attached file), which is never filed.',
  'external-relationship':
    'The file loads something from outside itself when opened (a remote template, linked image or external workbook), which is never filed. Hyperlinks are fine.',
  'active-content': 'The file contains content that runs when opened (scripts, DDE fields or formulas, launch actions), which is never filed.',
}

export const refuse = (refusal: AgentFileRefusal, detail?: string): AgentFileRefusedError =>
  new AgentFileRefusedError(refusal, REFUSAL_MESSAGES[refusal], detail)

export function decodeAgentFileBase64(contentBase64: string): Uint8Array {
  const bytes = new Uint8Array(Buffer.from(contentBase64, 'base64'))
  if (bytes.byteLength > AGENT_FILE_MAX_BYTES) {
    throw new FileTooLargeError({ fileSize: bytes.byteLength, maxSizeBytes: AGENT_FILE_MAX_BYTES })
  }
  if (bytes.byteLength === 0) throw refuse('malformed', 'the file is empty')
  return bytes
}

export function requireAgentFileType(contentType: string): AgentFileContentType {
  const type = agentFileTypeOf(contentType)
  if (type) return type
  const reason = REFUSED_AGENT_FILE_TYPES[normalizeContentType(contentType)]
  if (reason) throw new AgentFileRefusedError('type-not-allowed', reason, normalizeContentType(contentType))
  throw refuse('type-not-allowed', normalizeContentType(contentType))
}

function checkOoxml(bytes: Uint8Array, contentType: AgentFileContentType): CheckedAgentFile {
  try {
    const entries = checkOoxmlPackage(bytes, AGENT_FILE_TYPES[contentType].extension as OoxmlFlavour)
    return { kind: 'ooxml', contentType, entries }
  } catch (error) {
    if (error instanceof OoxmlRefusalError) throw refuse(error.refusal, error.detail)
    throw error
  }
}

const ACTIVE_PDF_NAMES: ReadonlyMap<string, AgentFileRefusal> = new Map([
  ['JavaScript', 'active-content'],
  ['JS', 'active-content'],
  ['Launch', 'active-content'],
  ['SubmitForm', 'active-content'],
  ['ImportData', 'active-content'],
  ['RichMedia', 'active-content'],
  ['XFA', 'active-content'],
  ['EmbeddedFile', 'embedded-object'],
  ['EmbeddedFiles', 'embedded-object'],
  ['GoToR', 'external-relationship'],
  ['GoToE', 'external-relationship'],
])

const STREAM_BODY = /stream(?:\r\n|\n|\r)[\s\S]*?endstream/g
const OBJECT_OR_STREAM = /(stream(?:\r\n|\n|\r)[\s\S]*?endstream)|(\d+\s+\d+\s+obj\s*<<)/g

function pdfObjectTexts(bytes: Uint8Array, text: string): string[] {
  const texts = [text.replace(STREAM_BODY, 'stream endstream')]
  for (const match of text.matchAll(OBJECT_OR_STREAM)) {
    if (match[1]) continue
    const opening = match.index + match[0].length - 2
    let dictionary: string
    try {
      dictionary = dictionaryAt(text, opening)
    } catch {
      continue
    }
    if (!/\/Type\s*\/ObjStm\b/.test(decodeName(dictionary))) continue
    const keyword = /^\s*stream(\r\n|\n|\r)/.exec(text.slice(opening + dictionary.length, opening + dictionary.length + 16))
    const length = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dictionary)
    if (!keyword || !length) throw new PdfMetadataError('an object stream has no readable data')
    const start = opening + dictionary.length + keyword[0].length
    texts.push(Buffer.from(decodeStream(dictionary, bytes.subarray(start, start + Number(length[1])))).toString('latin1'))
  }
  return texts
}

const decodeName = (name: string): string => name.replace(/#([0-9A-Fa-f]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))

function checkPdf(bytes: Uint8Array, contentType: AgentFileContentType): CheckedAgentFile {
  const text = Buffer.from(bytes).toString('latin1')
  if (!text.startsWith('%PDF-')) throw refuse('not-the-declared-type', 'no %PDF- header')
  try {
    readPdfStructure(bytes)
    for (const objects of pdfObjectTexts(bytes, text)) {
      for (const match of objects.matchAll(/\/([^\s/[\]<>(){}%]+)/g)) {
        const refusal = ACTIVE_PDF_NAMES.get(decodeName(match[1]))
        if (refusal) throw refuse(refusal, `/${decodeName(match[1])}`)
      }
    }
  } catch (error) {
    if (error instanceof PdfMetadataError) throw refuse('malformed', error.message)
    throw error
  }
  return { kind: 'pdf', contentType, bytes }
}

const SVG_REFUSALS: Partial<Record<DiagramSvgRejection, AgentFileRefusal>> = {
  'script-element': 'active-content',
  'event-handler-attribute': 'active-content',
  'foreign-object': 'active-content',
  'external-reference': 'external-relationship',
  'not-svg': 'not-the-declared-type',
}

const OUR_SVG_XMP = /<metadata>\s*<x:xmpmeta\b[\s\S]*?<\/x:xmpmeta>\s*<\/metadata>/

function checkSvg(bytes: Uint8Array, contentType: AgentFileContentType): CheckedAgentFile {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw refuse('not-the-declared-type', 'not UTF-8 text')
  }
  try {
    return { kind: 'svg', contentType, root: parseDiagramSvg(text.replace(/^\uFEFF/, '').replace(OUR_SVG_XMP, '')).root }
  } catch (error) {
    if (!(error instanceof DiagramSvgError)) throw error
    throw refuse(SVG_REFUSALS[error.rejection] ?? 'malformed', `${error.rejection}: ${error.detail}`)
  }
}

function checkPng(bytes: Uint8Array, contentType: AgentFileContentType): CheckedAgentFile {
  try {
    return { kind: 'png', contentType, chunks: readPngChunks(bytes) }
  } catch (error) {
    if (!(error instanceof PngStructureError)) throw error
    throw refuse(error.message.includes('signature') ? 'not-the-declared-type' : 'malformed', error.message)
  }
}

export function checkAgentFile(bytes: Uint8Array, declaredContentType: string): CheckedAgentFile {
  const contentType = requireAgentFileType(declaredContentType)
  if (bytes.byteLength > AGENT_FILE_MAX_BYTES) {
    throw new FileTooLargeError({ fileSize: bytes.byteLength, maxSizeBytes: AGENT_FILE_MAX_BYTES })
  }
  switch (AGENT_FILE_TYPES[contentType].kind) {
    case 'ooxml':
      return checkOoxml(bytes, contentType)
    case 'pdf':
      return checkPdf(bytes, contentType)
    case 'svg':
      return checkSvg(bytes, contentType)
    case 'png':
      return checkPng(bytes, contentType)
  }
}
