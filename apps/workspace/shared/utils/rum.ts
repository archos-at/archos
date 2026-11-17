interface RumApi {
  addError?: (error: Error, context: Record<string, unknown>) => void
  addAction?: (name: string, context: Record<string, unknown>) => void
}

export const trackRumError = (message: string, context: Record<string, unknown> = {}): void => {
  if (typeof window === 'undefined') return
  const ddRum = (window as unknown as Record<string, unknown>).DD_RUM as RumApi | undefined
  ddRum?.addError?.(new Error(message), { source: 'custom', ...context })
}

export const trackRumAction = (name: string, context: Record<string, unknown> = {}): void => {
  if (typeof window === 'undefined') return
  const ddRum = (window as unknown as Record<string, unknown>).DD_RUM as RumApi | undefined
  ddRum?.addAction?.(name, context)
}

const EXPECTED_AUTH_CODES = new Set(['token_missing', 'token_expired', 'session_refresh_failed'])

export const trackAuthEvent = (code: string, context: Record<string, unknown> = {}): void => {
  const enriched = { auth_error_code: code, ...context }
  if (EXPECTED_AUTH_CODES.has(code)) {
    trackRumAction(`Auth: ${code}`, enriched)
  } else {
    trackRumError(`Auth: ${code}`, enriched)
  }
}
