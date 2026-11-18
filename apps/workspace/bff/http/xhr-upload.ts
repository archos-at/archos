import { applyJitter } from '@/shared/utils/backoff'

export class XhrUploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly responseText: string,
    readonly retryAfterSeconds: number | null = null
  ) {
    super(message)
    this.name = 'XhrUploadError'
  }
}

export type XhrNetworkFailure = 'network' | 'stalled' | 'timeout'

const NETWORK_MESSAGES: Record<XhrNetworkFailure, string> = {
  network: 'Upload failed: network error',
  stalled: 'Upload failed: the connection stalled',
  timeout: 'Upload failed: timed out',
}

export class XhrNetworkError extends Error {
  readonly retryable = true
  constructor(
    readonly reason: XhrNetworkFailure,
    readonly delivered = false
  ) {
    super(NETWORK_MESSAGES[reason])
    this.name = 'XhrNetworkError'
  }
}

export interface XhrUploadOptions {
  url: string
  body: FormData | Blob | ArrayBuffer | string
  method?: string
  headers?: Record<string, string>
  onProgress?: (loaded: number, total: number) => void
  signal?: AbortSignal
  timeoutMs?: number
  stallTimeoutMs?: number
  responseTimeoutMs?: number
  networkRetries?: number
  retryDelayMs?: (attempt: number) => number
}

export const DEFAULT_STALL_TIMEOUT_MS = 30_000
export const DEFAULT_NETWORK_RETRIES = 3
export const OFFLINE_WAIT_MS = 5 * 60_000

const defaultRetryDelay = (attempt: number): number =>
  applyJitter(Math.min(8_000, 1_000 * 2 ** attempt))

const abortError = (): DOMException => new DOMException('Upload aborted', 'AbortError')

export async function xhrUpload(options: XhrUploadOptions): Promise<string> {
  const retries = options.networkRetries ?? DEFAULT_NETWORK_RETRIES
  const delayOf = options.retryDelayMs ?? defaultRetryDelay
  for (let attempt = 0; ; attempt++) {
    try {
      return await sendOnce(options)
    } catch (error) {
      const resendable = error instanceof XhrNetworkError && error.reason !== 'timeout' && !error.delivered
      if (!resendable || attempt >= retries) throw error
      await waitToResend(delayOf(attempt), options.signal)
    }
  }
}

function waitToResend(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    let timer: ReturnType<typeof setTimeout> | null = null
    const finish = (settle: () => void) => {
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (typeof window !== 'undefined') window.removeEventListener('online', onOnline)
      settle()
    }
    const onAbort = () => finish(() => reject(abortError()))
    const onOnline = () => finish(resolve)
    signal?.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false
      if (!offline || typeof window === 'undefined') return finish(resolve)
      window.addEventListener('online', onOnline)
      timer = setTimeout(() => finish(resolve), OFFLINE_WAIT_MS)
    }, ms)
  })
}

function sendOnce(options: XhrUploadOptions): Promise<string> {
  const {
    url,
    body,
    method = 'POST',
    headers,
    onProgress,
    signal,
    timeoutMs = 0,
    stallTimeoutMs = DEFAULT_STALL_TIMEOUT_MS,
    responseTimeoutMs = 0,
  } = options

  return new Promise<string>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }

    const xhr = new XMLHttpRequest()
    xhr.open(method, url, true)

    for (const [name, value] of Object.entries(headers ?? {})) {
      xhr.setRequestHeader(name, value)
    }

    if (timeoutMs > 0) xhr.timeout = timeoutMs

    let stalled = false
    let watch: ReturnType<typeof setTimeout> | null = null
    const unwatch = () => {
      if (watch) clearTimeout(watch)
      watch = null
    }
    const watchFor = (ms: number) => {
      unwatch()
      if (ms <= 0) return
      watch = setTimeout(() => {
        watch = null
        stalled = true
        xhr.abort()
      }, ms)
    }

    const onAbort = () => xhr.abort()
    signal?.addEventListener('abort', onAbort, { once: true })

    const settle = (finish: () => void) => {
      unwatch()
      signal?.removeEventListener('abort', onAbort)
      finish()
    }

    let delivered = false
    const bodySent = () => {
      delivered = true
      watchFor(responseTimeoutMs)
    }

    xhr.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return watchFor(stallTimeoutMs)
      onProgress?.(event.loaded, event.total)
      if (event.loaded >= event.total) bodySent()
      else watchFor(stallTimeoutMs)
    })
    xhr.upload.addEventListener('load', bodySent)

    xhr.addEventListener('load', () => {
      settle(() => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.responseText)
        } else {
          const retryAfter = Number(xhr.getResponseHeader('Retry-After'))
          reject(
            new XhrUploadError(
              `Upload failed with status ${xhr.status}`,
              xhr.status,
              xhr.responseText,
              Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null
            )
          )
        }
      })
    })

    xhr.addEventListener('error', () => {
      settle(() => reject(new XhrNetworkError('network', delivered)))
    })

    xhr.addEventListener('timeout', () => {
      settle(() => reject(new XhrNetworkError('timeout', delivered)))
    })

    xhr.addEventListener('abort', () => {
      settle(() => reject(stalled ? new XhrNetworkError('stalled', delivered) : abortError()))
    })

    xhr.send(body)
    watchFor(stallTimeoutMs)
  })
}
