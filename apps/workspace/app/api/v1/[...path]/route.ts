import { NextResponse } from 'next/server'
import { tenantSlotRoute } from '@/lib/db/tenant-context'
import { buildCollectionScopeFromRequest } from '@/lib/retrieval-scope/collection-scope-request'
import { isAuthzRefusal } from '@/lib/api/errors'
import {
  resolveOptionalSession,
  backendErrorEnvelope,
  handleAuthzError,
  proxyErrorEnvelope,
  errorEnvelope,
} from '@/lib/backend-proxy'
import {
  parseQueryContext,
  resolveRequestContext,
  validateCollectionName,
} from '@/lib/proxy/collection-authz'
import { buildProxyUrl } from '@/lib/proxy/proxy-request'
import { isForwardableV1Request } from '@/lib/proxy/v1-allowlist'
import { isWebSearchEnabledForOrg } from '@/lib/organizations/service'

async function filterDataSourcesResponse(
  path: string[],
  organizationId: string | null | undefined,
  data: unknown
): Promise<unknown> {
  if (path.length !== 1 || path[0] !== 'data_sources' || !organizationId) return data
  try {
    if (await isWebSearchEnabledForOrg(organizationId)) return data
  } catch {
    return data
  }
  const dropWebSearch = (sources: unknown[]): unknown[] =>
    sources.filter(
      (source) =>
        !(source && typeof source === 'object' && (source as { id?: unknown }).id === 'web_search')
    )
  if (Array.isArray(data)) return dropWebSearch(data)
  if (
    data &&
    typeof data === 'object' &&
    Array.isArray((data as { data_sources?: unknown }).data_sources)
  ) {
    return {
      ...data,
      data_sources: dropWebSearch((data as { data_sources: unknown[] }).data_sources),
    }
  }
  return data
}

const isRedirectError = (error: unknown): boolean => {
  return error instanceof Error && error.message === 'NEXT_REDIRECT'
}

const rejectUnlistedPath = (method: string, path: string[]): NextResponse | null => {
  if (isForwardableV1Request(method, path)) return null
  return errorEnvelope(404, 'NOT_FOUND', 'Not found')
}

export const GET = tenantSlotRoute(async function GET(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<Response> {
  try {
    const { path } = await params
    const blocked = rejectUnlistedPath(req.method, path)
    if (blocked) {
      return blocked
    }
    const { searchParams } = new URL(req.url)
    const session = await resolveOptionalSession()
    const context = parseQueryContext(searchParams)

    const validationError = await validateCollectionName(path, session, context, {
      method: req.method,
    })
    if (validationError) {
      return validationError
    }

    const { headerValue } = await buildCollectionScopeFromRequest(session, context)
    const authHeaders: Record<string, string> = session
      ? { Authorization: `Bearer ${session.accessToken}` }
      : {}

    const response = await fetch(buildProxyUrl('/v1', path, searchParams), {
      method: 'GET',
      headers: {
        ...authHeaders,
        Accept: 'application/json',
        'X-Collection-Scope': headerValue,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      return backendErrorEnvelope(response.status, errorText)
    }

    const data = await response.json()
    return NextResponse.json(await filterDataSourcesResponse(path, session?.organizationId, data))
  } catch (error) {
    if (isRedirectError(error)) {
      throw error
    }
    if (isAuthzRefusal(error)) {
      return handleAuthzError(error)
    }

    return proxyErrorEnvelope(error)
  }
})

export const POST = tenantSlotRoute(async function POST(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<Response> {
  try {
    const { path } = await params
    const blocked = rejectUnlistedPath(req.method, path)
    if (blocked) {
      return blocked
    }
    const { searchParams } = new URL(req.url)
    const session = await resolveOptionalSession()
    const contentType = req.headers.get('Content-Type') || 'application/json'

    let parsedBody: Record<string, unknown> | undefined
    let body: BodyInit | undefined
    const requestHeaders: Record<string, string> = {}

    if (contentType.includes('multipart/form-data')) {
      body = req.body as ReadableStream<Uint8Array>
      requestHeaders['Content-Type'] = contentType
    } else {
      requestHeaders['Content-Type'] = 'application/json'
      try {
        parsedBody = await req.json()
        body = JSON.stringify(parsedBody)
      } catch {
        parsedBody = undefined
        body = undefined
      }
    }

    const context = resolveRequestContext(searchParams, parsedBody)

    const validationError = await validateCollectionName(path, session, context, {
      method: req.method,
    })
    if (validationError) {
      return validationError
    }

    const { headerValue } = await buildCollectionScopeFromRequest(session, context)
    const authHeaders: Record<string, string> = session
      ? { Authorization: `Bearer ${session.accessToken}` }
      : {}

    const response = await fetch(buildProxyUrl('/v1', path, searchParams), {
      method: 'POST',
      headers: {
        ...authHeaders,
        ...requestHeaders,
        'X-Collection-Scope': headerValue,
      },
      ...(body ? { body, duplex: 'half' } : {}),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return backendErrorEnvelope(response.status, errorText)
    }

    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    if (isRedirectError(error)) {
      throw error
    }
    if (isAuthzRefusal(error)) {
      return handleAuthzError(error)
    }

    return proxyErrorEnvelope(error)
  }
})

export const DELETE = tenantSlotRoute(async function DELETE(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<Response> {
  try {
    const { path } = await params
    const blocked = rejectUnlistedPath(req.method, path)
    if (blocked) {
      return blocked
    }
    const { searchParams } = new URL(req.url)
    const session = await resolveOptionalSession()
    const context = parseQueryContext(searchParams)

    const validationError = await validateCollectionName(path, session, context, {
      method: req.method,
    })
    if (validationError) {
      return validationError
    }

    const { headerValue } = await buildCollectionScopeFromRequest(session, context)
    const authHeaders: Record<string, string> = session
      ? { Authorization: `Bearer ${session.accessToken}` }
      : {}

    let body: string | undefined
    try {
      const json = await req.json()
      body = JSON.stringify(json)
    } catch {
      body = undefined
    }

    const response = await fetch(buildProxyUrl('/v1', path, searchParams), {
      method: 'DELETE',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
        'X-Collection-Scope': headerValue,
      },
      ...(body ? { body } : {}),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return backendErrorEnvelope(response.status, errorText)
    }

    if (response.status === 204) {
      return new NextResponse(null, { status: 204 })
    }

    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    if (isRedirectError(error)) {
      throw error
    }
    if (isAuthzRefusal(error)) {
      return handleAuthzError(error)
    }

    return proxyErrorEnvelope(error)
  }
})
