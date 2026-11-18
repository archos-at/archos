export function startBrowserDownload(url: string, filename?: string): void {
  if (typeof document === 'undefined' || url === '') return
  const anchor = document.createElement('a')
  anchor.href = url
  if (filename) anchor.download = filename
  anchor.rel = 'noopener'
  anchor.target = '_blank'
  anchor.referrerPolicy = 'no-referrer'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

export function fileNameFromDisposition(header: string | null, fallback: string): string {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header ?? '')?.[1]
  if (encoded) {
    try {
      return decodeURIComponent(encoded)
    } catch {
      // A malformed escape: the plain name below still names the file.
    }
  }
  return /filename="([^"]+)"/i.exec(header ?? '')?.[1] ?? fallback
}

export type FetchedDownload = { saved: true } | { saved: false; status: number | null; reason: string | null }

export async function downloadFetched(href: string, fallbackName: string, init?: RequestInit): Promise<FetchedDownload> {
  try {
    const response = await (init ? fetch(href, init) : fetch(href))
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { details?: { reason?: unknown } } | null
      const reason = body?.details?.reason
      return { saved: false, status: response.status, reason: typeof reason === 'string' ? reason : null }
    }
    const url = URL.createObjectURL(await response.blob())
    try {
      startBrowserDownload(url, fileNameFromDisposition(response.headers.get('content-disposition'), fallbackName))
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
    return { saved: true }
  } catch {
    return { saved: false, status: null, reason: null }
  }
}
