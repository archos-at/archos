import { A2A_VERSION_HEADER, formatSSEEvent, SSE_HEADERS } from '@a2a-js/sdk'
import { PRODUCT_NAME } from '@/lib/brand'

export const AGENT_DOOR_REFUSAL =
  PRODUCT_NAME + ' cannot ask ' + PRODUCT_NAME + ': the A2A door is for other agents, and a turn may not start another.'

export const PARSE_ERROR = -32700
export const VERSION_NOT_SUPPORTED = -32009

export function protocolVersionOf(request: Request): '1.0' | '0.3' | null {
  const header = request.headers.get(A2A_VERSION_HEADER)
  const raw = (header ?? new URL(request.url).searchParams.get(A2A_VERSION_HEADER) ?? '').trim()
  if (raw === '') return '0.3'
  const [major, minor = '0'] = raw.split('.')
  if (major === '1' && minor === '0') return '1.0'
  if (major === '0' && minor === '3') return '0.3'
  return null
}

export const jsonRpcErrorResponse = (code: number, message: string): Response =>
  Response.json({ jsonrpc: '2.0', id: null, error: { code, message } })

const isAsyncIterable = (value: unknown): value is AsyncGenerator<unknown, void, undefined> =>
  typeof value === 'object' && value !== null && Symbol.asyncIterator in value

export function jsonRpcResponse(result: unknown): Response {
  if (!isAsyncIterable(result)) return Response.json(result)
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await result.next()
        if (next.done) {
          controller.close()
          return
        }
        controller.enqueue(encoder.encode(formatSSEEvent(next.value)))
      } catch (error) {
        console.error('[a2a] the stream failed:', error)
        controller.close()
      }
    },
    async cancel() {
      await result.return(undefined)
    },
  })
  return new Response(stream, { headers: { ...SSE_HEADERS } })
}
