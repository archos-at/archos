const LOG_PREFIX = '[SessionsStore]'

const getTimestamp = (): string => new Date().toISOString()

export const logStorageWrite = (conversationId: string, chars: number): void => {
  if (process.env.NODE_ENV !== 'development') return

  console.debug(`${LOG_PREFIX} localStorage write: ${conversationId}, ${Math.round(chars / 1024)}K chars`, {
    conversationId,
    chars,
    timestamp: getTimestamp(),
  })
}

export const logStorageEviction = (conversationId: string, chars: number): void => {
  console.warn(`${LOG_PREFIX} Evicted the stored messages of ${conversationId} to make room; the server holds them`, {
    conversationId,
    chars,
    timestamp: getTimestamp(),
  })
}

export const logStorageFailure = (key: string, chars: number, error: unknown): void => {
  console.error(`${LOG_PREFIX} Could not store ${key}: nothing left to evict`, {
    key,
    chars,
    timestamp: getTimestamp(),
    error: error instanceof Error ? error.message : String(error),
  })
}

export const logStorageMigration = (conversationCount: number): void => {
  if (process.env.NODE_ENV !== 'development') return

  console.debug(`${LOG_PREFIX} Dropped the cached messages of ${conversationCount} conversations (older shape)`, {
    timestamp: getTimestamp(),
  })
}

export const logExternalStorageEvent = (
  key: string | null,
  oldValue: string | null,
  newValue: string | null
): void => {
  if (process.env.NODE_ENV !== 'development') return

  console.warn(`${LOG_PREFIX} 🔍 Storage event detected: external modification`, {
    key,
    cleared: oldValue !== null && newValue === null,
    modified: oldValue !== null && newValue !== null,
    timestamp: getTimestamp(),
  })
}

export const logStoreHydration = (
  success: boolean,
  sessionCount: number,
  userId: string | null
): void => {
  if (process.env.NODE_ENV !== 'development') return

  if (success) {
    console.debug(`${LOG_PREFIX} Store hydrated from localStorage: ${sessionCount} sessions`, {
      userId,
      timestamp: getTimestamp(),
    })
  } else {
    console.warn(`${LOG_PREFIX} Store hydration failed - starting with empty state`, {
      timestamp: getTimestamp(),
    })
  }
}

export const logStorageAvailability = (available: boolean): void => {
  if (process.env.NODE_ENV !== 'development') return

  if (!available) {
    console.warn(`${LOG_PREFIX} localStorage not available - persistence disabled`, {
      timestamp: getTimestamp(),
    })
  }
}
