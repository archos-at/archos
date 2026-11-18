import type { APIRoute } from 'astro'
import identity from '../lib/identity'

export const prerender = false

export const GET: APIRoute = ({ url }) => {
  const appUrl = (process.env.PUBLIC_APP_URL ?? `https://app.${identity.domain}`).replace(/\/+$/, '')
  const email = url.searchParams.get('email')?.trim() ?? ''
  const target = email.includes('@') ? `/api/auth/signin?loginHint=${encodeURIComponent(email)}` : '/?sign-in'
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${appUrl}${target}`,
      'Cache-Control': 'no-store',
    },
  })
}
