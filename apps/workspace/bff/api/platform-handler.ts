import { NextResponse } from 'next/server'
import { getUserSession } from '@/lib/auth/session'
import { PlatformAccessDeniedError, requirePlatformPermission } from '@/lib/authz/platform'
import type { PlatformPermission } from '@/lib/authz/permissions'
import { runWithTenantSlot, withPlatformAccess } from '@/lib/db/tenant-context'
import type { UserSession } from '@/lib/auth/types'
import { errorResponse, resolveParams, successResponse, type NextRouteContext } from './handler'

export interface PlatformRouteOptions {
  readonly permission: PlatformPermission
  readonly status?: number
}

export interface PlatformApiContext<TParams = Record<string, never>> {
  request: Request
  session: UserSession
  params: TParams
}

export function platformApiRoute<TParams = Record<string, string | string[]>>(
  handler: (ctx: PlatformApiContext<TParams>) => Promise<unknown>,
  options: PlatformRouteOptions
) {
  return async (request: Request, context?: NextRouteContext): Promise<Response> => {
    return runWithTenantSlot(async () => {
      try {
        const session = await getUserSession()
        await requirePlatformPermission(session, options.permission)
        const params = (await resolveParams(context)) as TParams
        const result = await withPlatformAccess(`platformApiRoute ${request.method}`, () =>
          handler({ request, session: session as UserSession, params })
        )
        return successResponse(result, options.status ?? 200)
      } catch (error) {
        if (error instanceof PlatformAccessDeniedError) {
          return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 })
        }
        return errorResponse(error, request)
      }
    })
  }
}
