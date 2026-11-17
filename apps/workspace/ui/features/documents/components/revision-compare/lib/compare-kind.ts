import { isRenditionSource } from '@/lib/documents/preview-types'

export type CompareKind = 'pdf' | 'office' | 'image' | 'unsupported'

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'])

export function compareKindOf(filename: string): CompareKind {
  const name = filename.trim().toLowerCase()
  const dot = name.lastIndexOf('.')
  const extension = dot >= 0 ? name.slice(dot) : ''
  if (extension === '.pdf') return 'pdf'
  if (IMAGE_EXTENSIONS.has(extension)) return 'image'
  if (isRenditionSource({ filename })) return 'office'
  return 'unsupported'
}
