import { publicApiRoute } from '@/lib/api/handler'
import { postHogConfigFromEnv } from '@/lib/analytics/posthog-config'
import { forwardToPosthog } from '@/lib/analytics/posthog-proxy'

export const dynamic = 'force-dynamic'

const relay = async ({ request }: { request: Request }): Promise<Response> =>
  forwardToPosthog(request, postHogConfigFromEnv(process.env))

const WHY =
  'Unauthenticated by necessity: the browser SDK posts analytics from signed-out pages and ' +
  'while a session is expiring, and an AuthKit redirect would answer a beacon with a login ' +
  'page. It holds no tenant data and reads none: it relays to ONE configured host (never one ' +
  'taken from the request), forwards an allow-list of headers (no cookies, no ' +
  'Authorization), and answers 404 when PostHog or the proxy is not configured.'

export const GET = publicApiRoute(relay, { why: WHY })
export const POST = publicApiRoute(relay, { why: WHY })
