export const UPLOAD_CONCURRENCY = 3

export async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<Array<PromiseSettledResult<R>>> {
  const results = new Array<PromiseSettledResult<R>>(items.length)
  let cursor = 0

  const runner = async (): Promise<void> => {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      try {
        results[index] = { status: 'fulfilled', value: await worker(items[index], index) }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }

  const runners = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: runners }, runner))
  return results
}

export const RATE_LIMIT_RETRIES = 3

export async function sendWaitingOutRateLimit<T>(
  send: () => Promise<T>,
  retryAfterOf: (error: unknown) => number | null,
  signal?: AbortSignal
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await send()
    } catch (error) {
      const wait = retryAfterOf(error)
      if (wait === null || attempt >= RATE_LIMIT_RETRIES) throw error
      await abortableDelay(wait * 1000, signal)
    }
  }
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Upload aborted', 'AbortError'))
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Upload aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
