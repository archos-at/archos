// Sends every request for https://api.workos.com to the local test double
// (fake-workos.mjs). Loaded into the UI's Node processes with
// NODE_OPTIONS=--require by local-stack.sh, never anywhere else.
//
// Why a preload: AuthKit honours WORKOS_API_HOSTNAME / WORKOS_API_HTTPS /
// WORKOS_API_PORT, but the BFF's own client (apps/workspace/bff/workos/client.ts)
// is built with no hostname, so the WorkOS SDK sends it to api.workos.com.
// Passing the hostname there would make this file unnecessary.
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
