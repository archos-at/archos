/**
 * @vitest-environment node
 */
/**
 * A proposed memory note carries its topic into the write the decider's accept
 * runs, and the topic lands on the shelf the note goes to, resolved as any
 * create resolves it: an office note against the office's topics here (the
 * office create does not resolve), a project note inside the project's create.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const officeRows = vi.hoisted(() => ({ rows: [] as { topic: string | null }[] }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/conversations/cross-project-use', () => ({ requireMayRememberFrom: vi.fn(async () => undefined) }))
vi.mock('@/lib/conversations/restricted-egress', () => ({ requireMayLeaveConversation: vi.fn(async () => undefined) }))
vi.mock('@/lib/conversations/temporary', () => ({ requireConversationKeepsMemory: vi.fn(async () => undefined) }))
vi.mock('@/lib/sharing/access', () => ({ requireResourceAccess: vi.fn(async () => undefined) }))
vi.mock('@/lib/project-profile/profile-service', () => ({ patchProjectProfile: vi.fn(async () => undefined) }))
vi.mock('@/lib/projects/service', () => ({
  addProjectMemoryItem: vi.fn(async () => ({ id: 'mem_project' })),
  createOrganizationMemoryItem: vi.fn(async () => ({ id: 'mem_office' })),
}))
// The office shelf's open topics: the one query `withOfficeTopic` reads (`openOfficeTopicRows`).
vi.mock('@/lib/db', () => ({
  getDb: () => ({ select: () => ({ from: () => ({ where: async () => officeRows.rows }) }) }),
}))

import type { AuthorizedSession } from '@/lib/auth/types'
import { addProjectMemoryItem, createOrganizationMemoryItem } from '@/lib/projects/service'
import { applyMemory, type ApplyContext } from './appliers'
import type { MemoryPayload } from './types'

const SESSION = { userId: 'user_anna', organizationId: 'org_1' } as AuthorizedSession

const context = (overrides: Partial<ApplyContext> = {}): ApplyContext => ({
  session: SESSION,
  projectId: 'proj_1',
  request: new Request('https://workspace.test/api/proposals/p/apply'),
  originConversationId: null,
  locale: 'de',
  ...overrides,
})

const note = (overrides: Partial<MemoryPayload> = {}): MemoryPayload => ({
  scope: 'project',
  kind: 'decision',
  content: 'Brandschutzkonzept liegt vor.',
  confidence: 'high',
  ...overrides,
})

/** The note the office create received: its arguments are (session, input, options). */
const officeNoteSent = () => vi.mocked(createOrganizationMemoryItem).mock.calls[0][1]

beforeEach(() => {
  vi.clearAllMocks()
  officeRows.rows = []
})

describe('applying a proposed memory note: its topic', () => {
  it('sends a project note’s topic to the project create, which resolves it against the project shelf', async () => {
    await applyMemory(note({ topic: 'Brandschutz' }), context())

    expect(addProjectMemoryItem).toHaveBeenCalledWith(
      SESSION,
      'proj_1',
      expect.objectContaining({ topic: 'Brandschutz' }),
      { supersedesContent: null }
    )
    expect(createOrganizationMemoryItem).not.toHaveBeenCalled()
  })

  // The office create resolves the spelling itself (`createOrganizationMemoryItem`), so the applier hands the topic on as named.
  it('hands an office note’s topic to the office create, which resolves it', async () => {
    await applyMemory(note({ scope: 'organization', topic: 'BRANDSCHUTZ' }), context())

    expect(createOrganizationMemoryItem).toHaveBeenCalledWith(
      SESSION,
      expect.objectContaining({ topic: 'BRANDSCHUTZ' }),
      { supersedesContent: null }
    )
    expect(addProjectMemoryItem).not.toHaveBeenCalled()
  })

  it('sends no topic when the note names none, so the create files it under none', async () => {
    await applyMemory(note({ scope: 'organization' }), context())

    expect(officeNoteSent().topic).toBeUndefined()
  })

  it('keeps the topic when the decider files an office note in the project instead', async () => {
    await applyMemory(note({ scope: 'organization', topic: 'Brandschutz' }), context({ memoryScope: 'project' }))

    expect(addProjectMemoryItem).toHaveBeenCalledWith(SESSION, 'proj_1', expect.objectContaining({ topic: 'Brandschutz' }), {
      supersedesContent: null,
    })
    expect(createOrganizationMemoryItem).not.toHaveBeenCalled()
  })
})
