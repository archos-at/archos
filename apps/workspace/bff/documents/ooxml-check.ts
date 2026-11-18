import { unzipSync } from 'fflate'

export const OOXML_REFUSALS = [
  'malformed',
  'not-the-declared-type',
  'macro',
  'embedded-object',
  'external-relationship',
  'active-content',
] as const
export type OoxmlRefusal = (typeof OOXML_REFUSALS)[number]

export class OoxmlRefusalError extends Error {
  constructor(
    readonly refusal: OoxmlRefusal,
    readonly detail: string,
  ) {
    super(`${refusal}: ${detail}`)
    this.name = 'OoxmlRefusalError'
  }
}

export const OOXML_MAIN_PART_CONTENT_TYPES = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
} as const
export type OoxmlFlavour = keyof typeof OOXML_MAIN_PART_CONTENT_TYPES

export const CONTENT_TYPES_PART = '[Content_Types].xml'
export const PACKAGE_RELS_PART = '_rels/.rels'

const MAX_ENTRIES = 5_000
const MAX_UNCOMPRESSED_BYTES = 150_000_000
const MAX_EMBEDDING_DEPTH = 1

export type OoxmlEntries = Record<string, Uint8Array>

const MACRO_CONTENT_TYPE = /macroEnabled|vbaProject|vbaData|macrosheet|\.binary\./i
const EMBEDDED_CONTENT_TYPE = /activeX|oleObject/i
const EXTERNAL_LINK_CONTENT_TYPE = /externalLink/i
const MACRO_PART = /(^|\/)vba(Project\.bin|Data\.xml)$/i
const EMBEDDED_PART = /(^|\/)activeX\//i
const EXTERNAL_LINK_PART = /(^|\/)externalLinks\//i
const BINARY_PART = /\.bin$/i
const PRINTER_SETTINGS_PART = /(^|\/)printerSettings\/[^/]+\.bin$/i
const EMBEDDINGS_PART = /(^|\/)embeddings\/[^/]+$/i
const EMBEDDED_PACKAGE = /\.(docx|xlsx|pptx)$/i
const HYPERLINK_RELATIONSHIP = /\/relationships\/hyperlink$/
const LINK_TARGET = /^(https?:|mailto:)/i
const MACRO_RELATIONSHIP = /\/(vbaProject|wordVbaData)$/i
const EMBEDDED_RELATIONSHIP = /\/(oleObject|control|activeXControl|activeXControlBinary)$/i

const decoder = new TextDecoder('utf-8', { fatal: false })

const textOf = (bytes: Uint8Array): string => decoder.decode(bytes)

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
}

export function readOoxmlEntries(bytes: Uint8Array): OoxmlEntries {
  if (!isZip(bytes)) throw new OoxmlRefusalError('not-the-declared-type', 'not a zip package')
  const seen = new Set<string>()
  let total = 0
  let refusal: OoxmlRefusalError | null = null
  let entries: OoxmlEntries
  try {
    entries = unzipSync(bytes, {
      filter: (file) => {
        const key = file.name.toLowerCase()
        if (seen.has(key)) refusal ??= new OoxmlRefusalError('malformed', `duplicate entry ${file.name}`)
        seen.add(key)
        total += file.originalSize
        if (seen.size > MAX_ENTRIES) refusal ??= new OoxmlRefusalError('malformed', 'too many entries')
        if (total > MAX_UNCOMPRESSED_BYTES) refusal ??= new OoxmlRefusalError('malformed', 'expands beyond the limit')
        return refusal === null && !file.name.endsWith('/')
      },
    })
  } catch (error) {
    throw new OoxmlRefusalError('malformed', error instanceof Error ? error.message : 'unreadable zip')
  }
  if (refusal) throw refusal
  return entries
}

export function partNamed(entries: OoxmlEntries, name: string): string | undefined {
  const wanted = name.replace(/^\//, '').toLowerCase()
  return Object.keys(entries).find((key) => key.toLowerCase() === wanted)
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

export function decodeXmlText(text: string): string {
  return text.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi, (whole, hex?: string, decimal?: string, name?: string) => {
    if (name) return NAMED_ENTITIES[name.toLowerCase()]
    const code = hex ? parseInt(hex, 16) : Number(decimal)
    return code <= 0x10ffff ? String.fromCodePoint(code) : whole
  })
}

const CDATA = /<!\[CDATA\[([\s\S]*?)\]\]>/g

const unwrapCdata = (xml: string): string =>
  xml.replace(CDATA, (_whole, content: string) => content.replace(/&/g, '&amp;').replace(/</g, '&lt;'))

export function xmlAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  for (const match of tag.matchAll(/([\w:.-]+)\s*=\s*(["'])([\s\S]*?)\2/g)) attributes[match[1]] = decodeXmlText(match[3])
  return attributes
}

export function xmlElements(xml: string, localName: string): Record<string, string>[] {
  const pattern = new RegExp(`<(?:[\\w.-]+:)?${localName}\\b([^>]*?)/?>`, 'g')
  return [...xml.matchAll(pattern)].map((match) => xmlAttributes(match[1]))
}

interface ContentTypeEntry {
  partName?: string
  extension?: string
  contentType: string
}

function contentTypesOf(entries: OoxmlEntries): ContentTypeEntry[] {
  const part = partNamed(entries, CONTENT_TYPES_PART)
  if (!part) throw new OoxmlRefusalError('not-the-declared-type', `no ${CONTENT_TYPES_PART}`)
  const xml = textOf(entries[part])
  const overrides = xmlElements(xml, 'Override').map((a) => ({ partName: a.PartName, contentType: a.ContentType ?? '' }))
  const defaults = xmlElements(xml, 'Default').map((a) => ({ extension: a.Extension, contentType: a.ContentType ?? '' }))
  return [...overrides, ...defaults]
}

function refuseContentTypes(types: readonly ContentTypeEntry[]): void {
  for (const { contentType, partName, extension } of types) {
    const where = partName ?? `*.${extension ?? ''}`
    if (MACRO_CONTENT_TYPE.test(contentType)) throw new OoxmlRefusalError('macro', `${where}: ${contentType}`)
    if (EMBEDDED_CONTENT_TYPE.test(contentType)) throw new OoxmlRefusalError('embedded-object', `${where}: ${contentType}`)
    if (EXTERNAL_LINK_CONTENT_TYPE.test(contentType)) {
      throw new OoxmlRefusalError('external-relationship', `${where}: ${contentType}`)
    }
  }
}

function refuseRelationships(entries: OoxmlEntries): void {
  for (const name of Object.keys(entries)) {
    if (!name.toLowerCase().endsWith('.rels')) continue
    for (const relationship of xmlElements(textOf(entries[name]), 'Relationship')) {
      const type = relationship.Type ?? ''
      if (MACRO_RELATIONSHIP.test(type)) throw new OoxmlRefusalError('macro', `${name}: ${type}`)
      if (EMBEDDED_RELATIONSHIP.test(type)) throw new OoxmlRefusalError('embedded-object', `${name}: ${type}`)
      if ((relationship.TargetMode ?? '').toLowerCase() !== 'external') continue
      const target = relationship.Target ?? ''
      if (HYPERLINK_RELATIONSHIP.test(type) && LINK_TARGET.test(target.trim())) continue
      throw new OoxmlRefusalError('external-relationship', `${name}: ${type} -> ${target}`)
    }
  }
}

const FIELD_INSTRUCTIONS =
  /<(?:[\w.-]+:)?instrText\b[^>]*>([^<]*)<\/(?:[\w.-]+:)?instrText>|(?:[\w.-]+:)?\binstr\s*=\s*(?:"([^"]*)"|'([^']*)')/g
const ACTIVE_FIELD = /\b(DDE|DDEAUTO|INCLUDETEXT|INCLUDEPICTURE|IMPORT)\b/i

function refuseActiveFields(name: string, xml: string): void {
  const instructions = [...unwrapCdata(xml).matchAll(FIELD_INSTRUCTIONS)]
    .map((match) => decodeXmlText(match[1] ?? match[2] ?? match[3] ?? ''))
    .join('')
  const field = ACTIVE_FIELD.exec(instructions)
  if (field) throw new OoxmlRefusalError('active-content', `${name}: field ${field[1].toUpperCase()}`)
}

const FORMULA = /<(?:\w+:)?f\b[^>]*>([^<]*)<\/(?:\w+:)?f>/g

function refuseDdeFormulas(name: string, xml: string): void {
  for (const match of unwrapCdata(xml).matchAll(FORMULA)) {
    const outsideStrings = decodeXmlText(match[1]).replace(/"[^"]*"/g, '')
    if (outsideStrings.includes('|')) throw new OoxmlRefusalError('active-content', `${name}: DDE formula`)
  }
}

function refuseParts(entries: OoxmlEntries, depth: number): void {
  for (const name of Object.keys(entries)) {
    if (MACRO_PART.test(name)) throw new OoxmlRefusalError('macro', name)
    if (EMBEDDED_PART.test(name)) throw new OoxmlRefusalError('embedded-object', name)
    if (EXTERNAL_LINK_PART.test(name)) throw new OoxmlRefusalError('external-relationship', name)
    if (EMBEDDINGS_PART.test(name)) {
      if (!EMBEDDED_PACKAGE.test(name) || depth >= MAX_EMBEDDING_DEPTH) {
        throw new OoxmlRefusalError('embedded-object', name)
      }
      checkOoxmlEntries(readOoxmlEntries(entries[name]), null, depth + 1)
      continue
    }
    if (BINARY_PART.test(name) && !PRINTER_SETTINGS_PART.test(name)) {
      throw new OoxmlRefusalError('embedded-object', name)
    }
    if (!/\.xml$/i.test(name)) continue
    refuseActiveFields(name, textOf(entries[name]))
    refuseDdeFormulas(name, textOf(entries[name]))
  }
}

export function checkOoxmlEntries(entries: OoxmlEntries, flavour: OoxmlFlavour | null, depth = 0): void {
  const types = contentTypesOf(entries)
  refuseContentTypes(types)
  const wanted = flavour ? [OOXML_MAIN_PART_CONTENT_TYPES[flavour]] : Object.values(OOXML_MAIN_PART_CONTENT_TYPES)
  const main = types.find((entry) => entry.partName && (wanted as readonly string[]).includes(entry.contentType))
  if (!main?.partName || !partNamed(entries, main.partName)) {
    throw new OoxmlRefusalError('not-the-declared-type', `no ${flavour ?? 'Office'} main part`)
  }
  refuseRelationships(entries)
  refuseParts(entries, depth)
}

export function checkOoxmlPackage(bytes: Uint8Array, flavour: OoxmlFlavour): OoxmlEntries {
  const entries = readOoxmlEntries(bytes)
  checkOoxmlEntries(entries, flavour)
  return entries
}
