import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  createDeepResearchClient,
  getJobReport,
  getJobStatus,
  type DeepResearchCallbacks,
} from './deep-research-client'
import { ApiRequestError } from './api-error'

class FakeEventSource {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2
  static instances: FakeEventSource[] = []

  url: string
  readyState = FakeEventSource.OPEN
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  private listeners = new Map<string, Array<(event: MessageEvent) => void>>()

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    const list = this.listeners.get(type) ?? []
    list.push(listener)
    this.listeners.set(type, list)
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED
  }

  emit(type: string, data: unknown, lastEventId = ''): void {
    const event = { data: JSON.stringify(data), lastEventId } as MessageEvent
    this.listeners.get(type)?.forEach((listener) => listener(event))
  }
}

const connectWithFakeEventSource = (
  callbacks: DeepResearchCallbacks = {},
  options: { jobId?: string; lastEventId?: string; projectId?: string; conversationId?: string } = {}
) => {
  vi.stubGlobal('EventSource', FakeEventSource)
  const client = createDeepResearchClient({
    jobId: options.jobId ?? 'job-1',
    lastEventId: options.lastEventId,
    projectId: options.projectId,
    conversationId: options.conversationId,
    callbacks,
  })
  client.connect()
  const source = FakeEventSource.instances[FakeEventSource.instances.length - 1]
  return { client, source }
}

describe('deep research SSE client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    FakeEventSource.instances = []
  })

  describe('stream URL construction', () => {
    test('connects to the plain stream URL for a fresh job', () => {
      const { source } = connectWithFakeEventSource()

      expect(source.url).toBe('/api/jobs/async/job/job-1/stream')
    })

    test('names the project and conversation the proxy signs, on a resume too (ADR-0084)', () => {
      const { source } = connectWithFakeEventSource(
        {},
        { lastEventId: '42', projectId: 'project 1', conversationId: 'conv-1' }
      )

      expect(source.url).toBe('/api/jobs/async/job/job-1/stream/42?projectId=project+1&conversationId=conv-1')
    })

    test('resumes from the /stream/{last_event_id} URL when a last event id is provided', () => {
      const { source } = connectWithFakeEventSource({}, { lastEventId: '42' })

      expect(source.url).toBe('/api/jobs/async/job/job-1/stream/42')
    })

    test('tracks received event ids so a later connect resumes instead of replaying', () => {
      const { client, source } = connectWithFakeEventSource()

      source.emit('tool.start', { name: 'web_search' }, '17')

      expect(client.getLastEventId()).toBe('17')

      client.disconnect()
      client.connect()
      const resumed = FakeEventSource.instances[FakeEventSource.instances.length - 1]
      expect(resumed.url).toBe('/api/jobs/async/job/job-1/stream/17')
    })
  })

  describe('reopening a stream the browser closed', () => {
    const closeLikeTheBrowser = (source: FakeEventSource) => {
      source.readyState = FakeEventSource.CLOSED
      source.onerror?.()
    }
    const latest = () => FakeEventSource.instances[FakeEventSource.instances.length - 1]

    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    test('reopens from the last event id instead of reporting the stream lost', () => {
      const onDisconnect = vi.fn()
      const onReconnecting = vi.fn()
      const { source } = connectWithFakeEventSource({ onDisconnect, onReconnecting })
      source.emit('tool.start', { name: 'web_search' }, '17')

      closeLikeTheBrowser(source)
      expect(onReconnecting).toHaveBeenCalledWith(1)
      vi.advanceTimersByTime(1_000)

      expect(latest()).not.toBe(source)
      expect(latest().url).toBe('/api/jobs/async/job/job-1/stream/17')
      expect(onDisconnect).not.toHaveBeenCalled()
    })

    test('backs off between failed reopens and starts over once one opens', () => {
      const { source } = connectWithFakeEventSource()
      closeLikeTheBrowser(source)
      vi.advanceTimersByTime(1_000)
      closeLikeTheBrowser(latest())
      vi.advanceTimersByTime(1_999)
      const beforeSecondWait = FakeEventSource.instances.length
      vi.advanceTimersByTime(1)
      expect(FakeEventSource.instances.length).toBe(beforeSecondWait + 1)

      latest().onopen?.()
      closeLikeTheBrowser(latest())
      const beforeReset = FakeEventSource.instances.length
      vi.advanceTimersByTime(1_000)
      expect(FakeEventSource.instances.length).toBe(beforeReset + 1)
    })

    test('reopens at once when the server says it is shutting down', () => {
      const { source } = connectWithFakeEventSource()
      source.emit('tool.start', { name: 'web_search' }, '30')

      source.emit('job.shutdown', { message: 'Server shutting down' }, '30')
      vi.advanceTimersByTime(250)

      expect(latest()).not.toBe(source)
      expect(latest().url).toBe('/api/jobs/async/job/job-1/stream/30')
    })

    test('reports the stream lost only after reopens have failed for two minutes', () => {
      const onDisconnect = vi.fn()
      connectWithFakeEventSource({ onDisconnect })
      for (let elapsed = 0; elapsed < 125_000; elapsed += 1_000) {
        if (latest().readyState !== FakeEventSource.CLOSED) closeLikeTheBrowser(latest())
        vi.advanceTimersByTime(1_000)
      }
      expect(onDisconnect).toHaveBeenCalledTimes(1)
    })

    test('does not reopen a run that has finished', () => {
      const onComplete = vi.fn()
      const { source } = connectWithFakeEventSource({ onComplete })
      source.emit('job.status', { status: 'success' })
      const opened = FakeEventSource.instances.length

      closeLikeTheBrowser(source)
      vi.advanceTimersByTime(20_000)

      expect(FakeEventSource.instances.length).toBe(opened)
    })

    test('a disconnect cancels a pending reopen', () => {
      const { client, source } = connectWithFakeEventSource()
      closeLikeTheBrowser(source)
      const opened = FakeEventSource.instances.length

      client.disconnect()
      vi.advanceTimersByTime(20_000)

      expect(FakeEventSource.instances.length).toBe(opened)
    })
  })

  describe('job.status handling', () => {
    test('fires onError with a fallback message when a failure carries no error string', () => {
      const onJobStatus = vi.fn()
      const onError = vi.fn()
      const { source } = connectWithFakeEventSource({ onJobStatus, onError })

      source.emit('job.status', { data: { status: 'failure' } })

      expect(onJobStatus).toHaveBeenCalledWith('failure', undefined)
      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError.mock.calls[0][0]).toBeInstanceOf(Error)
      expect((onError.mock.calls[0][0] as Error).message).toBe('Job failure')
    })

    test('does not fire onError for user-initiated cancellations', () => {
      const onError = vi.fn()
      const onJobStatus = vi.fn()
      const { source } = connectWithFakeEventSource({ onJobStatus, onError })

      source.emit('job.status', { data: { status: 'interrupted', error: 'Job cancelled by user' } })

      expect(onJobStatus).toHaveBeenCalledWith('interrupted', 'Job cancelled by user')
      expect(onError).not.toHaveBeenCalled()
    })

    test('ignores job.status events with a missing or invalid status', () => {
      const onJobStatus = vi.fn()
      const onComplete = vi.fn()
      const onError = vi.fn()
      const { source } = connectWithFakeEventSource({ onJobStatus, onComplete, onError })

      source.emit('job.status', { data: {} })
      source.emit('job.status', { data: { status: 'exploded' } })

      expect(onJobStatus).not.toHaveBeenCalled()
      expect(onComplete).not.toHaveBeenCalled()
      expect(onError).not.toHaveBeenCalled()
    })
  })

  describe('run.ledger handling', () => {
    const ledger = {
      runId: 'run-1',
      status: 'running',
      phases: [{ phase: 'researching', startedAt: '2026-09-16T08:00:00Z' }],
      steps: [],
      startedAt: '2026-09-16T08:00:00Z',
      updatedAt: '2026-09-16T08:00:05Z',
    }

    test('hands the snapshot over unparsed, from under `data` or flat', () => {
      const onLedger = vi.fn()
      const { source } = connectWithFakeEventSource({ onLedger })

      source.emit('run.ledger', { data: { ledger } })
      source.emit('run.ledger', { ledger })

      expect(onLedger).toHaveBeenCalledTimes(2)
      expect(onLedger.mock.calls[0][0]).toEqual(ledger)
      expect(onLedger.mock.calls[1][0]).toEqual(ledger)
    })

    test('ignores an event that carries no ledger', () => {
      const onLedger = vi.fn()
      const { source } = connectWithFakeEventSource({ onLedger })

      source.emit('run.ledger', { data: {} })

      expect(onLedger).not.toHaveBeenCalled()
    })
  })

  describe('job.phase handling', () => {
    test('reaches onPhase through a registered listener', () => {
      const onPhase = vi.fn()
      const { source } = connectWithFakeEventSource({ onPhase })

      source.emit('job.phase', { data: { phase: 'research_started', batch_index: 1 } })

      expect(onPhase).toHaveBeenCalledWith('research_started', { phase: 'research_started', batch_index: 1 })
    })
  })
})

describe('deep research REST client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('includes proxy error details when job status lookup fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 'PROXY_ERROR',
              message: 'fetch failed',
            },
          }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      )
    )

    await expect(getJobStatus('job-1')).rejects.toThrow(
      'Failed to get job status: 500 - PROXY_ERROR: fetch failed'
    )
  })

  test('attaches the HTTP status to thrown errors for structural classification', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('gone', { status: 404 }))
    )

    const error = await getJobStatus('job-1').catch((err: unknown) => err)

    expect(error).toBeInstanceOf(ApiRequestError)
    expect((error as ApiRequestError).status).toBe(404)
  })
})

describe('report filing, as it crosses the wire', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const reportBody = (extra: Record<string, unknown>): void => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ job_id: 'job-1', has_report: true, report: '# Bericht', ...extra }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
    )
  }

  test('carries a broken filing promise through to the caller', async () => {
    reportBody({ filingFailed: true })

    const response = await getJobReport('job-1', undefined, { projectId: 'proj-1' })

    expect(response.filingFailed).toBe(true)
    expect(response.filed).toBeUndefined()
    expect(response.report).toBe('# Bericht')
  })

  test('reports no failure when the server claimed none', async () => {
    reportBody({})

    const response = await getJobReport('job-1', undefined, { projectId: 'proj-1' })

    expect(response.filingFailed).toBeUndefined()
  })

  test('carries the numbered sources through the rebuild', async () => {
    const source = { file_name: 'oib-rl_2_ausgabe_mai_2023.pdf', page: 7, number: 3 }
    reportBody({ sources: [source] })

    const response = await getJobReport('job-1')

    expect(response.sources).toEqual([source])
  })

  test('drops a malformed or empty sources value rather than the report', async () => {
    reportBody({ sources: 'not-a-list' })
    expect((await getJobReport('job-1')).sources).toBeUndefined()

    reportBody({ sources: [] })
    expect((await getJobReport('job-1')).sources).toBeUndefined()
  })

  test('believes only a real boolean', async () => {
    reportBody({ filingFailed: 'yes' })

    const response = await getJobReport('job-1', undefined, { projectId: 'proj-1' })

    expect(response.filingFailed).toBeUndefined()
  })
})
