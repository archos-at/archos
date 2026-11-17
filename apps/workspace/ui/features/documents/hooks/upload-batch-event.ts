import { capturePosthog } from '@/lib/analytics/posthog'

export const captureUploadBatch = (uploadedTypes: string[], shelf: string): void =>
  capturePosthog('document_uploaded', {
    count: uploadedTypes.length,
    source: 'web_batch',
    file_count: uploadedTypes.length,
    types: [...new Set(uploadedTypes)].sort().join(','),
    shelf,
  })
