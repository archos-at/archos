export type DraftFileFormat = 'word' | 'excel' | 'powerpoint' | 'pdf' | 'image' | 'csv' | 'markdown' | 'text'

export type DraftPreviewKind = 'office' | 'pdf' | 'image' | 'table' | 'text'

export type DraftFilingMode = 'file' | 'markdown' | 'refused'

export interface DraftFileType {
  extension: string
  contentType: string
  format: DraftFileFormat
  preview: DraftPreviewKind
  filing: DraftFilingMode
}

const TYPES: readonly DraftFileType[] = [
  {
    extension: 'docx',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    format: 'word',
    preview: 'office',
    filing: 'file',
  },
  {
    extension: 'xlsx',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    format: 'excel',
    preview: 'office',
    filing: 'file',
  },
  {
    extension: 'pptx',
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    format: 'powerpoint',
    preview: 'office',
    filing: 'file',
  },
  { extension: 'pdf', contentType: 'application/pdf', format: 'pdf', preview: 'pdf', filing: 'file' },
  { extension: 'png', contentType: 'image/png', format: 'image', preview: 'image', filing: 'file' },
  { extension: 'svg', contentType: 'image/svg+xml', format: 'image', preview: 'image', filing: 'file' },
  { extension: 'csv', contentType: 'text/csv', format: 'csv', preview: 'table', filing: 'refused' },
  { extension: 'md', contentType: 'text/markdown', format: 'markdown', preview: 'text', filing: 'markdown' },
  { extension: 'txt', contentType: 'text/plain', format: 'text', preview: 'text', filing: 'markdown' },
  { extension: 'json', contentType: 'application/json', format: 'text', preview: 'text', filing: 'refused' },
  { extension: 'html', contentType: 'text/plain', format: 'text', preview: 'text', filing: 'refused' },
  { extension: 'xml', contentType: 'text/plain', format: 'text', preview: 'text', filing: 'refused' },
]

const BY_EXTENSION: ReadonlyMap<string, DraftFileType> = new Map(TYPES.map((type) => [type.extension, type]))

const UNKNOWN: DraftFileType = {
  extension: '',
  contentType: 'application/octet-stream',
  format: 'text',
  preview: 'text',
  filing: 'refused',
}

export function filedExtension(type: DraftFileType): string {
  return type.filing === 'markdown' ? 'md' : type.extension
}

export function draftFileName(path: string): string {
  const trimmed = path.trim().replace(/\/+$/, '')
  return trimmed.slice(trimmed.lastIndexOf('/') + 1)
}

export function draftExtension(path: string): string {
  const name = draftFileName(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function draftFileType(path: string): DraftFileType {
  const extension = draftExtension(path)
  return BY_EXTENSION.get(extension) ?? { ...UNKNOWN, extension }
}

export function isMarkdownDraft(path: string, mediaType?: string | null): boolean {
  if (mediaType && mediaType !== 'text/markdown') return false
  const extension = draftExtension(path)
  return extension === 'md' || extension === ''
}
