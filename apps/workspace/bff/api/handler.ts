import { PROJECT_CLOSED_SQLSTATE, projectClosedError } from '@/lib/projects/project-status'
import { NextResponse } from 'next/server'
import { ZodError, type ZodType, type output } from 'zod'
import { requireAuthorizedSession } from '@/lib/auth/require-auth'
import { hasPermission, type KnownPermission } from '@/lib/authz/permissions'
import { requireInternalToken, type InternalTokenEnv, type VerifiedSignature } from '@/lib/internal-auth'
import { verifySignedRequest, type SignedInternalApiContext, type SignedInternalRouteOptions } from './signed-route'
import { runWithTenantSlot, withPlatformAccess } from '@/lib/db/tenant-context'
import type { AuthorizedSession } from '@/lib/auth/types'
import { DEFAULT_MUTATION_LIMIT } from '@/lib/limits/catalog'
import { enforceLimit, rateLimitHeaders } from '@/lib/limits/enforce'
import { memberSubject } from '@/lib/limits/subject'
import type { LimitRule } from '@/lib/limits/types'
import {
  ApiError,
  BadRequestError,
  ForbiddenError,
  NoOrganizationError,
  PayloadTooLargeError,
  SessionRequiredError,
  TooManyRequestsError,
  UpstreamError,
} from './errors'
import { requestBodyLimitBytes } from '@/shared/config/request-body-limit'
import { REQUEST_ID_HEADER, resolveRequestId } from './request-id'
import { tagSpanWithBrowserSession } from './trace-session'
import { databaseUnavailableCode } from '@/lib/db/errors'
import { captureUpstreamError, upstreamContext } from '@/lib/analytics/upstream-error'
import {
  LEGAL_HOLD_MESSAGE,
  LEGAL_HOLD_REASON,
  LEGAL_HOLD_SQLSTATE,
} from '@/lib/compliance/legal-hold-codes'
import { FOLDER_DELETED_REASON, FOLDER_DELETED_SQLSTATE } from '@/lib/projects/folder-bin-codes'

export { SIGNED_INTERNAL_PREFIX, type SignedInternalApiContext, type SignedInternalRouteOptions } from './signed-route'

export interface ApiContext<TParams = Record<string, never>> {
  request: Request
  session: AuthorizedSession
  params: TParams
}

export interface InternalApiContext<TParams = Record<string, never>> {
  request: Request
  params: TParams
}

export interface PublicApiContext<TParams = Record<string, never>> {
  request: Request
  params: TParams
}

export type RouteAuthz =
  | { readonly permission: KnownPermission }
  | { readonly enforcedBy: string }
  | { readonly sessionOnly: true; readonly why: string }

export type RouteLimits =
  | { readonly rule: LimitRule }
  | { readonly none: true; readonly why: string }

interface RouteOptions {
  readonly authz: RouteAuthz
  readonly limits?: RouteLimits
  readonly status?: number
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function resolveLimitRule(options: RouteOptions, method: string): LimitRule | null {
  if (options.limits) {
    return 'none' in options.limits ? null : options.limits.rule
  }
  return MUTATING_METHODS.has(method.toUpperCase()) ? DEFAULT_MUTATION_LIMIT : null
}

export interface FixedAuthzRouteOptions {
  readonly status?: number
}

export type InternalTenancy =
  | { readonly fromPayload: string }
  | { readonly crossTenant: string }

export interface InternalRouteOptions extends FixedAuthzRouteOptions {
  readonly tenancy: InternalTenancy
  readonly tokenEnv?: InternalTokenEnv
  readonly auth?: never
}

interface PublicRouteOptions extends FixedAuthzRouteOptions {
  readonly why: string
}

export type NextRouteContext = { params?: Promise<Record<string, string | string[]>> }

export function successResponse(result: unknown, status: number): Response {
  if (result instanceof Response) return result
  if (result === undefined || result === null) {
    return new NextResponse(null, { status: status === 200 ? 204 : status })
  }
  return NextResponse.json(result, { status })
}

function isNextControlFlowError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const digest = (error as { digest?: unknown }).digest
  const marker = typeof digest === 'string' ? digest : error.message
  return (
    marker === 'NEXT_NOT_FOUND' ||
    marker.startsWith('NEXT_REDIRECT') ||
    marker.startsWith('NEXT_HTTP_ERROR_FALLBACK')
  )
}

function errorPayload(
  body: Record<string, unknown>,
  status: number,
  requestId: string,
  headers?: Record<string, string>,
): Response {
  return NextResponse.json(
    { ...body, requestId },
    { status, headers: { ...headers, [REQUEST_ID_HEADER]: requestId } },
  )
}

function logUpstreamError(error: UpstreamError, requestId: string): void {
  const { operation, code } = upstreamContext(error)
  const context = `${operation ? ` operation=${operation}` : ''}${code ? ` code=${code}` : ''}`
  console.error(`[upstream] ${error.message}${context} requestId=${requestId}`)
  captureUpstreamError(error, requestId)
}

const DATABASE_RETRY_AFTER_S = 5

function isProblem(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string' && typeof (value as { status?: unknown }).status === 'number'
}

export function errorResponse(error: unknown, request: Request): Response {
  if (isNextControlFlowError(error)) throw error
  const requestId = resolveRequestId(request)
  if (error instanceof SessionRequiredError || error instanceof NoOrganizationError) {
    return errorPayload({ error: 'Forbidden', code: 'FORBIDDEN' }, 403, requestId)
  }
  if (error instanceof ApiError && isProblem((error as { problem?: unknown }).problem)) {
    return errorPayload((error as unknown as { problem: Record<string, unknown> }).problem, error.status, requestId, { 'Content-Type': 'application/problem+json' })
  }
  if (error instanceof ApiError) {
    const body: Record<string, unknown> = { error: error.message, code: error.code }
    if (error.details !== undefined) body.details = error.details
    const headers =
      error instanceof TooManyRequestsError ? rateLimitHeaders(error.decision) : undefined
    if (error instanceof UpstreamError) logUpstreamError(error, requestId)
    return errorPayload(body, error.status, requestId, headers)
  }
  if (findPostgresCode(error) === LEGAL_HOLD_SQLSTATE) {
    return errorPayload(
      { error: LEGAL_HOLD_MESSAGE, code: 'CONFLICT', details: { reason: LEGAL_HOLD_REASON } },
      409,
      requestId,
    )
  }
  if (findPostgresCode(error) === FOLDER_DELETED_SQLSTATE) {
    return errorPayload(
      { error: 'Folder not found', code: 'NOT_FOUND', details: { reason: FOLDER_DELETED_REASON } },
      404,
      requestId,
    )
  }
  if (findPostgresCode(error) === PROJECT_CLOSED_SQLSTATE) {
    const closed = projectClosedError()
    return errorPayload({ error: closed.message, code: closed.code, details: closed.details }, closed.status, requestId)
  }
  if (isInvalidUuidQueryError(error)) {
    return errorPayload({ error: 'Not found', code: 'NOT_FOUND' }, 404, requestId)
  }
  const unavailable = databaseUnavailableCode(error)
  if (unavailable) {
    console.error(`[db] database unavailable (${unavailable}) requestId=${requestId}`)
    return errorPayload(
      { error: 'The database is not reachable right now. Try again shortly.', code: 'DATABASE_UNAVAILABLE' },
      503,
      requestId,
      { 'Retry-After': String(DATABASE_RETRY_AFTER_S) },
    )
  }
  const url = new URL(request.url)
  const pgCode = findPostgresCode(error)
  console.error(
    `[api] Unhandled error in ${request.method} ${url.pathname} requestId=${requestId}${pgCode ? ` pgCode=${pgCode}` : ''}:`,
    error
  )
  return errorPayload({ error: 'Internal server error', code: 'INTERNAL' }, 500, requestId)
}

function findPostgresCode(error: unknown): string | undefined {
  let current: unknown = error
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (typeof current === 'object' && current !== null && 'code' in current) {
      const code: unknown = (current as { code: unknown }).code
      if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code
    }
    current = current instanceof Error ? current.cause : undefined
  }
  return undefined
}

function isInvalidUuidQueryError(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 4 && current; depth += 1) {
    const message = current instanceof Error ? current.message : ''
    if (/invalid input syntax for type uuid/i.test(message)) return true
    current = current instanceof Error ? current.cause : undefined
  }
  return false
}

export async function resolveParams(
  context: NextRouteContext | undefined
): Promise<Record<string, string | string[]>> {
  return context?.params ? await context.params : {}
}

export function apiRoute<TParams = Record<string, string | string[]>>(
  handler: (ctx: ApiContext<TParams>) => Promise<unknown>,
  options: RouteOptions
) {
  const permission = 'permission' in options.authz ? options.authz.permission : null
  return async (request: Request, context?: NextRouteContext): Promise<Response> => {
    tagSpanWithBrowserSession(request)
    return runWithTenantSlot(async () => {
      try {
        const session = await requireAuthorizedSession()
        if (permission && !hasPermission(session, permission)) {
          throw new ForbiddenError()
        }
        const rule = resolveLimitRule(options, request.method)
        if (rule) await enforceLimit(rule, memberSubject(session))
        const params = (await resolveParams(context)) as TParams
        const result = await handler({ request, session, params })
        return successResponse(result, options.status ?? 200)
      } catch (error) {
        return errorResponse(error, request)
      }
    })
  }
}

type InternalRouteHandler = (request: Request, context?: NextRouteContext) => Promise<Response>

export function internalApiRoute<TParams = Record<string, string | string[]>>(
  label: string,
  handler: (ctx: SignedInternalApiContext<TParams>) => Promise<unknown>,
  options: SignedInternalRouteOptions
): InternalRouteHandler
export function internalApiRoute<TParams = Record<string, string | string[]>>(
  label: string,
  handler: (ctx: InternalApiContext<TParams>) => Promise<unknown>,
  options: InternalRouteOptions
): InternalRouteHandler
export function internalApiRoute<TParams = Record<string, string | string[]>>(
  label: string,
  handler: (ctx: SignedInternalApiContext<TParams>) => Promise<unknown>,
  options: InternalRouteOptions | SignedInternalRouteOptions
): InternalRouteHandler {
  const signature = options.auth?.signature ?? null
  return async (request: Request, context?: NextRouteContext): Promise<Response> => {
    let verified: VerifiedSignature | null = null
    if (signature) {
      try {
        verified = await verifySignedRequest(request, label, signature)
      } catch (error) {
        return errorResponse(error, request)
      }
    } else {
      const denied = requireInternalToken(request, label, options.tokenEnv)
      if (denied) return denied
    }
    return runWithTenantSlot(async () => {
      try {
        const params = (await resolveParams(context)) as TParams
        const ctx = (verified ? { request, params, signature: verified } : { request, params }) as SignedInternalApiContext<TParams>
        const run = () => handler(ctx)
        const result =
          'crossTenant' in options.tenancy
            ? await withPlatformAccess(`internal:${label} — ${options.tenancy.crossTenant}`, run)
            : await run()
        return successResponse(result, options.status ?? 200)
      } catch (error) {
        return errorResponse(error, request)
      }
    })
  }
}

export function publicApiRoute<TParams = Record<string, string | string[]>>(
  handler: (ctx: PublicApiContext<TParams>) => Promise<unknown>,
  options: PublicRouteOptions
) {
  return async (request: Request, context?: NextRouteContext): Promise<Response> => {
    return runWithTenantSlot(async () => {
      try {
        const params = (await resolveParams(context)) as TParams
        const result = await handler({ request, params })
        return successResponse(result, options.status ?? 200)
      } catch (error) {
        return errorResponse(error, request)
      }
    })
  }
}

export async function parseJsonBody<TSchema extends ZodType>(
  request: Request,
  schema: TSchema
): Promise<output<TSchema>> {
  const raw = await request.json().catch(() => {
    throw new BadRequestError('Invalid JSON body')
  })
  try {
    return schema.parse(raw)
  } catch (error) {
    if (error instanceof ZodError) {
      throw new BadRequestError('Invalid request body', error.issues)
    }
    throw error
  }
}

export async function parseFormData(request: Request): Promise<FormData> {
  try {
    return await request.formData()
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (/formdata/i.test(message) && !/size|limit|large/i.test(message)) {
      throw new BadRequestError('Request body is not multipart form data')
    }
    if (error instanceof TypeError) {
      throw new PayloadTooLargeError(requestBodyLimitBytes())
    }
    throw error
  }
}

export function parseQuery<TSchema extends ZodType>(
  request: Request,
  schema: TSchema
): output<TSchema> {
  const url = new URL(request.url)
  const query = Object.fromEntries(url.searchParams.entries())
  try {
    return schema.parse(query)
  } catch (error) {
    if (error instanceof ZodError) {
      throw new BadRequestError('Invalid query parameters', error.issues)
    }
    throw error
  }
}
