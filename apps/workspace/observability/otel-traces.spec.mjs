/**
 * @vitest-environment node
 */
import * as api from '@opentelemetry/api'
import * as sdk from '@opentelemetry/sdk-trace'
import { describe, expect, it } from 'vitest'
import { buildTracerProvider, requestSampler, shouldRecordRequest } from './otel-traces.js'

describe('shouldRecordRequest', () => {
  it.each(['/api/projects', '/api/projects/42?include=members', '/projects/42', '/', '/api/healthcheck-report'])(
    'records %s, a request someone reads a trace of',
    (target) => {
      expect(shouldRecordRequest(target)).toBe(true)
    },
  )

  it.each([
    ['a liveness probe', '/healthz'],
    ['the BFF probe', '/api/healthz'],
    ['the health route', '/api/health'],
    ['a Next asset', '/_next/static/chunks/main.js'],
    ['an image optimisation', '/_next/image?url=%2Flogo.png&w=64'],
    ['the PostHog proxy', '/ingest/e/?ip=1'],
    ['a static file', '/robots.txt'],
    ['the favicon', '/favicon.ico'],
    ['nothing', undefined],
  ])('drops %s', (_what, target) => {
    expect(shouldRecordRequest(target)).toBe(false)
  })
})

describe('requestSampler', () => {
  const sampler = requestSampler(sdk, api)
  const decide = (context, target) =>
    sampler.shouldSample(context, 'trace', 'GET', api.SpanKind.SERVER, target ? { 'http.target': target } : {}, [])
      .decision
  const under = (traceFlags) =>
    api.trace.setSpanContext(api.ROOT_CONTEXT, {
      traceId: '0af7651916cd43dd8448eb211c80319c',
      spanId: 'b7ad6b7169203331',
      traceFlags,
    })

  it('decides a root span by its request', () => {
    expect(decide(api.ROOT_CONTEXT, '/api/projects')).toBe(sdk.SamplingDecision.RECORD_AND_SAMPLED)
    expect(decide(api.ROOT_CONTEXT, '/healthz')).toBe(sdk.SamplingDecision.NOT_RECORD)
  })

  it('drops a root span that is no request at all', () => {
    expect(decide(api.ROOT_CONTEXT, undefined)).toBe(sdk.SamplingDecision.NOT_RECORD)
  })

  it('lets a child follow its parent, whatever it carries', () => {
    // Next's fetch and render spans carry no http.target; a dropped probe's
    // children must stay dropped, a kept request's must stay kept.
    expect(decide(under(api.TraceFlags.SAMPLED), undefined)).toBe(sdk.SamplingDecision.RECORD_AND_SAMPLED)
    expect(decide(under(api.TraceFlags.NONE), '/api/projects')).toBe(sdk.SamplingDecision.NOT_RECORD)
  })
})

describe('buildTracerProvider', () => {
  it('exports a kept request with its children, and nothing of a dropped one', async () => {
    // Through the real batch processor: a wrong constructor shape there drops
    // every span silently, which no sampler test would notice.
    const exporter = new sdk.InMemorySpanExporter()
    const provider = buildTracerProvider(sdk, api, { exporter })
    const tracer = provider.getTracer('next.js')
    for (const target of ['/api/projects', '/api/healthz']) {
      const root = tracer.startSpan(`GET ${target}`, { attributes: { 'http.target': target } })
      tracer.startSpan('fetch POST', {}, api.trace.setSpan(api.ROOT_CONTEXT, root)).end()
      root.end()
    }
    await provider.forceFlush()
    expect(exporter.getFinishedSpans().map((s) => s.name).sort()).toEqual(['GET /api/projects', 'fetch POST'])
    await provider.shutdown()
  })
})
