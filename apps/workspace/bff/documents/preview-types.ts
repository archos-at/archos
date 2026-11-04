/**
 * Which stored content types this product can show, and where.
 *
 * ONE LIST, because there are three readers of it and they have already drifted
 * twice. `PREVIEW_CONTENT_TYPES` in `lib/documents/document-delivery.ts` is what actually
 * gates the presign, so it was the authority and the other two were copies:
 * `file-preview-pane.tsx` carried a copy that had lost BMP and TIFF — the BFF
 * would presign bytes the pane never asked for, and the reader got the "no
 * inline preview" mock for a file the product could show — and the citation
 * resolver later grew a third copy that lost them again, plus the text types.
 * Each copy looked locally correct, which is exactly why the drift was
 * invisible.
 *
 * This module is pure, with no `server-only` import, precisely so the browser
 * tiers can share it: that was the reason the copies existed at all.
 */

/**
 * Rendered inline from the object store — a PDF frame or an `<img>`.
 *
 * The gate on `/api/documents/{id}/preview`: a type outside this list is a 415,
 * so a surface that offers a preview for one is offering something the BFF will
 * refuse.
 */
export const INLINE_PREVIEW_CONTENT_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/bmp',
  'image/tiff',
] as const

/**
 * Read as TEXT through this origin instead — `/api/documents/{id}/text`.
 *
 * A different shape of answer (a string, not an object-store URL), which is why
 * it is a second list rather than more entries in the first. `text/html` is
 * deliberately absent and must stay absent: these bytes are uploaded by users
 * and would be returned same-origin.
 */
export const TEXT_PREVIEW_CONTENT_TYPES = [
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'text/csv',
] as const

const inline = new Set<string>(INLINE_PREVIEW_CONTENT_TYPES)

/** Whether the object-store preview route will serve this type inline. */
export const isInlinePreviewable = (contentType: string | null | undefined): boolean =>
  contentType != null && inline.has(contentType.trim().toLowerCase())

/**
 * Office formats the BFF converts to a PDF RENDITION for viewing (ADR-0070).
 *
 * A third way of being shown, and a different promise from the two lists
 * above: these bytes are never served inline themselves. The preview and file
 * routes serve `<dir>/_render.pdf`, a PDF the BFF made from them through
 * Gotenberg, and the ORIGINAL stays exactly as uploaded — the download route
 * still hands out the Word, Excel or PowerPoint file and nothing else. Keyed by
 * extension as well as by type because the stored type is whatever the browser
 * sent, and an empty one is stored as NULL.
 */
export const OFFICE_RENDITION_CONTENT_TYPES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-word.document.macroenabled.12',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroenabled.12',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint.presentation.macroenabled.12',
  'application/vnd.ms-powerpoint',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/rtf',
  'text/rtf',
] as const

/** The extensions of {@link OFFICE_RENDITION_CONTENT_TYPES}, lower case, with the dot. */
export const OFFICE_RENDITION_EXTENSIONS = [
  '.docx',
  '.docm',
  '.doc',
  '.xlsx',
  '.xlsm',
  '.xls',
  '.pptx',
  '.pptm',
  '.ppt',
  '.odt',
  '.ods',
  '.odp',
  '.rtf',
] as const

const officeTypes = new Set<string>(OFFICE_RENDITION_CONTENT_TYPES)
const officeExtensions = new Set<string>(OFFICE_RENDITION_EXTENSIONS)

/**
 * Whether this is an OFFICE file, shown through the PDF rendition Gotenberg makes (ADR-0070).
 *
 * True when EITHER the stored type or the filename's extension names an office
 * format. A filename alone is enough on purpose: a `.docx` stored as NULL or
 * `application/octet-stream` is still a Word file, and LibreOffice reads the
 * bytes, not the label.
 */
export function isOfficeRenditionSource(file: {
  contentType?: string | null
  filename?: string | null
}): boolean {
  return matchesTypeOrExtension(file, officeTypes, officeExtensions)
}

/**
 * CAD drawings the BACKEND draws to a PDF rendition (ADR-0152): a DXF has no
 * viewer in a browser either, and ezdxf in the Python tier, not Gotenberg, is
 * the converter. Shown, thumbnailed, indexed and cited exactly as an office file
 * is; only who converts differs (`rendition.ts`). DWG is absent until an open
 * reader for it is in the image.
 */
export const DRAWING_RENDITION_CONTENT_TYPES = ['image/vnd.dxf', 'image/x-dxf', 'application/dxf', 'application/x-dxf'] as const

/** The extensions of {@link DRAWING_RENDITION_CONTENT_TYPES}, lower case, with the dot. */
export const DRAWING_RENDITION_EXTENSIONS = ['.dxf'] as const

const drawingTypes = new Set<string>(DRAWING_RENDITION_CONTENT_TYPES)
const drawingExtensions = new Set<string>(DRAWING_RENDITION_EXTENSIONS)

function matchesTypeOrExtension(
  file: { contentType?: string | null; filename?: string | null },
  types: ReadonlySet<string>,
  extensions: ReadonlySet<string>
): boolean {
  const type = file.contentType?.split(';', 1)[0]?.trim().toLowerCase()
  if (type && types.has(type)) return true
  const name = file.filename?.trim().toLowerCase() ?? ''
  const dot = name.lastIndexOf('.')
  return dot >= 0 && extensions.has(name.slice(dot))
}

/** Whether this file is a DXF drawing, drawn to its rendition by the backend (ADR-0152). */
export function isDrawingRenditionSource(file: { contentType?: string | null; filename?: string | null }): boolean {
  return matchesTypeOrExtension(file, drawingTypes, drawingExtensions)
}

/**
 * The type an upload is STORED with: the browser's, except for a DXF, which is
 * always `application/dxf`. The registered type is `image/vnd.dxf`, and a
 * Windows machine with a CAD program sends exactly that; stored, every check that
 * reads `image/*` as a photo (the kind sketch, the status icon, the viewer's
 * image branch) would take a drawing for a picture. One place to decide it, so
 * no later reader has to know.
 */
export function storedContentType(file: { name: string; type: string }): string | null {
  if (isDrawingRenditionSource({ filename: file.name })) return 'application/dxf'
  return file.type || null
}

/**
 * Whether this file is shown through a PDF rendition at all, office or drawing.
 * The one predicate the preview, the file route, the dispatch, the thumbnail and
 * the citation resolver ask; which converter makes it is `rendition.ts`'s concern.
 */
export function isRenditionSource(file: { contentType?: string | null; filename?: string | null }): boolean {
  return isOfficeRenditionSource(file) || isDrawingRenditionSource(file)
}

/**
 * Office formats whose TEXT the backend indexes from the PDF rendition, not the
 * original (ADR-0071).
 *
 * The rendition carries what the original's text-only readers never saw: the
 * pictures in a deck or a Word file, and real page numbers a citation can open
 * at. `.xls` and `.ods` are here because they have no extractor of their own and
 * would otherwise fall back to raw bytes. `.xlsx` and `.xlsm` are deliberately
 * absent: openpyxl keeps a sheet's rows and columns, and LibreOffice splits one
 * sheet across as many printed pages as its width needs.
 *
 * `.dxf` is here because it has nothing else to be read from: its rendition is
 * a page the backend draws with the drawing's text written in as a text layer
 * (ADR-0152), so the parcel numbers and labels are what is indexed.
 *
 * The BFF dispatch decides with this list and the citation resolver trusts a
 * locus page for the same formats, so both import it from here. The backend
 * mirrors it (`RENDITION_INDEXED_EXTENSIONS` in `knowledge_layer.ingest`, held by
 * `test_rendition_extensions_parity.py`) to know which files need one.
 */
export const RENDITION_INDEXED_EXTENSIONS = [
  '.docx',
  '.docm',
  '.doc',
  '.odt',
  '.rtf',
  '.pptx',
  '.pptm',
  '.ppt',
  '.odp',
  '.xls',
  '.ods',
  '.dxf',
] as const

const renditionIndexedExtensions = new Set<string>(RENDITION_INDEXED_EXTENSIONS)

/**
 * Whether this file's chunks come from its rendition, so a locus page is a
 * rendition page. Keyed by extension only: the dispatch and the resolver both
 * hold the filename, and the stored type is whatever the browser sent.
 */
export function isIndexedFromRendition(filename: string | null | undefined): boolean {
  const name = filename?.trim().toLowerCase() ?? ''
  const dot = name.lastIndexOf('.')
  return dot >= 0 && renditionIndexedExtensions.has(name.slice(dot))
}
