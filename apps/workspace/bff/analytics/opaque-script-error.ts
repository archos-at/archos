const OPAQUE_MESSAGE = /^Script error\.?$/

interface ExceptionEntry {
  value?: unknown
  stacktrace?: { frames?: unknown[] } | null
}

interface ExceptionEventProperties {
  $exception_list?: ExceptionEntry[]
}

const isOpaque = (entry: ExceptionEntry | undefined): boolean =>
  typeof entry?.value === 'string' &&
  OPAQUE_MESSAGE.test(entry.value) &&
  (entry.stacktrace?.frames?.length ?? 0) === 0

export function isOpaqueScriptErrorEvent(
  event: string,
  properties: ExceptionEventProperties | undefined
): boolean {
  if (event !== '$exception') return false
  const entries = properties?.$exception_list ?? []
  return entries.length > 0 && entries.every(isOpaque)
}
