export function isRedirectSignal(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('digest' in error)) return false
  const { digest } = error
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT;')
}
