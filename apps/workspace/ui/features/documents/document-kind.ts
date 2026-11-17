import type {
  OFFICE_RENDITION_CONTENT_TYPES,
  OFFICE_RENDITION_EXTENSIONS,
} from '@/lib/documents/preview-types'

export type DocumentKind =
  | 'floorplan'
  | 'section'
  | 'siteplan'
  | 'notice'
  | 'photo'
  | 'model'
  | 'sheet'
  | 'text'
  | 'document'

const TAG_KIND: Record<string, DocumentKind> = {
  grundriss: 'floorplan',
  schnitt: 'section',
  ansicht: 'section',
  bebauungsplan: 'siteplan',
  'flächenwidmungsplan': 'siteplan',
  lageplan: 'siteplan',
  bescheid: 'notice',
  foto: 'photo',
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|heic|heif|tiff?|bmp|svg)$/
const IFC_EXT = /\.(ifc|ifczip)$/

const SHEET_EXT = /\.(csv|tsv|xlsx?|xlsm|ods|numbers)$/
const TEXT_EXT = /\.(md|markdown|mdx|txt|log|rst|adoc)$/
const SHEET_TYPES = [
  'text/csv',
  'text/tab-separated-values',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.spreadsheet',
]
const TEXT_TYPES = ['text/markdown', 'text/x-markdown', 'text/plain']

export interface DocumentKindInput {
  filename: string
  contentType?: string | null
  tags?: string[] | null
}

export function inferDocumentKind({ filename, contentType, tags }: DocumentKindInput): DocumentKind {
  const lowerName = filename.toLowerCase()
  const lowerType = (contentType ?? '').toLowerCase()

  if (IFC_EXT.test(lowerName)) return 'model'
  if (SHEET_EXT.test(lowerName) || SHEET_TYPES.includes(lowerType)) return 'sheet'
  if (TEXT_EXT.test(lowerName) || TEXT_TYPES.includes(lowerType)) return 'text'

  for (const tag of tags ?? []) {
    const kind = TAG_KIND[tag.toLowerCase()]
    if (kind) return kind
  }

  if (lowerType.startsWith('image/')) return scannedKindFromName(lowerName) ?? 'photo'

  const name = lowerName
  if (/lageplan|bebauungsplan|fl(ä|ae)chenwidmung|site.?plan/.test(name)) return 'siteplan'
  if (/schnitt|ansicht/.test(name)) return 'section'
  if (/grundriss|grundriß|floor.?plan|plan/.test(name)) return 'floorplan'
  if (/bescheid|genehmigung|permit/.test(name)) return 'notice'
  if (IMAGE_EXT.test(name) || /foto|photo/.test(name)) return 'photo'

  return 'document'
}

function scannedKindFromName(name: string): DocumentKind | null {
  if (/lageplan|bebauungsplan|fl(ä|ae)chenwidmung|site.?plan/.test(name)) return 'siteplan'
  if (/schnitt|ansicht/.test(name)) return 'section'
  if (/grundriss|grundriß|floor.?plan/.test(name)) return 'floorplan'
  if (/bescheid/.test(name)) return 'notice'
  return null
}

export function fileExtensionLabel(filename: string): string {
  const match = /\.([a-z0-9]{1,5})$/i.exec(filename.trim())
  return match ? match[1].toUpperCase() : ''
}

export interface ExtChipTint {
  background: string
  color: string
}

const NEUTRAL: ExtChipTint = {
  background: 'var(--source-auto-tint, var(--muted))',
  color: 'var(--source-auto-text, var(--muted-foreground))',
}

export function extChipTint(_extLabel: string): ExtChipTint {
  return NEUTRAL
}

export type FileFormatKey =
  | 'pdf'
  | 'word'
  | 'excel'
  | 'powerpoint'
  | 'odText'
  | 'odSpreadsheet'
  | 'odPresentation'
  | 'rtf'
  | 'csv'
  | 'tsv'
  | 'markdown'
  | 'plainText'
  | 'ifc'
  | 'dxf'
  | 'email'
  | 'image'
  | 'extension'
  | 'raw'

export interface FileFormatMessage {
  key: FileFormatKey
  values?: Record<string, string>
}

type OfficeContentType = (typeof OFFICE_RENDITION_CONTENT_TYPES)[number]
type OfficeExtension = (typeof OFFICE_RENDITION_EXTENSIONS)[number]
type NamedFormat = Exclude<FileFormatKey, 'image' | 'extension' | 'raw'>

const OFFICE_TYPE_FORMAT: Record<OfficeContentType, NamedFormat> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'word',
  'application/vnd.ms-word.document.macroenabled.12': 'word',
  'application/msword': 'word',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'excel',
  'application/vnd.ms-excel.sheet.macroenabled.12': 'excel',
  'application/vnd.ms-excel': 'excel',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'powerpoint',
  'application/vnd.ms-powerpoint.presentation.macroenabled.12': 'powerpoint',
  'application/vnd.ms-powerpoint': 'powerpoint',
  'application/vnd.oasis.opendocument.text': 'odText',
  'application/vnd.oasis.opendocument.spreadsheet': 'odSpreadsheet',
  'application/vnd.oasis.opendocument.presentation': 'odPresentation',
  'application/rtf': 'rtf',
  'text/rtf': 'rtf',
}

const TYPE_FORMAT: Record<string, NamedFormat> = {
  ...OFFICE_TYPE_FORMAT,
  'application/pdf': 'pdf',
  'text/csv': 'csv',
  'text/tab-separated-values': 'tsv',
  'text/markdown': 'markdown',
  'text/x-markdown': 'markdown',
  'text/plain': 'plainText',
  'application/x-step': 'ifc',
  'application/ifc': 'ifc',
  'model/ifc': 'ifc',
  'application/dxf': 'dxf',
  'image/vnd.dxf': 'dxf',
  'message/rfc822': 'email',
  'application/vnd.ms-outlook': 'email',
}

const OFFICE_EXT_FORMAT: Record<OfficeExtension, NamedFormat> = {
  '.docx': 'word',
  '.docm': 'word',
  '.doc': 'word',
  '.xlsx': 'excel',
  '.xlsm': 'excel',
  '.xls': 'excel',
  '.pptx': 'powerpoint',
  '.pptm': 'powerpoint',
  '.ppt': 'powerpoint',
  '.odt': 'odText',
  '.ods': 'odSpreadsheet',
  '.odp': 'odPresentation',
  '.rtf': 'rtf',
}

const EXT_FORMAT: Record<string, NamedFormat> = {
  ...OFFICE_EXT_FORMAT,
  '.pdf': 'pdf',
  '.csv': 'csv',
  '.tsv': 'tsv',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.txt': 'plainText',
  '.ifc': 'ifc',
  '.ifczip': 'ifc',
  '.dxf': 'dxf',
  '.eml': 'email',
  '.msg': 'email',
}

const IMAGE_SUBTYPE_LABEL: Record<string, string> = { jpg: 'JPEG', 'svg+xml': 'SVG', tif: 'TIFF' }

const imageSubtypeLabel = (subtype: string): string =>
  IMAGE_SUBTYPE_LABEL[subtype] ?? subtype.split('+', 1)[0].toUpperCase()

export function fileFormatMessage(file: {
  filename?: string | null
  contentType?: string | null
}): FileFormatMessage | null {
  const rawType = file.contentType?.trim() ?? ''
  const type = rawType.split(';', 1)[0].trim().toLowerCase()
  const name = file.filename?.trim().toLowerCase() ?? ''
  const dot = name.lastIndexOf('.')
  const ext = dot >= 0 ? name.slice(dot) : ''

  const byExt = EXT_FORMAT[ext]
  if (byExt) return { key: byExt }
  const byType = TYPE_FORMAT[type]
  if (byType) return { key: byType }
  if (IMAGE_EXT.test(name)) return { key: 'image', values: { format: imageSubtypeLabel(ext.slice(1)) } }
  if (type.startsWith('image/')) return { key: 'image', values: { format: imageSubtypeLabel(type.slice(6)) } }
  const extLabel = fileExtensionLabel(file.filename ?? '')
  if (extLabel) return { key: 'extension', values: { ext: extLabel } }
  if (rawType) return { key: 'raw', values: { type: rawType } }
  return null
}
