/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/runs/service', () => ({ applyRunLedgerOp: vi.fn() }))

import { NotFoundError } from '@/lib/api/errors'
import { applyRunLedgerOp } from '@/lib/runs/service'
import { createRunLedgerClient, RunLedgerError } from '@/lib/runs/run-ledger-client'
import { emptyRunLedger } from '@/lib/runs/run-ledger'
import { POST } from './route'

const SECRET = 'internal-token-for-tests' // pragma: allowlist secret
const RUN = '6f1a0f7e-2b1f-4a4e-9a4e-2f0f1a6d9c31'
const T0 = new Date('2026-09-16T08:00:00.000Z')

const LEDGER = emptyRunLedger(RUN, T0)

const PATTERN = /^\/api\/internal\/runs\/([^/]+)\/ledger$/

function transport(headers: Record<string, string>) {
  return async (path: string, init?: RequestInit) => {
    const url = new URL(path, 'https://example.test')
    const matched = PATTERN.exec(url.pathname)
    if (!matched) throw new Error(`no route for ${url.pathname}`)
    const request = new Request(url, {
      ...init,
      headers: { ...(init?.headers as Record<string, string>), ...headers },
    })
    return POST(request, { params: Promise.resolve({ runId: matched[1] }) })
  }
}

const client = createRunLedgerClient(transport({ 'x-grid-internal-token': SECRET }))
const anonymous = createRunLedgerClient(transport({}))

function call(body: unknown, headers: Record<string, string> = { 'x-grid-internal-token': SECRET }) {
  return POST(
    new Request(`https://example.test/api/internal/runs/${RUN}/ledger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ runId: RUN }) },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('INTERNAL_API_TOKEN', SECRET)
  vi.mocked(applyRunLedgerOp).mockResolvedValue({ runId: RUN, ledger: LEDGER })
})

describe('POST /api/internal/runs/[runId]/ledger', () => {
  it('appends what the client sent, under the run id from the PATH', async () => {
    const step = {
      id: 'batch-1',
      phase: 'researching' as const,
      intent: 'OIB-2 auf Fluchtwegbreiten prüfen',
      startedAt: T0.toISOString(),
      docs: [],
    }

    await expect(client.append(RUN, { steps: [step], status: 'running' })).resolves.toEqual({
      runId: RUN,
      ledger: LEDGER,
    })
    expect(applyRunLedgerOp).toHaveBeenCalledWith(RUN, {
      op: 'append',
      steps: [step],
      status: 'running',
    })
  })

  it('finishes with a result, and with an error', async () => {
    await client.finish(RUN, { result: { filedAt: T0.toISOString(), fileId: 'doc-1' } })
    expect(applyRunLedgerOp).toHaveBeenLastCalledWith(RUN, {
      op: 'finish',
      result: { filedAt: T0.toISOString(), fileId: 'doc-1' },
    })

    await client.finish(RUN, { error: { reason: 'Der Anbieter hat abgebrochen.' } })
    expect(applyRunLedgerOp).toHaveBeenLastCalledWith(RUN, {
      op: 'finish',
      error: { reason: 'Der Anbieter hat abgebrochen.' },
    })
  })

  it('sends nothing it was not given', async () => {
    await client.append(RUN, {})
    expect(applyRunLedgerOp).toHaveBeenCalledWith(RUN, { op: 'append' })
  })

  it('refuses a request without the service token, before the service is reached', async () => {
    await expect(anonymous.append(RUN, {})).rejects.toBeInstanceOf(RunLedgerError)
    expect(applyRunLedgerOp).not.toHaveBeenCalled()
  })

  it('closes the op set at two', async () => {
    const response = await call({ op: 'cancel' })
    expect(response.status).toBe(400)
    expect(applyRunLedgerOp).not.toHaveBeenCalled()
  })

  it('refuses a body that names its own run', async () => {
    const response = await call({ op: 'append', runId: 'some-other-run' })
    expect(response.status).toBe(400)
    expect(applyRunLedgerOp).not.toHaveBeenCalled()
  })

  it('refuses a step that names a tool', async () => {
    const response = await call({
      op: 'append',
      steps: [
        {
          id: 'batch-1',
          phase: 'researching',
          intent: 'OIB-2 prüfen',
          startedAt: T0.toISOString(),
          docs: [],
          tool: 'search_norms',
        },
      ],
    })
    expect(response.status).toBe(400)
  })

  it('hands a refusal to the caller as a typed error it can act on', async () => {
    vi.mocked(applyRunLedgerOp).mockRejectedValue(new NotFoundError('Unknown run'))

    await expect(client.append(RUN, {})).rejects.toMatchObject({
      name: 'RunLedgerError',
      status: 404,
      code: 'NOT_FOUND',
    })
  })
})
