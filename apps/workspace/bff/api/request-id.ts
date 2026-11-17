import { randomUUID } from 'node:crypto'
import { REQUEST_ID_HEADER } from '@/shared/utils/request-id'

export { REQUEST_ID_HEADER, shortRequestId } from '@/shared/utils/request-id'

const INBOUND_HEADERS = [REQUEST_ID_HEADER, 'x-correlation-id'] as const

const SAFE_ID = /^[A-Za-z0-9._-]{8,128}$/

const minted = new WeakMap<Request, string>()

function inboundRequestId(request: Request): string | null {
  for (const header of INBOUND_HEADERS) {
    const value = request.headers.get(header)
    if (value && SAFE_ID.test(value)) return value
  }
  return null
}

export function resolveRequestId(request: Request): string {
  const existing = minted.get(request)
  if (existing) return existing
  const id = inboundRequestId(request) ?? randomUUID()
  minted.set(request, id)
  return id
}
