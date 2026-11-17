import { apiRoute } from '@/lib/api/handler'
import { requireCollaborationEnabled } from '@/lib/authz/feature-flags'
import { subscribeUser } from '@/lib/events/bus'

const HEARTBEAT_MS = 25_000
const RETRY_MS = 5_000

export const dynamic = 'force-dynamic'

export const GET = apiRoute(
  async ({ session, request }) => {
    const gated = requireCollaborationEnabled(session)
    if (gated) return gated

    const encoder = new TextEncoder()
    let heartbeat: ReturnType<typeof setInterval> | null = null
    let unsubscribe: (() => Promise<void>) | null = null
    let closed = false

    const teardown = async (): Promise<void> => {
      if (closed) return
      closed = true
      if (heartbeat) {
        clearInterval(heartbeat)
        heartbeat = null
      }
      const release = unsubscribe
      unsubscribe = null
      if (!release) return
      try {
        await release()
      } catch (error) {
        console.warn('[stream] unsubscribe failed:', error)
      }
    }

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const write = (chunk: string): void => {
          if (closed) return
          try {
            controller.enqueue(encoder.encode(chunk))
          } catch {
            void teardown()
          }
        }

        write(`retry: ${RETRY_MS}\n\n`)
        write(': connected\n\n')
        heartbeat = setInterval(() => write(': ping\n\n'), HEARTBEAT_MS)

        const release = await subscribeUser(session.userId, (envelope) => {
          write(`data: ${JSON.stringify(envelope)}\n\n`)
        })
        if (closed) {
          await release().catch(() => {})
          return
        }
        unsubscribe = release

        request.signal.addEventListener('abort', () => void teardown(), { once: true })
        if (request.signal.aborted) await teardown()
      },
      async cancel() {
        await teardown()
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  },
  { authz: { enforcedBy: 'per-user SSE channel keyed to session.userId' } }
)
