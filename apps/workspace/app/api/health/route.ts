import { NextResponse } from 'next/server'
import { publicApiRoute } from '@/lib/api/handler'
import { getBackendUrl } from '@/lib/backend-url'

export const GET = publicApiRoute(
  async () => {
    try {
      const response = await fetch(`${getBackendUrl()}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      })

      if (!response.ok) {
        return new NextResponse(null, { status: response.status })
      }

      const data = await response.json()
      return NextResponse.json(data)
    } catch {
      return new NextResponse(null, { status: 502 })
    }
  },
  { why: 'a backend health probe: it proxies /health and returns no tenant data' }
)
