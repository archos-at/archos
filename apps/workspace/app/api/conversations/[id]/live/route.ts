import { apiRoute } from '@/lib/api/handler'
import { requireCollaborationEnabled } from '@/lib/authz/feature-flags'
import {
  LIVE_REAUTHORIZE_MS,
  requireConversationSpectator,
  stillMayWatchConversation,
} from '@/lib/conversations/live'
import {
  conversationFramesAvailable,
  subscribeConversationFrames,
} from '@/lib/events/conversation-frames'

type Params = { id: string }

const HEARTBEAT_MS = 25_000
const RETRY_MS = 2_000

export const dynamic = 'force-dynamic'

export const GET = apiRoute<Params>(
  async ({ session, params, request }) => {
    const gated = requireCollaborationEnabled(session)
    if (gated) return gated

    await requireConversationSpectator(session, params.id)

    const conversationId = params.id
    const encoder = new TextEncoder()
    let heartbeat: ReturnType<typeof setInterval> | null = null
    let recheck: ReturnType<typeof setInterval> | null = null
    let unsubscribe: (() => Promise<void>) | null = null
    let closed = false

    const teardown = async (): Promise<void> => {
      if (closed) return
      closed = true
      if (heartbeat) clearInterval(heartbeat)
      if (recheck) clearInterval(recheck)
      heartbeat = null
      recheck = null
      const release = unsubscribe
      unsubscribe = null
      if (!release) return
      try {
        await release()
      } catch (error) {
        console.warn('[live] unsubscribe failed:', error)
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
        const close = (): void => {
          void teardown()
          try {
            controller.close()
          } catch {
            // Already closed by the cancel path.
          }
        }

        write(`retry: ${RETRY_MS}\n\n`)

        if (!conversationFramesAvailable()) {
          write(`data: ${JSON.stringify({ kind: 'unsupported' })}\n\n`)
          close()
          return
        }

        write(': connected\n\n')
        heartbeat = setInterval(() => write(': ping\n\n'), HEARTBEAT_MS)

        const release = await subscribeConversationFrames(conversationId, (frame) => {
          write(`data: ${JSON.stringify({ kind: 'frame', payload: frame.payload })}\n\n`)
        })
        if (!release) {
          write(`data: ${JSON.stringify({ kind: 'unsupported' })}\n\n`)
          close()
          return
        }
        if (closed) {
          await release().catch(() => {})
          return
        }
        unsubscribe = release

        recheck = setInterval(() => {
          void stillMayWatchConversation(session, conversationId).then((allowed) => {
            if (allowed || closed) return
            write(`data: ${JSON.stringify({ kind: 'revoked' })}\n\n`)
            close()
          })
        }, LIVE_REAUTHORIZE_MS)

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
  { authz: { enforcedBy: 'requireConversationSpectator (requireResourceAccess, viewer)' } }
)
