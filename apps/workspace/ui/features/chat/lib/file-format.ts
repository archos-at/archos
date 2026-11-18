import { draftFileType, type DraftFileFormat } from '@/lib/conversations/draft-media'

const FORMATS: ReadonlySet<DraftFileFormat> = new Set([
  'word',
  'excel',
  'powerpoint',
  'pdf',
  'image',
  'csv',
  'markdown',
  'text',
])

export const formatOfExtension = (extension: string): DraftFileFormat => {
  const format = draftFileType(`x.${extension.trim().toLowerCase()}`).format
  return FORMATS.has(format) ? format : 'text'
}

export const fileFormatNoun = (extension: string, t: (key: string) => string): string =>
  t(`thinking.files.format.${formatOfExtension(extension)}`)

export const formatOfFile = (name: string): DraftFileFormat =>
  formatOfExtension(name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '')
