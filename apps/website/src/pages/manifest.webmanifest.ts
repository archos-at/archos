import type { APIRoute } from 'astro'
import identity from '../lib/identity'
import { surfaceColor as surface } from '../lib/theme'

export const prerender = true

export const GET: APIRoute = () =>
  new Response(
    JSON.stringify(
      {
        name: identity.name,
        short_name: identity.name,
        description: identity.claim,
        lang: 'de',
        start_url: '/',
        scope: '/',
        display: 'browser',
        background_color: surface,
        theme_color: surface,
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      null,
      2,
    ),
    { headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' } },
  )
