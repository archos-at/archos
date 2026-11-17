export const getTokenExpiration = (token: string): number | undefined => {
  try {
    const payload = token.split('.')[1]
    if (!payload) return undefined

    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const json = typeof atob !== 'undefined' ? atob(base64) : Buffer.from(base64, 'base64').toString('utf8')
    const decoded = JSON.parse(json) as { exp?: unknown }

    return typeof decoded.exp === 'number' ? decoded.exp : undefined
  } catch {
    return undefined
  }
}
