import { z } from 'zod'

export const ANNOTATION_EXPORT_FORMATS = ['pdf', 'docx', 'md'] as const
export type AnnotationExportFormat = (typeof ANNOTATION_EXPORT_FORMATS)[number]

export const ANNOTATION_EXPORT_SCOPES = ['open', 'all'] as const
export type AnnotationExportScope = (typeof ANNOTATION_EXPORT_SCOPES)[number]

export const ANNOTATION_EXPORT_REVISIONS = ['current', 'all'] as const
export type AnnotationExportRevision = (typeof ANNOTATION_EXPORT_REVISIONS)[number]

export const annotationExportQuerySchema = z
  .object({
    format: z.enum(ANNOTATION_EXPORT_FORMATS).default('pdf'),
    scope: z.enum(ANNOTATION_EXPORT_SCOPES).default('open'),
    revision: z.enum(ANNOTATION_EXPORT_REVISIONS).optional(),
    fassung: z.enum(ANNOTATION_EXPORT_REVISIONS).optional(),
    includeProposals: z
      .enum(['0', '1'])
      .default('0')
      .transform((value) => value === '1'),
  })
  .transform(({ fassung, revision, ...rest }) => ({ ...rest, revision: revision ?? fassung ?? 'current' }))

export interface AnnotationExportOptions {
  format: AnnotationExportFormat
  scope: AnnotationExportScope
  revision: AnnotationExportRevision
  includeProposals: boolean
}

export function annotationExportHref(documentId: string, options: AnnotationExportOptions): string {
  const query = new URLSearchParams({
    format: options.format,
    scope: options.scope,
    revision: options.revision,
  })
  if (options.includeProposals) query.set('includeProposals', '1')
  return `/api/documents/${encodeURIComponent(documentId)}/annotations/export?${query.toString()}`
}

const EXTENSIONS: Record<AnnotationExportFormat, string> = { pdf: 'pdf', docx: 'docx', md: 'md' }

const UNSAFE_IN_FILE_NAME = /[\\/:*?"<>|\r\n]+/g

export const safeFileStem = (stem: string): string => stem.replace(UNSAFE_IN_FILE_NAME, ' ').trim()

export const protocolFileNameOf = (stem: string, format: AnnotationExportFormat): string =>
  `${safeFileStem(stem)}.${EXTENSIONS[format]}`
