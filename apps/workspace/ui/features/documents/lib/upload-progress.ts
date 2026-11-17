import type { TrackedFile } from '../types'

export type UploadPhase = 'queued' | 'uploading' | 'processing' | 'ready' | 'held' | 'stored' | 'failed' | 'canceled'

export type TransferStage = 'transferring' | 'processing' | 'settled'

export type ProgressFile = Pick<
  TrackedFile,
  'id' | 'fileName' | 'fileSize' | 'status' | 'progress' | 'bytesUploaded' | 'uploadStartedAt' | 'errorMessage'
>

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

export function uploadPhase(file: ProgressFile): UploadPhase {
  switch (file.status) {
    case 'failed':
      return 'failed'
    case 'canceled':
      return 'canceled'
    case 'success':
      return 'ready'
    case 'held':
      return 'held'
    case 'stored':
      return 'stored'
    case 'uploading':
      return file.uploadStartedAt ? 'uploading' : 'queued'
    case 'ingesting':
    case 'deleting':
      return 'processing'
  }
}

export function isDeterminate(phase: UploadPhase): boolean {
  return phase === 'uploading'
}

export function isTerminal(phase: UploadPhase): boolean {
  return phase === 'ready' || phase === 'held' || phase === 'stored' || phase === 'failed' || phase === 'canceled'
}

export function uploadPercent(file: ProgressFile): number | null {
  if (!isDeterminate(uploadPhase(file))) return null
  if (!file.fileSize || file.fileSize <= 0) return null
  return clamp(Math.round(((file.bytesUploaded ?? 0) / file.fileSize) * 100), 0, 100)
}

export function uploadedBytes(file: ProgressFile): number {
  const phase = uploadPhase(file)
  if (phase === 'processing' || phase === 'ready' || phase === 'held' || phase === 'stored') return file.fileSize
  return clamp(file.bytesUploaded ?? 0, 0, file.fileSize)
}

export interface TransferSummary {
  total: number
  queued: number
  uploading: number
  processing: number
  ready: number
  held: number
  stored: number
  failed: number
  canceled: number
  totalBytes: number
  uploadedBytes: number
  remainingBytes: number
  bytesPercent: number | null
  settled: number
  stage: TransferStage
  isSettled: boolean
}

export function summarizeTransfer(files: readonly ProgressFile[]): TransferSummary {
  const summary: TransferSummary = {
    total: files.length,
    queued: 0,
    uploading: 0,
    processing: 0,
    ready: 0,
    held: 0,
    stored: 0,
    failed: 0,
    canceled: 0,
    totalBytes: 0,
    uploadedBytes: 0,
    remainingBytes: 0,
    bytesPercent: null,
    settled: 0,
    stage: 'settled',
    isSettled: true,
  }

  for (const file of files) {
    const phase = uploadPhase(file)
    summary[phase] += 1
    if (isTerminal(phase)) summary.settled += 1
    if (phase === 'canceled') continue
    summary.totalBytes += file.fileSize
    summary.uploadedBytes += uploadedBytes(file)
  }

  summary.remainingBytes = Math.max(0, summary.totalBytes - summary.uploadedBytes)
  summary.bytesPercent =
    summary.totalBytes > 0 ? clamp(Math.round((summary.uploadedBytes / summary.totalBytes) * 100), 0, 100) : null

  if (summary.queued > 0 || summary.uploading > 0) summary.stage = 'transferring'
  else if (summary.processing > 0) summary.stage = 'processing'
  else summary.stage = 'settled'

  summary.isSettled = summary.stage === 'settled'
  return summary
}

const MIN_PROGRESS_STEP_BYTES = 64 * 1024

export function shouldEmitProgress(previous: number, next: number, total: number): boolean {
  if (next <= previous) return false
  if (next >= total) return true
  return next - previous >= Math.max(MIN_PROGRESS_STEP_BYTES, Math.floor(total / 100))
}

export class TransferRateEstimator {
  private samples: Array<{ at: number; bytes: number }> = []

  constructor(private readonly windowMs: number = 6_000) {}

  reset(): void {
    this.samples = []
  }

  sample(bytes: number, now: number): void {
    const last = this.samples[this.samples.length - 1]
    if (last && bytes < last.bytes) this.reset()
    this.samples.push({ at: now, bytes })
    const cutoff = now - this.windowMs
    while (this.samples.length > 2 && this.samples[1].at < cutoff) this.samples.shift()
  }

  bytesPerSecond(): number | null {
    if (this.samples.length < 2) return null
    const first = this.samples[0]
    const last = this.samples[this.samples.length - 1]
    const elapsedMs = last.at - first.at
    if (elapsedMs < 400) return null
    const delta = last.bytes - first.bytes
    if (delta <= 0) return null
    return (delta / elapsedMs) * 1000
  }

  etaSeconds(remainingBytes: number): number | null {
    const rate = this.bytesPerSecond()
    if (rate === null || rate <= 0) return null
    if (remainingBytes <= 0) return 0
    return remainingBytes / rate
  }
}
