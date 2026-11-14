import { capturePosthog } from '@/lib/analytics/posthog'

/**
 * `document_uploaded` for one browser batch: how many, which types, and which
 * shelf. Counts and extensions only; no name leaves the browser. The server
 * sends one per file with `source` web, mail or chat (`announceDocumentUploaded`),
 * so this one says `web_batch`.
 */
export const captureUploadBatch = (uploadedTypes: string[], shelf: string): void =>
  capturePosthog('document_uploaded', {
    count: uploadedTypes.length,
    source: 'web_batch',
    file_count: uploadedTypes.length,
    types: [...new Set(uploadedTypes)].sort().join(','),
    shelf,
  })
