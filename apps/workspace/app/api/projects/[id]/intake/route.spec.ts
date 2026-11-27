/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'


const SESSION = vi.hoisted(() => ({
  userId: 'user_1',
  organizationId: 'org_1',
  organizationMembershipId: 'om_1',
  email: 'anna@example.test',
  name: 'Anna Berger',
  role: 'member',
  permissions: [] as string[],
}))

vi.mock('@/lib/auth/require-auth', () => ({ requireAuthorizedSession: vi.fn(async () => SESSION) }))
vi.mock('@/lib/project-intake/service', () => ({
  getIntakeView: vi.fn(),
  startIntakeRun: vi.fn(),
  applyIntakeDecisions: vi.fn(),
  applyBuildingOperation: vi.fn(),
  completeIntake: vi.fn(),
}))

import { ConflictError, NotFoundError } from '@/lib/api/errors'
import { createProjectIntakeClient, ProjectIntakeRequestError } from '@/lib/project-intake/client'
import { applyBuildingOperation, applyIntakeDecisions, completeIntake, getIntakeView, startIntakeRun } from '@/lib/project-intake/service'
import type { IntakeView } from '@/lib/project-intake/types'
import { GET, POST as start } from './route'
import { POST as decide } from './decisions/route'
import { POST as changeBuilding } from './buildings/route'
import { POST as complete } from './complete/route'

type Handler = (request: Request, context?: { params?: Promise<Record<string, string>> }) => Promise<Response>

const ROUTES: Array<{ pattern: RegExp; method: string; handler: Handler }> = [
  { pattern: /^\/api\/projects\/([^/]+)\/intake$/, method: 'GET', handler: GET },
  { pattern: /^\/api\/projects\/([^/]+)\/intake$/, method: 'POST', handler: start },
  { pattern: /^\/api\/projects\/([^/]+)\/intake\/decisions$/, method: 'POST', handler: decide },
  { pattern: /^\/api\/projects\/([^/]+)\/intake\/buildings$/, method: 'POST', handler: changeBuilding },
  { pattern: /^\/api\/projects\/([^/]+)\/intake\/complete$/, method: 'POST', handler: complete },
]

const run = async (path: string, init?: RequestInit) => {
  const url = new URL(path, 'https://grid.test')
  const method = init?.method ?? 'GET'
  const route = ROUTES.find((entry) => entry.pattern.test(url.pathname) && entry.method === method)
  if (!route) throw new Error(`no route for ${method} ${url.pathname}`)
  const matched = route.pattern.exec(url.pathname) as RegExpExecArray
  return route.handler(new Request(url, init), { params: Promise.resolve({ id: decodeURIComponent(matched[1]) }) })
}

const client = createProjectIntakeClient(run)

const PROJECT = '6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f'

const VIEW: IntakeView = {
  projectId: PROJECT,
  status: 'ready',
  mode: 'active',
  description: 'Wohnhausanlage',
  location: null,
  closing: null,
  counts: { documentsRead: 2, unreadDocuments: 0, suggested: 1, contradictions: 0, decisiveOpen: 1 },
  readingStartedAt: '2026-10-14T09:00:00.000Z',
  readingFinishedAt: '2026-10-14T09:04:00.000Z',
  summary: 'Zwei Pläne gelesen.',
  contradictions: [],
  openQuestions: [],
  questions: [
    {
      key: 'escape_level_m@bldg1',
      baseKey: 'escape_level_m',
      buildingId: 'bldg1',
      label: 'Fluchtniveau (Zielzustand)',
      type: 'number_tri',
      unit: 'm',
      foundIn: ['Schnitt'],
      decisive: true,
      state: 'open',
    },
  ],
  groups: [
    {
      stage: 'C',
      title: 'Bauwerk',
      items: [
        {
          key: 'building_type@bldg1',
          baseKey: 'building_type',
          buildingId: 'bldg1',
          label: 'Bauwerkstyp',
          value: 'building',
          display: 'Gebäude',
          state: 'suggested',
          evidence: [{ kind: 'document', fileName: 'Einreichplan.pdf', page: 2, quote: 'Wohngebäude' }],
          alternatives: [],
          decisive: false,
        },
      ],
    },
  ],
  derivations: [],
  buildings: [{ id: 'bldg1', name: 'Bauwerk 1' }],
  canDecide: true,
  canComplete: true,
  readingProgress: {
    documentsOpened: 0,
    documentsTotal: 0,
    site: { federalState: null, municipality: null, address: null, source: null, confirmed: false },
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getIntakeView).mockResolvedValue(VIEW)
  vi.mocked(startIntakeRun).mockResolvedValue({ ...VIEW, status: 'reading' })
  vi.mocked(applyIntakeDecisions).mockResolvedValue({ results: [{ key: 'building_type@bldg1', ok: true }], intake: VIEW })
  vi.mocked(completeIntake).mockResolvedValue({ ...VIEW, status: 'completed', canComplete: false })
})

describe('GET /api/projects/[id]/intake', () => {
  it('answers the review as the client parses it, for the caller', async () => {
    expect(await client.get(PROJECT)).toEqual(VIEW)
    expect(getIntakeView).toHaveBeenCalledWith(SESSION, PROJECT)
  })

  it('passes a 404 through as a typed error', async () => {
    vi.mocked(getIntakeView).mockRejectedValue(new NotFoundError())
    await expect(client.get(PROJECT)).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' })
  })
})

describe('POST /api/projects/[id]/intake', () => {
  it('starts a reading with its scope', async () => {
    expect((await client.start(PROJECT, { scope: 'all' })).status).toBe('reading')
    expect(startIntakeRun).toHaveBeenCalledWith(SESSION, PROJECT, { scope: 'all' })
  })

  it('refuses a scope it does not know, and any other field', async () => {
    const unknown = await run(`/api/projects/${PROJECT}/intake`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: 'everything' }),
    })
    expect(unknown.status).toBe(400)
    const extra = await run(`/api/projects/${PROJECT}/intake`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: 'new', projectId: 'other' }),
    })
    expect(extra.status).toBe(400)
    expect(startIntakeRun).not.toHaveBeenCalled()
  })

  it('carries the refusal’s reason to the client', async () => {
    vi.mocked(startIntakeRun).mockRejectedValue(new ConflictError('closed', { reason: 'project-closed' }))
    const refused = client.start(PROJECT, { scope: 'new' })
    await expect(refused).rejects.toBeInstanceOf(ProjectIntakeRequestError)
    await expect(refused).rejects.toMatchObject({ status: 409, code: 'CONFLICT', reason: 'project-closed' })
  })
})

describe('POST /api/projects/[id]/intake/decisions', () => {
  it('applies the decisions and answers a result each and the review after them', async () => {
    const answer = await client.decide(PROJECT, [
      { key: 'building_type@bldg1', action: 'confirm' },
      { key: 'escape_level_m@bldg1', action: 'answer', value: 7.2 },
    ])

    expect(answer).toEqual({ results: [{ key: 'building_type@bldg1', ok: true }], intake: VIEW })
    expect(applyIntakeDecisions).toHaveBeenCalledWith(SESSION, PROJECT, [
      { key: 'building_type@bldg1', action: 'confirm' },
      { key: 'escape_level_m@bldg1', action: 'answer', value: 7.2 },
    ])
  })

  it('refuses an empty batch and a decision of the wrong shape', async () => {
    await expect(client.decide(PROJECT, [])).rejects.toMatchObject({ status: 400 })
    const wrong = await run(`/api/projects/${PROJECT}/intake/decisions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decisions: [{ key: 'x', action: 'confirm', value: 3 }] }),
    })
    expect(wrong.status).toBe(400)
    expect(applyIntakeDecisions).not.toHaveBeenCalled()
  })
})

describe('POST /api/projects/[id]/intake/buildings', () => {
  beforeEach(() => {
    vi.mocked(applyBuildingOperation).mockResolvedValue({ buildingId: 'bldg2', intake: VIEW })
  })

  it('applies one building operation and answers the building and the review after it', async () => {
    expect(await client.changeBuilding(PROJECT, { action: 'add' })).toEqual({ buildingId: 'bldg2', intake: VIEW })
    expect(applyBuildingOperation).toHaveBeenCalledWith(SESSION, PROJECT, { action: 'add' })

    await client.changeBuilding(PROJECT, { action: 'rename', buildingId: 'bldg2', name: '  Turm B ' })
    expect(applyBuildingOperation).toHaveBeenLastCalledWith(SESSION, PROJECT, {
      action: 'rename',
      buildingId: 'bldg2',
      name: 'Turm B',
    })
  })

  it('refuses a name that is empty, a building id of another shape and an unknown action', async () => {
    const send = (operation: unknown) =>
      run(`/api/projects/${PROJECT}/intake/buildings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operation }),
      })
    expect((await send({ action: 'rename', buildingId: 'bldg2', name: '   ' })).status).toBe(400)
    expect((await send({ action: 'remove', buildingId: 'storeys_above_ground' })).status).toBe(400)
    expect((await send({ action: 'merge', buildingId: 'bldg2' })).status).toBe(400)
    expect(applyBuildingOperation).not.toHaveBeenCalled()
  })

  it('carries the refusal to remove the last building to the client', async () => {
    vi.mocked(applyBuildingOperation).mockRejectedValue(new ConflictError('last', { reason: 'last-building' }))
    await expect(client.changeBuilding(PROJECT, { action: 'remove', buildingId: 'bldg1' })).rejects.toMatchObject({
      status: 409,
      reason: 'last-building',
    })
  })
})

describe('POST /api/projects/[id]/intake/complete', () => {
  it('finishes the review and answers it', async () => {
    expect((await client.complete(PROJECT)).status).toBe('completed')
    expect(completeIntake).toHaveBeenCalledWith(SESSION, PROJECT, expect.any(Request))
  })
})
