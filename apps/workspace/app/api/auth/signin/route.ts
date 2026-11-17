import { getSignInUrl } from '@workos-inc/authkit-nextjs'
import { type NextRequest, NextResponse } from 'next/server'
import { safeReturnPathname } from '@/lib/auth/return-pathname'
import { tenantSlotRoute } from '@/lib/db/tenant-context'

const LOGIN_HINT = /^[^\s@]{1,64}@[^\s@]{1,255}$/

const loginHintFrom = (value: string | null): string | undefined =>
  value && LOGIN_HINT.test(value) ? value : undefined

const signIn = async (request: NextRequest): Promise<Response> => {
  const params = new URL(request.url).searchParams
  const returnTo = safeReturnPathname(params.get('returnPathname'))
  const loginHint = loginHintFrom(params.get('loginHint'))
  const url = await getSignInUrl({ ...(returnTo && { returnTo }), ...(loginHint && { loginHint }) })
  return NextResponse.redirect(url)
}

export const GET = tenantSlotRoute(signIn)
