/**
 * The BFF's request traces, for PostHog Tracing (ADR-0029 Amendment 6).
 *
 * Registering a tracer provider is all Next.js needs: it then records its own
 * spans for every request (the `[method] [route]` root, the route handler or
 * render, each `fetch`, including the calls to the Python backend). They go to
 * the collector like the logs, and the collector sends the Next tiers' spans
 * to PostHog and keeps them out of Langfuse, which holds the LLM traces.
 *
 * One rule keeps the volume honest: a request whose root span this module would
 * not want to read is never recorded at all (`shouldRecordRequest`). Health
 * probes, static assets and the PostHog proxy are most requests and none of the
 * questions. The decision is a sampler, at span creation, so a dropped request
 * costs no batching, serialisation or export (the same reasoning as Amendment 5).
 *
 * Capability doctrine: no OTEL_EXPORTER_OTLP_ENDPOINT (local dev, compose
 * without the observability tier) => no provider, and Next records nothing.
 */

const { collectorEndpoint, resourceAttributes, signalUrl } = require('./otlp')

/** Paths no one reads a trace of: probes, Next's assets, the PostHog proxy. */
const UNTRACED_PREFIXES = ['/_next/', '/ingest', '/healthz', '/api/healthz', '/api/health', '/favicon']

/** A static file: the last path segment has an extension (`/logo.svg`, `/robots.txt`). */
const STATIC_FILE = /\/[^/]+\.[a-z0-9]{1,8}$/i

let provider

/** Whether a request to `target` (`/path?query`, as Next records it) gets a trace. Pure. */
function shouldRecordRequest(target) {
  if (typeof target !== 'string' || target === '') return false
  const path = target.split('?')[0]
  const untraced = UNTRACED_PREFIXES.some((p) => path === p || path.startsWith(p.endsWith('/') ? p : `${p}/`))
  return !untraced && !STATIC_FILE.test(path)
}

/**
 * A root span is recorded when it is a request worth reading; a child follows
 * its parent. A root with no `http.target` (Next's own start-up work) is not a
 * request and is dropped.
 */
function requestSampler({ SamplingDecision }, { trace }) {
  return {
    shouldSample(context, _traceId, _name, _kind, attributes) {
      const parent = trace.getSpanContext(context)
      if (parent && trace.isSpanContextValid(parent)) {
        // eslint-disable-next-line no-bitwise -- TraceFlags is a bit field
        return { decision: parent.traceFlags & 1 ? SamplingDecision.RECORD_AND_SAMPLED : SamplingDecision.NOT_RECORD }
      }
      return {
        decision: shouldRecordRequest(attributes?.['http.target'])
          ? SamplingDecision.RECORD_AND_SAMPLED
          : SamplingDecision.NOT_RECORD,
      }
    },
    toString() {
      return 'RequestSampler'
    },
  }
}

/**
 * The provider, around one exporter. SDK 3.x: the processor takes an options
 * object; a positional exporter leaves it undefined and every flush throws
 * inside the processor, silently dropping all spans (as with the log bridge).
 */
function buildTracerProvider(sdk, api, { resource, exporter }) {
  return new sdk.TracerProvider({
    resource,
    sampler: requestSampler(sdk, api),
    spanProcessors: [new sdk.BatchSpanProcessor({ exporter })],
  })
}

/** Register the provider. Returns whether it did; a no-op without a collector or when already done. */
function initOtelTraces() {
  if (provider) return false
  const endpoint = collectorEndpoint(process.env)
  if (!endpoint) return false

  const api = require('@opentelemetry/api')
  const sdk = require('@opentelemetry/sdk-trace')
  const { AsyncLocalStorageContextManager } = require('@opentelemetry/context-async-hooks')
  const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http')
  const { defaultResource, resourceFromAttributes } = require('@opentelemetry/resources')

  provider = buildTracerProvider(sdk, api, {
    resource: defaultResource().merge(resourceFromAttributes(resourceAttributes(process.env))),
    exporter: new OTLPTraceExporter({ url: signalUrl(endpoint, 'traces') }),
  })
  api.context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable())
  api.trace.setGlobalTracerProvider(provider)
  return true
}

/** Flush what is batched, for the shutdown hooks; nothing without a provider. */
async function shutdownOtelTraces() {
  if (provider) await provider.shutdown()
}

module.exports = { buildTracerProvider, initOtelTraces, requestSampler, shouldRecordRequest, shutdownOtelTraces }
