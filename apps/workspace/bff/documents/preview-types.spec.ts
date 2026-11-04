/**
 * The one preview list, pinned to the route that enforces it.
 *
 * Three surfaces decide "can this be shown": the preview route (which 415s
 * anything outside the list), the Files pane (which decides whether to ASK),
 * and the citation resolver (which decides whether a chip promises a viewer or
 * a download). They have drifted twice — BMP and TIFF both times — and each
 * copy looked locally correct, so nothing failed and a reader simply got told
 * the product could not show a file it renders fine.
 *
 * These are the assertions that make a fourth copy fail instead of ship.
 */

import { describe, expect, it } from 'vitest'
import {
  DRAWING_RENDITION_CONTENT_TYPES,
  DRAWING_RENDITION_EXTENSIONS,
  INLINE_PREVIEW_CONTENT_TYPES,
  OFFICE_RENDITION_CONTENT_TYPES,
  OFFICE_RENDITION_EXTENSIONS,
  RENDITION_INDEXED_EXTENSIONS,
  TEXT_PREVIEW_CONTENT_TYPES,
  isInlinePreviewable,
  isIndexedFromRendition,
  isDrawingRenditionSource,
  isOfficeRenditionSource,
  isRenditionSource,
  storedContentType,
} from './preview-types'

describe('the preview content-type lists', () => {
  it('covers the image types the object store serves and the PDF', () => {
    expect([...INLINE_PREVIEW_CONTENT_TYPES]).toEqual([
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/gif',
      'image/webp',
      'image/svg+xml',
      // The two that went missing twice. Named individually because a length
      // check would pass the day someone swaps one for another.
      'image/bmp',
      'image/tiff',
    ])
  })

  it('never serves user-uploaded HTML as text from this origin', () => {
    // Same-origin HTML carries script into this origin. `service.ts` says so at
    // its own definition; this is the assertion behind the sentence.
    expect([...TEXT_PREVIEW_CONTENT_TYPES]).not.toContain('text/html')
  })

  it('matches case-insensitively and tolerates whitespace, because content types arrive as headers', () => {
    expect(isInlinePreviewable('APPLICATION/PDF')).toBe(true)
    expect(isInlinePreviewable(' image/png ')).toBe(true)
    expect(
      isInlinePreviewable('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    ).toBe(false)
    expect(isInlinePreviewable(null)).toBe(false)
    expect(isInlinePreviewable(undefined)).toBe(false)
  })

  it('keeps the two lists disjoint — a type is served one way or the other', () => {
    const inline = new Set<string>(INLINE_PREVIEW_CONTENT_TYPES)
    for (const type of TEXT_PREVIEW_CONTENT_TYPES) expect(inline.has(type)).toBe(false)
  })
})

/**
 * The third way of being shown (ADR-0070): not the stored bytes but a PDF the
 * BFF made from them. The preview route, the file route and the ingest dispatch
 * all ask this one predicate, so it is pinned here.
 */
describe('isOfficeRenditionSource', () => {
  it('recognises an office file by its stored type', () => {
    expect(
      isOfficeRenditionSource({
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        filename: 'Baubeschreibung',
      })
    ).toBe(true)
    expect(isOfficeRenditionSource({ contentType: 'application/vnd.ms-excel; charset=binary' })).toBe(true)
  })

  it('recognises one by its extension when the stored type is empty or generic', () => {
    expect(isOfficeRenditionSource({ contentType: null, filename: 'Kosten.XLSX' })).toBe(true)
    expect(isOfficeRenditionSource({ contentType: 'application/octet-stream', filename: 'Präsentation.pptx' })).toBe(
      true
    )
    expect(isOfficeRenditionSource({ filename: 'piloti/doc-1/bericht.docx' })).toBe(true)
    expect(isOfficeRenditionSource({ filename: 'protokoll.odt' })).toBe(true)
    expect(isOfficeRenditionSource({ filename: 'brief.rtf' })).toBe(true)
  })

  it('leaves everything that is shown some other way alone', () => {
    expect(isOfficeRenditionSource({ contentType: 'application/pdf', filename: 'plan.pdf' })).toBe(false)
    expect(isOfficeRenditionSource({ contentType: 'text/csv', filename: 'katalog.csv' })).toBe(false)
    expect(isOfficeRenditionSource({ contentType: 'image/png', filename: 'foto.png' })).toBe(false)
    expect(isOfficeRenditionSource({ filename: 'haus.ifc' })).toBe(false)
    expect(isOfficeRenditionSource({ filename: 'docx' })).toBe(false)
    expect(isOfficeRenditionSource({})).toBe(false)
  })

  it('never overlaps the inline list, so a stored PDF is never re-rendered', () => {
    const inline = new Set<string>(INLINE_PREVIEW_CONTENT_TYPES)
    for (const type of OFFICE_RENDITION_CONTENT_TYPES) expect(inline.has(type)).toBe(false)
  })
})

/**
 * Which office files are INDEXED from their rendition (ADR-0071). The ingest
 * dispatch and the citation page both read this predicate; spreadsheets with
 * their own structure-preserving extractor must stay out of it.
 */
describe('isIndexedFromRendition', () => {
  it('covers Word, presentations and the spreadsheets with no extractor of their own', () => {
    for (const name of [
      'Bericht.docx',
      'Makro.DOCM',
      'alt.doc',
      'protokoll.odt',
      'brief.rtf',
      'Vortrag.pptx',
      'Vortrag.pptm',
      'alt.ppt',
      'folien.odp',
      'alt.xls',
      'tabelle.ods',
      'Katasterauszug.DXF',
    ])
      expect(isIndexedFromRendition(name), name).toBe(true)
  })

  it('keeps .xlsx and .xlsm on their own extractor, and ignores non-office files', () => {
    for (const name of ['Kosten.xlsx', 'Makro.xlsm', 'plan.pdf', 'haus.ifc', 'docx', '', null, undefined])
      expect(isIndexedFromRendition(name), String(name)).toBe(false)
  })

  it('is a subset of the formats that have a rendition at all', () => {
    const rendered = new Set<string>([...OFFICE_RENDITION_EXTENSIONS, ...DRAWING_RENDITION_EXTENSIONS])
    for (const ext of RENDITION_INDEXED_EXTENSIONS) expect(rendered.has(ext), ext).toBe(true)
  })
})

/**
 * A DXF is read through a PDF too, drawn by the backend rather than Gotenberg
 * (ADR-0152). The general predicate is what every surface asks; the drawing one
 * is what picks the converter.
 */
describe('isDrawingRenditionSource and isRenditionSource', () => {
  it('recognises a DXF by its extension or by any of its types', () => {
    expect(isDrawingRenditionSource({ filename: 'Katasterauszug Mödling.dxf' })).toBe(true)
    expect(isDrawingRenditionSource({ filename: 'LAGEPLAN.DXF', contentType: 'application/octet-stream' })).toBe(true)
    for (const contentType of DRAWING_RENDITION_CONTENT_TYPES) {
      expect(isDrawingRenditionSource({ contentType, filename: 'ohne-endung' }), contentType).toBe(true)
    }
  })

  it('is no office file, and every rendition source is one or the other', () => {
    expect(isOfficeRenditionSource({ filename: 'plan.dxf' })).toBe(false)
    expect(isDrawingRenditionSource({ filename: 'bericht.docx' })).toBe(false)
    expect(isRenditionSource({ filename: 'plan.dxf' })).toBe(true)
    expect(isRenditionSource({ filename: 'bericht.docx' })).toBe(true)
    expect(isRenditionSource({ filename: 'haus.ifc' })).toBe(false)
    expect(isRenditionSource({ filename: 'plan.dwg' })).toBe(false)
  })

  it('never overlaps the inline list, so a drawing is never served as an image', () => {
    const inline = new Set<string>(INLINE_PREVIEW_CONTENT_TYPES)
    for (const type of DRAWING_RENDITION_CONTENT_TYPES) expect(inline.has(type)).toBe(false)
  })
})

describe('storedContentType', () => {
  it('stores a DXF as application/dxf whatever the browser called it, so nothing takes it for a picture', () => {
    expect(storedContentType({ name: 'Kataster.dxf', type: 'image/vnd.dxf' })).toBe('application/dxf')
    expect(storedContentType({ name: 'Kataster.DXF', type: '' })).toBe('application/dxf')
  })

  it('keeps every other file’s own type, and an empty one as null', () => {
    expect(storedContentType({ name: 'foto.jpg', type: 'image/jpeg' })).toBe('image/jpeg')
    expect(storedContentType({ name: 'notiz', type: '' })).toBeNull()
  })
})
