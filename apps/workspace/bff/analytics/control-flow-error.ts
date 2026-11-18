const CONTROL_FLOW_MARKERS = ['NEXT_REDIRECT', 'NEXT_NOT_FOUND', 'NEXT_HTTP_ERROR_FALLBACK'] as const

const isMarker = (text: unknown): boolean =>
  typeof text === 'string' &&
  CONTROL_FLOW_MARKERS.some((marker) => text === marker || text.startsWith(`${marker};`))

export function isFrameworkControlFlow(error: unknown): boolean {
  if (typeof error === 'string') return isMarker(error)
  if (typeof error !== 'object' || error === null) return false
  const { digest, message } = error as { digest?: unknown; message?: unknown }
  return isMarker(digest) || isMarker(message)
}

interface ExceptionEventProperties {
  $exception_list?: Array<{ value?: unknown }>
  $exception_message?: unknown
}

export function isControlFlowExceptionEvent(
  event: string,
  properties: ExceptionEventProperties | undefined
): boolean {
  if (event !== '$exception' || !properties) return false
  if (isMarker(properties.$exception_message)) return true
  return (properties.$exception_list ?? []).some((entry) => isMarker(entry?.value))
}
