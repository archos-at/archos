import type { MailImportList, MailImportUploadPlan, MailImportView } from './types'

const PARALLEL_PARTS = 3
const PART_RETRY_BUDGET_MS = 15 * 60_000
const MAX_RETRY_DELAY_MS = 30_000

export class MailImportRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message)
    this.name = 'MailImportRequestError'
  }
}

function base(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/mail-imports`
}

export async function fetchMailImports(projectId: string, signal?: AbortSignal): Promise<MailImportList> {
  return json(await fetch(base(projectId), { credentials: 'same-origin', signal }))
}

export async function startMailImport(projectId: string, file: File): Promise<MailImportUploadPlan> {
  return json(
    await fetch(base(projectId), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.name, sizeBytes: file.size }),
    }),
  )
}

export async function resumeMailImport(projectId: string, importId: string): Promise<MailImportUploadPlan> {
  return json(await fetch(`${base(projectId)}/${encodeURIComponent(importId)}`, { credentials: 'same-origin' }))
}

export async function cancelMailImport(projectId: string, importId: string): Promise<MailImportView> {
  return json(
    await fetch(`${base(projectId)}/${encodeURIComponent(importId)}`, { method: 'DELETE', credentials: 'same-origin' }),
  )
}

export interface SendProgress {
  sentBytes: number
  totalBytes: number
  phase: 'sending' | 'joining'
}

export async function sendMailArchive(
  projectId: string,
  plan: MailImportUploadPlan,
  file: File,
  onProgress: (progress: SendProgress) => void,
  signal?: AbortSignal,
): Promise<MailImportView> {
  const importId = plan.import.id
  const held = new Set(plan.uploadedParts)
  const pending = Array.from({ length: plan.partCount }, (_, i) => i + 1).filter((n) => !held.has(n))
  let sentBytes = [...held].reduce((sum, n) => sum + partBlob(file, plan.partSize, n).size, 0)
  onProgress({ sentBytes, totalBytes: file.size, phase: 'sending' })

  const stop = new AbortController()
  const parts = signal ? anySignal([signal, stop.signal]) : stop.signal
  const next = () => (parts.aborted ? undefined : pending.shift())
  const worker = async (): Promise<void> => {
    for (let part = next(); part !== undefined; part = next()) {
      const blob = partBlob(file, plan.partSize, part)
      await sendPart(`${base(projectId)}/${encodeURIComponent(importId)}/parts/${part}`, blob, parts)
      sentBytes += blob.size
      onProgress({ sentBytes, totalBytes: file.size, phase: 'sending' })
    }
  }
  try {
    await Promise.all(Array.from({ length: PARALLEL_PARTS }, worker))
  } catch (error) {
    stop.abort()
    throw error
  }

  onProgress({ sentBytes, totalBytes: file.size, phase: 'joining' })
  return json(
    await fetch(`${base(projectId)}/${encodeURIComponent(importId)}/complete`, {
      method: 'POST',
      credentials: 'same-origin',
      signal,
    }),
  )
}

function partBlob(file: File, partSize: number, partNumber: number): Blob {
  const start = (partNumber - 1) * partSize
  return file.slice(start, Math.min(file.size, start + partSize))
}

async function sendPart(url: string, blob: Blob, signal?: AbortSignal): Promise<void> {
  const giveUpAt = Date.now() + PART_RETRY_BUDGET_MS
  for (let attempt = 1; ; attempt += 1) {
    await whileOffline(signal)
    const response = await fetch(url, { method: 'PUT', credentials: 'same-origin', body: blob, signal }).catch(
      (error: unknown) => {
        if (signal?.aborted) throw error
        return null
      },
    )
    if (response?.ok) return
    if (response && response.status !== 429 && response.status < 500) await json(response)
    const delay = retryDelayMs(response, attempt)
    if (Date.now() + delay > giveUpAt) {
      throw new MailImportRequestError('A part of the archive could not be sent.', response?.status ?? 0, 'PART_FAILED')
    }
    await wait(delay, signal)
  }
}

function retryDelayMs(response: Response | null, attempt: number): number {
  const header = Number(response?.headers.get('Retry-After'))
  if (Number.isFinite(header) && header > 0) return header * 1000
  return Math.min(MAX_RETRY_DELAY_MS, 1000 * 2 ** (attempt - 1))
}

function whileOffline(signal?: AbortSignal): Promise<void> {
  if (typeof navigator === 'undefined' || typeof window === 'undefined' || navigator.onLine !== false) {
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    const done = () => {
      window.removeEventListener('online', done)
      signal?.removeEventListener('abort', aborted)
      resolve()
    }
    const aborted = () => {
      window.removeEventListener('online', done)
      reject(signal?.reason)
    }
    window.addEventListener('online', done)
    signal?.addEventListener('abort', aborted, { once: true })
  })
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals)
  const combined = new AbortController()
  for (const each of signals) {
    if (each.aborted) {
      combined.abort(each.reason)
      break
    }
    each.addEventListener('abort', () => combined.abort(each.reason), { once: true })
  }
  return combined.signal
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}

async function json<T>(response: Response): Promise<T> {
  if (response.ok) return (await response.json()) as T
  const body = (await response.json().catch(() => null)) as { error?: string; code?: string } | null
  throw new MailImportRequestError(body?.error ?? `Request failed (${response.status})`, response.status, body?.code ?? null)
}
