import { startBrowserDownload } from '@/lib/browser-download'

export async function startDocumentDownload(
  documentId: string,
  fallbackName?: string,
  options: { format?: 'pdf' } = {}
): Promise<boolean> {
  try {
    const query = options.format === 'pdf' ? '?format=pdf' : ''
    const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}/download${query}`)
    const data = response.ok ? await response.json() : null
    const url = typeof data?.downloadUrl === 'string' ? data.downloadUrl : ''
    if (!url) return false
    const named =
      typeof data?.filename === 'string' && data.filename !== '' ? data.filename : fallbackName
    startBrowserDownload(url, named)
    return true
  } catch {
    return false
  }
}
