export interface BackoffOptions {
  baseMs: number
  maxMs: number
  factor?: number
  random?: () => number
}

export function applyJitter(delayMs: number, random: () => number = Math.random): number {
  const half = delayMs / 2
  return Math.round(half + random() * half)
}

export function backoffWithJitter(
  attempt: number,
  { baseMs, maxMs, factor = 2, random = Math.random }: BackoffOptions
): number {
  const exponential = Math.min(maxMs, baseMs * factor ** Math.max(0, attempt))
  return applyJitter(exponential, random)
}

export interface RetryLadder {
  schedule(attempt: () => void): boolean
  reset(): void
  cancel(): void
  readonly spent: boolean
}

export type RetryLadderOptions =
  | { delaysMs: readonly number[] }
  | (BackoffOptions & { budget?: number })

export function createRetryLadder(options: RetryLadderOptions): RetryLadder {
  let attempts = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  const hasRung = (index: number): boolean =>
    'delaysMs' in options
      ? options.delaysMs[index] !== undefined
      : options.budget === undefined || index < options.budget

  const delayFor = (index: number): number | null => {
    if (!hasRung(index)) return null
    if ('delaysMs' in options) return options.delaysMs[index]
    return backoffWithJitter(index, options)
  }

  const cancel = (): void => {
    if (timer === null) return
    clearTimeout(timer)
    timer = null
  }

  return {
    schedule(attempt) {
      const delay = delayFor(attempts)
      if (delay === null) return false
      attempts += 1
      cancel()
      timer = setTimeout(() => {
        timer = null
        attempt()
      }, delay)
      return true
    },
    reset() {
      attempts = 0
      cancel()
    },
    cancel,
    get spent() {
      return !hasRung(attempts)
    },
  }
}
