'use client'

import { runWithConcurrency } from './upload-queue'

const ALGORITHM = 'sha256'

const DIGEST_CONCURRENCY = 2

export async function digestFile(file: File): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return null
  try {
    const buffer = await file.arrayBuffer()
    const digest = await subtle.digest('SHA-256', buffer)
    const hex = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
    return `${ALGORITHM}:${hex}`
  } catch {
    return null
  }
}

export async function digestFiles(files: readonly File[]): Promise<Map<File, string>> {
  const digests = new Map<File, string>()
  if (files.length === 0) return digests
  const results = await runWithConcurrency(files, DIGEST_CONCURRENCY, (file) => digestFile(file))
  results.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value) digests.set(files[index], result.value)
  })
  return digests
}
