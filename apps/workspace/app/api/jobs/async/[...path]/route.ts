import { NextResponse } from 'next/server'
import { tenantSlotRoute } from '@/lib/db/tenant-context'
import { buildCollectionScopeFromRequest } from '@/lib/retrieval-scope/collection-scope-request'
import { FEATURE_FLAGS, requireFeature } from '@/lib/authz/feature-flags'
import { isAuthzRefusal } from '@/lib/api/errors'
import { getEffectiveModelOverrides } from '@/lib/model-config/service'
import { loadProjectFederalState } from '@/lib/project-profile/prompt-view'
import { resolveOrgInstructions } from '@/lib/org-instructions/service'
import {
  signJobRequestContext,
  type AuthorizedJobScope,
  type JobSubmitContext,
} from '@/lib/jobs/request-envelope'
import {
  buildAuthHeaders,
  backendErrorEnvelope,
  errorEnvelope,
  noResponseBodyEnvelope,
  handleAuthzError,
  proxyErrorEnvelope,
  sseStreamResponse,
} from '@/lib/backend-proxy'
import { parseQueryContext, resolveRequestContext } from '@/lib/proxy/collection-authz'
import { buildProxyUrl, resolveSessionAndBearer } from '@/lib/proxy/proxy-request'
import type { UserSession } from '@/lib/auth/types'
import { fileCommissionedReport } from '@/lib/documents/commissioned-report'
import { findProjectTenancy } from '@/lib/projects/repository'
import { isProjectClosed, projectClosedError } from '@/lib/projects/project-status'

async function resolveRequestContextHeaders(
  session: UserSession | null,
  scope: AuthorizedJobScope,
  { submit }: { submit: boolean }
): Promise<Record<string, string>> {
  const submitContext = submit ? await resolveSubmitContext(session, scope.projectId) : {}
  return signJobRequestContext(session, scope, submitContext)
}

async function resolveSubmitContext(
  session: UserSession | null,
  projectId: string | undefined
): Promise<JobSubmitContext> {
  const input: JobSubmitContext = {}

  if (session?.organizationId) {
    try {
      const overrides = await getEffectiveModelOverrides(session.organizationId)
      if (overrides) {
        input.modelOverrides = overrides
      }
    } catch (error) {
      console.warn('[Deep Research API] Failed to load model overrides:', error)
    }
    const orgInstructions = await resolveOrgInstructions(session.organizationId)
    if (orgInstructions) {
      input.orgInstructions = orgInstructions
    }
  }

  if (projectId) {
    try {
      const federalState = await loadProjectFederalState(projectId, session?.organizationId)
      if (federalState) {
        input.federalState = federalState
      }
    } catch (error) {
      console.warn('[Deep Research API] Failed to load federal-state fact:', error)
    }
  }

  return input
}

function listingSearchParams(
  searchParams: URLSearchParams,
  scope: AuthorizedJobScope
): URLSearchParams {
  const params = new URLSearchParams(searchParams)
  params.delete('project_collection')
  const requestedProject = params.get('projectId')
  params.delete('projectId')
  params.delete('conversationId')
  const signedProject = scope.scopedCollections.find((entry) => entry.shelf === 'project')
  if (requestedProject && scope.projectId === requestedProject && signedProject) {
    params.set('project_collection', signedProject.collection)
  }
  return params
}

const LOG_LABEL = 'Deep Research API'

const traceRequest = (...args: unknown[]): void => {
  if (process.env.NODE_ENV !== 'development') return
  console.debug(`[${LOG_LABEL}]`, ...args)
}
const JOBS_BASE_PATH = '/v1/jobs/async'

function reportRunId(path: string[]): string | null {
  return path.length === 3 && path[0] === 'job' && path[2] === 'report' ? path[1] : null
}

function logBackendError(method: 'GET' | 'POST' | 'DELETE', status: number, errorText: string): void {
  if (status === 400 && errorText.includes('Job not cancellable')) {
    console.warn(`[Deep Research API] ${method} cancel race: job already terminal:`, errorText.slice(0, 200))
    return
  }
  console.error(`[Deep Research API] ${method} backend error:`, status, errorText)
}

export const GET = tenantSlotRoute(async function GET(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<Response> {
  try {
    const { path } = await params
    const isStreamRequest = path.includes('stream')
    const { searchParams } = new URL(req.url)

    const lastEventId = req.headers.get('Last-Event-ID')?.trim()
    const upstreamPath =
      isStreamRequest &&
      path[path.length - 1] === 'stream' &&
      lastEventId &&
      /^\d+$/.test(lastEventId)
        ? [...path, lastEventId]
        : path
    const backendUrl = buildProxyUrl(JOBS_BASE_PATH, upstreamPath)

    traceRequest('GET:', backendUrl, isStreamRequest ? '(SSE)' : '')

    const { session, authHeader } = await resolveSessionAndBearer(req, path, LOG_LABEL)
    const authHeaders = buildAuthHeaders(authHeader)
    traceRequest('WorkOS access token present:', !!authHeaders.Authorization)

    const scope = await buildCollectionScopeFromRequest(session, parseQueryContext(searchParams))
    const requestContextHeaders = await resolveRequestContextHeaders(session, scope, { submit: false })

    const upstreamParams =
      path.length === 1 && path[0] === 'jobs' ? listingSearchParams(searchParams, scope) : searchParams
    const upstreamUrl = buildProxyUrl(JOBS_BASE_PATH, upstreamPath, upstreamParams, ['token'])

    const response = await fetch(upstreamUrl, {
      method: 'GET',
      headers: {
        ...authHeaders,
        ...requestContextHeaders,
        Accept: isStreamRequest ? 'text/event-stream' : 'application/json',
        'X-Collection-Scope': scope.headerValue,
      },
      ...(isStreamRequest ? { signal: req.signal } : {}),
    })

    if (!response.ok) {
      const errorText = await response.text()
      logBackendError('GET', response.status, errorText)

      return backendErrorEnvelope(response.status, errorText)
    }

    if (isStreamRequest) {
      if (!response.body) {
        return noResponseBodyEnvelope('Backend returned no SSE stream body')
      }

      return sseStreamResponse(response.body, {
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no', // Disable nginx buffering
      })
    }

    const data = await response.json()

    const runId = reportRunId(path)
    const filing = runId ? await fileCommissionedReport({ runId, session, body: data }) : null

    if (filing?.outcome === 'filed') return NextResponse.json({ ...data, filed: filing.filed })
    if (filing?.outcome === 'queued') return NextResponse.json({ ...data, filingQueued: true })
    if (filing?.outcome === 'failed' || filing?.outcome === 'refused') {
      return NextResponse.json({ ...data, filingFailed: true })
    }
    return NextResponse.json(data)
  } catch (error) {
    if (isAuthzRefusal(error)) {
      return handleAuthzError(error)
    }

    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('fetch failed') || message.includes('EHOSTUNREACH') || message.includes('ECONNREFUSED')) {
      console.warn('[Deep Research API] GET transport miss:', message.slice(0, 300))
    } else {
      console.error('[Deep Research API] GET error:', error)
    }

    return proxyErrorEnvelope(error)
  }
})

const RUN_DOCUMENTS_CONTROL = /\/job\/[^/]+\/documents\/?$/

function isRunDocumentsControl(backendUrl: string): boolean {
  return RUN_DOCUMENTS_CONTROL.test(new URL(backendUrl).pathname)
}

export const POST = tenantSlotRoute(async function POST(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<Response> {
  try {
    const { path } = await params
    const backendUrl = buildProxyUrl(JOBS_BASE_PATH, path)

    traceRequest('POST:', backendUrl)

    if (isRunDocumentsControl(backendUrl)) {
      return errorEnvelope(
        404,
        'NOT_FOUND',
        'Documents are handed to a run through POST /api/projects/{projectId}/runs/{runId}/documents'
      )
    }

    let parsedBody: Record<string, unknown> | undefined
    let body: string | undefined
    try {
      parsedBody = await req.json()
      body = JSON.stringify(parsedBody)
    } catch {
      parsedBody = undefined
      body = undefined
    }

    const { session, authHeader } = await resolveSessionAndBearer(req, path, LOG_LABEL)
    const authHeaders = buildAuthHeaders(authHeader)
    traceRequest('POST WorkOS access token present:', !!authHeaders.Authorization)

    if (path[0] === 'submit') {
      const gated = requireFeature(session ?? { featureFlags: null }, FEATURE_FLAGS.deepResearch)
      if (gated) return gated
    }

    const scope = await buildCollectionScopeFromRequest(
      session,
      resolveRequestContext(new URL(req.url).searchParams, parsedBody)
    )
    const requestContextHeaders = await resolveRequestContextHeaders(session, scope, {
      submit: path[0] === 'submit',
    })

    if (path[0] === 'submit' && scope.projectId && isProjectClosed(await findProjectTenancy(scope.projectId))) {
      const closed = projectClosedError()
      return NextResponse.json(
        { error: { code: closed.code, message: closed.message, details: closed.details } },
        { status: closed.status }
      )
    }

    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
        ...requestContextHeaders,
        'X-Collection-Scope': scope.headerValue,
      },
      ...(body ? { body } : {}),
    })

    if (!response.ok) {
      const errorText = await response.text()
      logBackendError('POST', response.status, errorText)

      return backendErrorEnvelope(response.status, errorText)
    }

    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    if (isAuthzRefusal(error)) {
      return handleAuthzError(error)
    }

    console.error('[Deep Research API] POST error:', error)

    return proxyErrorEnvelope(error)
  }
})

export const DELETE = tenantSlotRoute(async function DELETE(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<Response> {
  try {
    const { path } = await params
    const backendUrl = buildProxyUrl(JOBS_BASE_PATH, path)
    const { searchParams } = new URL(req.url)

    traceRequest('DELETE:', backendUrl)

    const { session, authHeader } = await resolveSessionAndBearer(req, path, LOG_LABEL)
    const authHeaders = buildAuthHeaders(authHeader)
    traceRequest('DELETE WorkOS access token present:', !!authHeaders.Authorization)

    const scope = await buildCollectionScopeFromRequest(session, parseQueryContext(searchParams))
    const requestContextHeaders = await resolveRequestContextHeaders(session, scope, { submit: false })

    const upstreamUrl = buildProxyUrl(JOBS_BASE_PATH, path, searchParams, ['token'])

    const response = await fetch(upstreamUrl, {
      method: 'DELETE',
      headers: {
        ...authHeaders,
        ...requestContextHeaders,
        Accept: 'application/json',
        'X-Collection-Scope': scope.headerValue,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      logBackendError('DELETE', response.status, errorText)

      return backendErrorEnvelope(response.status, errorText)
    }

    const data = await response.json().catch(() => ({}))
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    if (isAuthzRefusal(error)) {
      return handleAuthzError(error)
    }

    console.error('[Deep Research API] DELETE error:', error)

    return proxyErrorEnvelope(error)
  }
})
