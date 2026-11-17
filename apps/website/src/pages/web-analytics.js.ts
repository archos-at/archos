import type { APIRoute } from 'astro'
import { webAnalyticsConfig, webAnalyticsScript } from '../../runtime/web-analytics.mjs'

export const prerender = false

export const GET: APIRoute = () =>
  new Response(webAnalyticsScript(webAnalyticsConfig(process.env)), {
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  })
