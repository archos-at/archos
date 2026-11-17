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

export const TEXT_PREVIEW_CONTENT_TYPES = [
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'text/csv',
] as const

const inline = new Set<string>(INLINE_PREVIEW_CONTENT_TYPES)

export const isInlinePreviewable = (contentType: string | null | undefined): boolean =>
  contentType != null && inline.has(contentType.trim().toLowerCase())

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

export function isOfficeRenditionSource(file: {
  contentType?: string | null
  filename?: string | null
}): boolean {
  return matchesTypeOrExtension(file, officeTypes, officeExtensions)
}

export const DRAWING_RENDITION_CONTENT_TYPES = ['image/vnd.dxf', 'image/x-dxf', 'application/dxf', 'application/x-dxf'] as const

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

export function isDrawingRenditionSource(file: { contentType?: string | null; filename?: string | null }): boolean {
  return matchesTypeOrExtension(file, drawingTypes, drawingExtensions)
}

export function storedContentType(file: { name: string; type: string }): string | null {
  if (isDrawingRenditionSource({ filename: file.name })) return 'application/dxf'
  return file.type || null
}

export function isRenditionSource(file: { contentType?: string | null; filename?: string | null }): boolean {
  return isOfficeRenditionSource(file) || isDrawingRenditionSource(file)
}

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

export function isIndexedFromRendition(filename: string | null | undefined): boolean {
  const name = filename?.trim().toLowerCase() ?? ''
  const dot = name.lastIndexOf('.')
  return dot >= 0 && renditionIndexedExtensions.has(name.slice(dot))
}
