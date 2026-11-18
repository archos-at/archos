'use strict'

if (process.env.NODE_ENV === 'production') {
  throw new Error('workos-redirect: refusing to load with NODE_ENV=production (local stack only)')
}
const target = process.env.LOCAL_STACK_WORKOS_ORIGIN
if (!target) throw new Error('workos-redirect: LOCAL_STACK_WORKOS_ORIGIN is not set')

const REAL = 'https://api.workos.com'
const realFetch = globalThis.fetch

globalThis.fetch = function fetchThroughLocalWorkos(input, init) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input && input.url
  if (typeof url === 'string' && url.startsWith(REAL)) {
    const next = target + url.slice(REAL.length)
    const rewritten = typeof input === 'string' || input instanceof URL ? next : new Request(next, input)
    return realFetch.call(this, rewritten, init)
  }
  return realFetch.call(this, input, init)
}
