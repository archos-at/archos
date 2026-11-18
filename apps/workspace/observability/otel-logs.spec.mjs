/**
 * @vitest-environment node
 */
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'

async function freshModule() {
  vi.resetModules()
  return import('./otel-logs.js')
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('classifyConsoleRecord', () => {
  const DEBUG = { severityNumber: 5, severityText: 'DEBUG' }
  const INFO = { severityNumber: 9, severityText: 'INFO' }
  const WARN = { severityNumber: 13, severityText: 'WARN' }
  const ERROR = { severityNumber: 17, severityText: 'ERROR' }

  it('maps each console method to its own severity', async () => {
    const { classifyConsoleRecord } = await freshModule()
    expect(classifyConsoleRecord('debug', 'x')).toEqual(DEBUG)
    expect(classifyConsoleRecord('log', 'x')).toEqual(INFO)
    expect(classifyConsoleRecord('info', 'x')).toEqual(INFO)
    expect(classifyConsoleRecord('warn', 'x')).toEqual(WARN)
    expect(classifyConsoleRecord('error', 'boom: everything is on fire')).toEqual(ERROR)
  })

  it('records a Node deprecation warning at WARN (issue #230)', async () => {
    const { classifyConsoleRecord } = await freshModule()
    const body =
      '(node:1) [DEP0060] DeprecationWarning: The `util._extend` API is deprecated. ' +
      'Please use Object.assign() instead.\n' +
      '(Use `node --trace-deprecation ...` to show where the warning was created)'
    expect(classifyConsoleRecord('error', body)).toEqual({
      ...WARN,
      attributes: { 'grid.severity.reclassified': 'node-process-warning' },
    })
  })

  it('covers the other Node warning shapes, coded and uncoded', async () => {
    const { classifyConsoleRecord } = await freshModule()
    for (const body of [
      '(node:1) ExperimentalWarning: The Fetch API is an experimental feature',
      '(node:1) MaxListenersExceededWarning: Possible EventEmitter memory leak detected',
      '(node:1) Warning: something the app emitted via process.emitWarning',
      '(node:1) [DEP0040] DeprecationWarning: The `punycode` module is deprecated.',
    ]) {
      expect(classifyConsoleRecord('error', body).severityNumber, body).toBe(13)
    }
  })

  it('keeps a real error that merely mentions a warning at ERROR', async () => {
    const { classifyConsoleRecord } = await freshModule()
    for (const body of [
      'TypeError: cannot read (node:1) DeprecationWarning: x',
      'failed to parse a DeprecationWarning: banner',
    ]) {
      expect(classifyConsoleRecord('error', body), body).toEqual(ERROR)
    }
  })

  it('records an expected NotFoundError escaping a render at WARN (issue #262)', async () => {
    const { classifyConsoleRecord } = await freshModule()
    const body =
      '⨯ f: Not found\n' +
      '    at k (.next/server/chunks/ssr/[root-of-the-serve]__156qjxi._.js:1:2004)\n' +
      '    at async p (.next/server/chunks/ssr/[root-of-the-server]__0cd-yw9._.js:1:3864) {\n' +
      "  status: 404, code: 'NOT_FOUND', details: undefined, digest: '3818895446'\n" +
      '}'
    expect(classifyConsoleRecord('error', body)).toEqual({
      ...WARN,
      attributes: { 'grid.severity.reclassified': 'expected-404' },
    })
  })

  it('records a render the browser abandoned as WARN (#578)', async () => {
    const { classifyConsoleRecord } = await freshModule()
    const body = "⨯ Error: The destination stream closed early.\n    at ignore-listed frames {\n  digest: '1392313014'\n}"
    expect(classifyConsoleRecord('error', body)).toEqual({
      ...WARN,
      attributes: { 'grid.severity.reclassified': 'client-disconnect' },
    })
  })

  it('matches #578 as err2issue recorded it, once err2issue\'s own "Error: " prefix is taken off', async () => {
    const { classifyConsoleRecord } = await freshModule()
    const recorded = "Error: ⨯ Error: The destination stream closed early.\n    at ignore-listed frames {\n  digest: '1392313014'\n}"
    const body = recorded.replace(/^Error: /, '')
    expect(classifyConsoleRecord('error', body).attributes).toEqual({ 'grid.severity.reclassified': 'client-disconnect' })
  })

  it('keeps an application error that merely mentions a closed stream at ERROR', async () => {
    const { classifyConsoleRecord } = await freshModule()
    const ERROR = { severityNumber: 17, severityText: 'ERROR' }
    expect(classifyConsoleRecord('error', '[pdf] upload failed: The destination stream closed early.')).toEqual(ERROR)
  })

  it('records a page render the database outage broke as WARN; the API line files the outage', async () => {
    const { classifyConsoleRecord } = await freshModule()
    const body = [
      '⨯ Error: Failed query: select "organization_id", "deleted_at" from "projects" where "projects"."id" = $1 limit $2',
      'params: 38d1bb85-5d06-40a5-b88d-1b74043b11a4,1',
      "  digest: '1660884884',",
      '  [cause]: Error: connect EHOSTUNREACH 10.111.223.83:5432 - Local (0.0.0.0:0)',
      "    errno: -113,\n    code: 'EHOSTUNREACH',",
    ].join('\n')
    expect(classifyConsoleRecord('error', body)).toEqual({
      ...WARN,
      attributes: { 'grid.severity.reclassified': 'database-unavailable-render' },
    })
  })

  it('keeps a page render whose query the database rejected at ERROR', async () => {
    const { classifyConsoleRecord } = await freshModule()
    const ERROR = { severityNumber: 17, severityText: 'ERROR' }
    const body = "⨯ Error: Failed query: insert into x\n  [cause]: PostgresError: duplicate key\n    code: '23505'"
    expect(classifyConsoleRecord('error', body)).toEqual(ERROR)
  })

  it('leaves every other ApiError status and code at ERROR', async () => {
    const { classifyConsoleRecord } = await freshModule()
    for (const envelope of [
      "  status: 502, code: 'UPSTREAM_ERROR', details: undefined",
      "  status: 500, code: 'INTERNAL', details: undefined",
      "  status: 404, code: 'UPSTREAM_ERROR', details: undefined",
      "  status: 403, code: 'FORBIDDEN', details: undefined",
    ]) {
      expect(classifyConsoleRecord('error', `⨯ f: boom {\n${envelope}\n}`), envelope).toEqual(ERROR)
    }
  })
})

describe('initOtelLogs', () => {
  it('no-ops without OTEL_EXPORTER_OTLP_ENDPOINT (capability gate)', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', '')
    const { initOtelLogs } = await freshModule()
    expect(initOtelLogs()).toBe(false)
  })

  it('patches console while preserving output when the endpoint is set', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://otel-collector:4318')
    vi.stubEnv('OTEL_SERVICE_NAME', 'grid-purger')
    const { initOtelLogs } = await freshModule()

    const passthrough = vi.fn()
    const origLog = console.log
    console.log = passthrough
    try {
      expect(initOtelLogs()).toBe(true)
      expect(initOtelLogs()).toBe(false)

      expect(() => console.log('otel bridge smoke %s', 'test')).not.toThrow()
      expect(passthrough).toHaveBeenCalledWith('otel bridge smoke %s', 'test')
    } finally {
      console.log = origLog
    }

    const { logs } = await import('@opentelemetry/api-logs')
    const { LoggerProvider } = await import('@opentelemetry/sdk-logs')
    expect(logs.getLoggerProvider()).toBeInstanceOf(LoggerProvider)
  })

  it('actually exports records end-to-end (regression: SDK 2.x processor ctor)', async () => {
    const http = await import('node:http')
    const received = []
    const server = http.createServer((req, res) => {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        received.push({ url: req.url, body: Buffer.concat(chunks) })
        res.writeHead(200, { 'content-type': 'application/x-protobuf' })
        res.end()
      })
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const { logs } = await import('@opentelemetry/api-logs')
      logs.disable()

      vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', `http://127.0.0.1:${server.address().port}`)
      const { initOtelLogs } = await freshModule()
      expect(initOtelLogs()).toBe(true)

      console.warn('e2e export assertion record')
      await logs.getLoggerProvider().forceFlush()

      expect(received.length).toBeGreaterThan(0)
      expect(received[0].url).toBe('/v1/logs')
      expect(received[0].body.length).toBeGreaterThan(0)
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  }, 15000)

  it('emits the classified severity, not the console method (issues #230, #262)', async () => {
    const { logs } = await import('@opentelemetry/api-logs')
    logs.disable()
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://127.0.0.1:1/v1/logs')
    const { initOtelLogs } = await freshModule()

    const passthrough = vi.fn()
    const origError = console.error
    console.error = passthrough
    try {
      expect(initOtelLogs()).toBe(true)
      const emit = vi.spyOn(logs.getLogger('grid-console'), 'emit')

      console.error('(node:1) [DEP0060] DeprecationWarning: The `util._extend` API is deprecated.')
      console.error("⨯ f: Not found {\n  status: 404, code: 'NOT_FOUND', details: undefined\n}")
      console.error('TypeError: a genuine unhandled failure')

      expect(emit.mock.calls.map(([record]) => record.severityNumber)).toEqual([13, 13, 17])
      expect(emit.mock.calls.map(([record]) => record.attributes)).toEqual([
        { 'grid.severity.reclassified': 'node-process-warning' },
        { 'grid.severity.reclassified': 'expected-404' },
        undefined,
      ])
      expect(passthrough).toHaveBeenCalledTimes(3)
    } finally {
      console.error = origError
    }
  })

  it("records #578 through Next's own error logger at WARN", async () => {
    const { logs } = await import('@opentelemetry/api-logs')
    logs.disable()
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://127.0.0.1:1/v1/logs')
    vi.stubEnv('NO_COLOR', '1')
    const { initOtelLogs } = await freshModule()

    const require = createRequire(import.meta.url)
    for (const id of ['next/dist/lib/picocolors', 'next/dist/build/output/log']) {
      delete require.cache[require.resolve(id)]
    }
    const nextLog = require('next/dist/build/output/log')

    const passthrough = vi.fn()
    const origError = console.error
    console.error = passthrough
    try {
      expect(initOtelLogs()).toBe(true)
      const emit = vi.spyOn(logs.getLogger('grid-console'), 'emit')

      const aborted = Object.assign(new Error('The destination stream closed early.'), { digest: '1392313014' })
      nextLog.error(aborted)

      expect(passthrough).toHaveBeenCalledWith('⨯', aborted)
      const [record] = emit.mock.calls.at(-1)
      expect(record.body.startsWith('⨯ Error: The destination stream closed early.\n')).toBe(true)
      expect(record.severityNumber).toBe(13)
      expect(record.attributes).toEqual({ 'grid.severity.reclassified': 'client-disconnect' })
    } finally {
      console.error = origError
    }
  })
})
