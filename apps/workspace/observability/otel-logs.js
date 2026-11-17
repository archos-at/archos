/**
 * Shared OTLP log bridge for the Node tiers (grid-ui BFF, bff-jobs,
 * purger) — ADR-0029 "future signal adoption is app-only work".
 *
 * Every tier logs with plain `console.*`; this module bridges those calls to
 * OTel log records so they reach the collector, and through it PostHog Logs,
 * next to the Python tiers' logs. The original console output is
 * preserved (kubectl logs keeps working).
 *
 * Severity follows the console method, with the exceptions listed at
 * NOT_AN_ERROR below — a few record shapes reach `console.error` without being
 * application errors, and ERROR is precisely what an alert on the logs fires
 * for (err2issue used to open a GitHub issue per ERROR record).
 *
 * Capability doctrine: no OTEL_EXPORTER_OTLP_ENDPOINT (local dev, compose
 * without the observability tier) => clean no-op, zero overhead. There is no
 * separate opt-in flag.
 *
 * Environment: OTEL_EXPORTER_OTLP_ENDPOINT, and what names the resource; both
 * are `otlp.js`.
 */

const util = require('node:util')
const { UNAVAILABLE_CODE_PATTERN } = require('../workers/database-unavailable')
const { collectorEndpoint, resourceAttributes, signalUrl } = require('./otlp')

let initialized = false

const SEVERITY = {
  debug: { severityNumber: 5, severityText: 'DEBUG' },
  log: { severityNumber: 9, severityText: 'INFO' },
  info: { severityNumber: 9, severityText: 'INFO' },
  warn: { severityNumber: 13, severityText: 'WARN' },
  error: { severityNumber: 17, severityText: 'ERROR' },
}

/**
 * Records that arrive on `console.error` without being application errors.
 *
 * ERROR is not a cosmetic level here: the collector drops everything below WARN
 * before the PostHog exporter (`deploy/pulumi/src/platform/otel-collector.ts`),
 * and an ERROR record is what an alert pages about, while a WARN record is
 * searchable and nothing more. Nothing on this list is dropped or
 * sampled away — it is recorded at the severity it actually has, which is the
 * difference between "visible in the logs" and "someone is paged about it".
 *
 * Each entry earns its place with a real misfiled issue, and each is anchored
 * tightly enough that an application error cannot drift into it. When a pattern
 * stops matching (a Node or Next format change), the record simply stays ERROR:
 * this list fails towards reporting, never towards silence.
 */
const NOT_AN_ERROR = [
  {
    reason: 'node-process-warning',
    match: /^\(\w+:\d+\) (\[[A-Z0-9_]+\] )?\w*Warning: /,
  },
  {
    reason: 'expected-404',
    match: /status: 404,\s+code: 'NOT_FOUND'/,
  },
  {
    reason: 'client-disconnect',
    match: /^⨯ Error: The destination stream closed early\.(\s|$)/,
  },
  {
    reason: 'database-unavailable-render',
    match: new RegExp(
      `^⨯ Error: Failed query:[\\s\\S]*\\[cause\\]:[\\s\\S]*code: '(${UNAVAILABLE_CODE_PATTERN})'`,
    ),
  },
]

/**
 * Severity for one console record: the console method's own level, unless the
 * body is one of the {@link NOT_AN_ERROR} shapes, which are recorded at WARN.
 */
function classifyConsoleRecord(method, body) {
  const known = method === 'error' && NOT_AN_ERROR.find((entry) => entry.match.test(body))
  if (!known) return SEVERITY[method]
  return { ...SEVERITY.warn, attributes: { 'grid.severity.reclassified': known.reason } }
}

/**
 * Initialize OTLP log export and patch console.* to also emit OTel log
 * records. Idempotent. Returns true when export was enabled.
 */
function initOtelLogs() {
  if (initialized) return false
  const endpoint = collectorEndpoint(process.env)
  if (!endpoint) return false
  initialized = true

  const { logs } = require('@opentelemetry/api-logs')
  const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-http')
  const { BatchLogRecordProcessor, LoggerProvider } = require('@opentelemetry/sdk-logs')
  const { defaultResource, resourceFromAttributes } = require('@opentelemetry/resources')

  const resource = defaultResource().merge(resourceFromAttributes(resourceAttributes(process.env)))
  const provider = new LoggerProvider({
    resource,
    processors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter({ url: signalUrl(endpoint, 'logs') }) })],
  })
  logs.setGlobalLoggerProvider(provider)

  const logger = logs.getLogger('grid-console')
  for (const method of Object.keys(SEVERITY)) {
    const original = console[method].bind(console)
    console[method] = (...args) => {
      original(...args)
      try {
        const body = util.format(...args)
        logger.emit({ ...classifyConsoleRecord(method, body), body })
      } catch {
        // Telemetry must never break the app.
      }
    }
  }
  return true
}

module.exports = { classifyConsoleRecord, initOtelLogs }
