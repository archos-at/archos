/**
 * @vitest-environment node
 */
import { unzipSync } from 'fflate'
import { Window } from 'happy-dom'
import { describe, expect, it } from 'vitest'
import {
  AI_GENERATOR_NAME,
  IPTC_TRAINED_ALGORITHMIC_MEDIA,
  aiProvenanceMarking,
  markingIsInBytes,
} from '@/lib/ai-provenance'
import { readPdf } from '@/test-utils/read-pdf'
import { checkAgentFile } from './agent-file-check'
import { stampAgentFile } from './agent-file-marking'
import { readPngChunks, PNG_XMP_KEYWORD } from './png-xmp'
import { classicPdf, DOCX, objectStreamPdf, ooxml, png, PPTX, svg, XLSX } from './agent-file.fixtures'
import { mergeCustomPropertiesXml } from './ooxml-provenance'

const marking = aiProvenanceMarking({})
const decoder = new TextDecoder()

const stamp = (bytes: Uint8Array, contentType: string): Uint8Array =>
  stampAgentFile(checkAgentFile(bytes, contentType), {}, marking)

const parseXml = (xml: string): Document => {
  const window = new Window()
  return new window.DOMParser().parseFromString(xml, 'application/xml') as unknown as Document
}

describe('every allowed type carries the marking in its bytes and passes the check again', () => {
  it.each([
    [DOCX, ooxml()],
    [XLSX, ooxml({ flavour: 'xlsx' })],
    [PPTX, ooxml({ flavour: 'pptx' })],
    ['application/pdf', classicPdf()],
    ['application/pdf', objectStreamPdf()],
    ['image/png', png()],
    ['image/svg+xml', svg()],
  ])('%s', (contentType, bytes) => {
    expect(markingIsInBytes(bytes, marking)).toBe(false)
    const stamped = stamp(bytes, contentType)
    expect(markingIsInBytes(stamped, marking)).toBe(true)
    const again = stamp(stamped, contentType)
    expect(markingIsInBytes(again, marking)).toBe(true)
  })
})

describe('OOXML custom properties', () => {
  const custom = (bytes: Uint8Array) => {
    const parts = unzipSync(bytes)
    return { parts, xml: decoder.decode(parts['docProps/custom.xml']) }
  }

  it('states generated, generator, unreviewed, source type and the full marking', () => {
    const { parts, xml } = custom(stamp(ooxml(), DOCX))
    const properties = [...parseXml(xml).getElementsByTagName('property')]
    const stated = new Map(properties.map((p) => [p.getAttribute('name'), p.textContent]))
    expect(stated.get('AIGenerated')).toBe('true')
    expect(stated.get('AIGenerator')).toBe(AI_GENERATOR_NAME)
    expect(stated.get('AIHumanReviewed')).toBe('false')
    expect(stated.get('DigitalSourceType')).toBe(IPTC_TRAINED_ALGORITHMIC_MEDIA)
    expect(stated.get('AIProvenance')).toBe(marking)

    expect(decoder.decode(parts['[Content_Types].xml'])).toContain(
      '<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>',
    )
    expect(decoder.decode(parts['_rels/.rels'])).toMatch(
      /relationships\/custom-properties" Target="docProps\/custom.xml"/,
    )
    expect(Object.keys(parts)).toContain('word/document.xml')
  })

  it('keeps the custom properties a library already wrote, and does not link the part twice', () => {
    const existing =
      '<?xml version="1.0" encoding="UTF-8"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" ' +
      'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
      '<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="Projekt"><vt:lpwstr>Haus A</vt:lpwstr></property>' +
      '<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="3" name="AIHumanReviewed"><vt:bool>true</vt:bool></property>' +
      '</Properties>'
    const twice = stamp(stamp(ooxml({ extraParts: { 'docProps/custom.xml': existing } }), DOCX), DOCX)
    const { parts, xml } = custom(twice)
    const properties = [...parseXml(xml).getElementsByTagName('property')]
    const names = properties.map((p) => p.getAttribute('name'))

    expect(names.filter((name) => name === 'Projekt')).toHaveLength(1)
    expect(names.filter((name) => name === 'AIHumanReviewed')).toHaveLength(1)
    expect(properties.find((p) => p.getAttribute('name') === 'AIHumanReviewed')?.textContent).toBe('false')
    const pids = properties.map((p) => Number(p.getAttribute('pid')))
    expect(new Set(pids).size).toBe(pids.length)
    expect(decoder.decode(parts['[Content_Types].xml']).match(/docProps\/custom\.xml/g)).toHaveLength(1)
    expect(decoder.decode(parts['_rels/.rels']).match(/custom-properties/g)).toHaveLength(1)
  })

  it('writes a fresh part when there is none to merge into', () => {
    expect(mergeCustomPropertiesXml(null, [{ name: 'A', value: '<vt:bool>true</vt:bool>' }])).toContain('pid="2" name="A"')
  })
})

describe('PDF metadata, read back by pdf.js', () => {
  it.each([
    ['a cross-reference table', classicPdf],
    ['a cross-reference stream with object streams (pdf-lib’s default)', objectStreamPdf],
  ])('%s: XMP and Info carry the marking, the title and the page survive', async (_case, make) => {
    const original = make()
    const stamped = stamp(original, 'application/pdf')
    expect(stamped.subarray(0, original.length)).toEqual(original)

    const pdf = await readPdf(stamped)
    expect(pdf.pageCount).toBe(1)
    expect(pdf.xmp['pdf:keywords']).toBe(marking)
    expect(pdf.xmp['iptc4xmpext:digitalsourcetype']).toBe(IPTC_TRAINED_ALGORITHMIC_MEDIA)
    expect(pdf.info.Keywords).toBe(marking)
    expect(pdf.info.Creator).toBe(AI_GENERATOR_NAME)
    expect(pdf.info.Producer).toBe(AI_GENERATOR_NAME)
    expect(pdf.info.Title).toBe('Bericht (Entwurf)')
  })
})

describe('PNG iTXt', () => {
  it('writes one XMP chunk right after IHDR, and replaces it on a second stamp', () => {
    const twice = stamp(stamp(png(), 'image/png'), 'image/png')
    const chunks = readPngChunks(twice)
    expect(chunks.map((chunk) => chunk.type)).toEqual(['IHDR', 'iTXt', 'IDAT', 'IEND'])
    const text = decoder.decode(chunks[1].data)
    expect(text.startsWith(`${PNG_XMP_KEYWORD}\0`)).toBe(true)
    expect(text).toContain(`<pdf:Keywords>${marking}</pdf:Keywords>`)
  })
})

describe('SVG metadata', () => {
  it('puts the XMP in <metadata> as the first child and keeps the drawing', () => {
    const text = decoder.decode(stamp(svg(), 'image/svg+xml'))
    const document = parseXml(text)
    const root = document.documentElement
    expect(root.tagName.toLowerCase()).toBe('svg')
    expect(root.firstElementChild?.tagName.toLowerCase()).toBe('metadata')
    expect(text).toContain('<x:xmpmeta')
    expect(text).toContain('<rect')
    expect(text).toContain('<title>Diagramm</title>')
  })
})
