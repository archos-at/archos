/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dbRows: unknown[] = []

function makeBuilder() {
  const builder = {
    select: () => builder,
    from: () => builder,
    where: () => builder,
    limit: () => Promise.resolve(dbRows),
  }
  return builder
}

vi.mock('@/lib/db', () => ({ getDb: () => makeBuilder() }))
vi.mock('@/lib/db/schema/projects', () => ({
  projects: { id: 'id', profile: 'profile', profilePromptView: 'profilePromptView' },
}))

const rowsByOrg = new Map<string, { profile: unknown; profilePromptView: string }>()
let rolesSection = ''
const rolesReaders: unknown[] = []
vi.mock('@/lib/document-roles/prompt-loader', () => ({
  loadDocumentRolesPromptSection: async (...args: unknown[]) => {
    rolesReaders.push(args[2] ?? null)
    return args[2] ? `${rolesSection}\n- Honorarvertrag: Honorarnote.pdf` : rolesSection
  },
}))

let unreadableSection = ''
const unreadableCalls: { projectId: string; organizationId: string | null | undefined }[] = []
vi.mock('./unreadable-section', () => ({
  loadUnreadableDocumentsSection: async (
    projectId: string,
    organizationId: string | null | undefined
  ) => {
    unreadableCalls.push({ projectId, organizationId })
    return unreadableSection
  },
}))

vi.mock('@/lib/projects/repository', () => ({
  findProjectPromptView: async (_projectId: string, organizationId: string | null | undefined) =>
    rowsByOrg.get(organizationId ?? 'anon')?.profilePromptView ??
    (dbRows[0] as { profilePromptView?: string })?.profilePromptView ??
    null,
  findProjectProfile: async (_projectId: string, organizationId: string | null | undefined) =>
    rowsByOrg.get(organizationId ?? 'anon')?.profile ??
    (dbRows[0] as { profile?: unknown })?.profile ??
    null,
  findProjectProfileInOrg: async (_projectId: string, organizationId: string) => {
    const profile = rowsByOrg.get(organizationId)?.profile ?? (dbRows[0] as { profile?: unknown })?.profile
    return profile ? { profile, profileVersion: 1 } : null
  },
}))

let gateState = 'core'
vi.mock('@/lib/base-knowledge/context/service', () => ({
  contextForPage: async () => ({ gate: { state: gateState, reason: null, leaves: [] } }),
}))

import { setCacheStore, type CacheStore } from '@/lib/cache'
import {
  invalidateProjectProfileCaches,
  invalidateProjectPromptViewCache,
  loadProjectFederalState,
  loadProjectPromptView,
} from './prompt-view'

class TestStore implements CacheStore {
  readonly map = new Map<string, { value: string; expiresAt: number }>()
  async get(key: string) {
    const entry = this.map.get(key)
    if (!entry) return null
    if (Date.now() >= entry.expiresAt) {
      this.map.delete(key)
      return null
    }
    return entry.value
  }
  async set(key: string, value: string, ttlMs: number) {
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs })
  }
  async delete(key: string) {
    this.map.delete(key)
  }
  async deletePrefix(prefix: string) {
    for (const key of this.map.keys()) if (key.startsWith(prefix)) this.map.delete(key)
  }
}

const rowFor = (federalState: string, promptView: string) => [
  {
    profile: {
      facts: { federal_state: { value: federalState } },
      goals: {},
      unknowns: [],
      assumptions: {},
    },
    profilePromptView: promptView,
  },
]

describe('project profile cache invalidation (Fix 1)', () => {
  let store: TestStore

  beforeEach(() => {
    store = new TestStore()
    setCacheStore(store)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('appends the document-roles block to the stored view', async () => {
    dbRows = rowFor('vienna', 'PROJECT_CONTEXT v1')
    rolesSection = 'documents:\n- Bebauungsplan: bplan.pdf'

    const view = await loadProjectPromptView('proj-1', 'org-1')
    expect(view).toBe('PROJECT_CONTEXT v1\n\ndocuments:\n- Bebauungsplan: bplan.pdf')
    rolesSection = ''
  })

  it('returns the stored view unchanged when a project has no document roles', async () => {
    dbRows = rowFor('vienna', 'PROJECT_CONTEXT v1')
    expect(await loadProjectPromptView('proj-1', 'org-1')).toBe('PROJECT_CONTEXT v1')
  })

  it('caches both the prompt view and the structured bundesland under their own keys', async () => {
    dbRows = rowFor('vienna', 'PROJECT_CONTEXT v1')

    expect(await loadProjectFederalState('proj-1', 'org-1')).toBe('vienna')
    expect(await loadProjectPromptView('proj-1', 'org-1')).toBe('PROJECT_CONTEXT v1')

    expect(store.map.has('federal-state:org-1:proj-1')).toBe(true)
    expect(store.map.has('promptview-v2:org-1:proj-1')).toBe(true)
  })

  it('reproduces the bug: prompt-view-only invalidation leaves bundesland stale', async () => {
    dbRows = rowFor('vienna', 'PROJECT_CONTEXT v1')
    await loadProjectFederalState('proj-1', 'org-1')
    await loadProjectPromptView('proj-1', 'org-1')

    dbRows = rowFor('tyrol', 'PROJECT_CONTEXT v2')

    await invalidateProjectPromptViewCache('proj-1', 'org-1')

    expect(await loadProjectPromptView('proj-1', 'org-1')).toBe('PROJECT_CONTEXT v2')
    expect(await loadProjectFederalState('proj-1', 'org-1')).toBe('vienna') // stale — the bug
  })

  it('the fix: invalidateProjectProfileCaches drops BOTH keys so neither goes stale', async () => {
    dbRows = rowFor('vienna', 'PROJECT_CONTEXT v1')
    await loadProjectFederalState('proj-1', 'org-1')
    await loadProjectPromptView('proj-1', 'org-1')

    dbRows = rowFor('tyrol', 'PROJECT_CONTEXT v2')

    await invalidateProjectProfileCaches('proj-1', 'org-1')

    expect(store.map.has('federal-state:org-1:proj-1')).toBe(false)
    expect(store.map.has('promptview-v2:org-1:proj-1')).toBe(false)
    expect(await loadProjectFederalState('proj-1', 'org-1')).toBe('tyrol')
    expect(await loadProjectPromptView('proj-1', 'org-1')).toBe('PROJECT_CONTEXT v2')
  })
})

describe('project profile cache is partitioned by tenant', () => {
  let store: TestStore

  beforeEach(() => {
    store = new TestStore()
    setCacheStore(store)
    rowsByOrg.clear()
    dbRows = []
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('does not serve one organization the project context cached for another', async () => {
    rowsByOrg.set('org-a', {
      profile: {
        facts: { federal_state: { value: 'vienna' } },
        goals: {},
        unknowns: [],
        assumptions: {},
      },
      profilePromptView: 'ORG A CONTEXT',
    })
    rowsByOrg.set('org-b', {
      profile: {
        facts: { federal_state: { value: 'tyrol' } },
        goals: {},
        unknowns: [],
        assumptions: {},
      },
      profilePromptView: 'ORG B CONTEXT',
    })

    expect(await loadProjectPromptView('proj-1', 'org-a')).toBe('ORG A CONTEXT')
    expect(await loadProjectPromptView('proj-1', 'org-b')).toBe('ORG B CONTEXT')

    expect(await loadProjectFederalState('proj-1', 'org-a')).toBe('vienna')
    expect(await loadProjectFederalState('proj-1', 'org-b')).toBe('tyrol')
  })

  it('does not serve an anonymous caller the context cached for a tenant', async () => {
    rowsByOrg.set('org-a', {
      profile: {
        facts: { federal_state: { value: 'vienna' } },
        goals: {},
        unknowns: [],
        assumptions: {},
      },
      profilePromptView: 'ORG A CONTEXT',
    })
    rowsByOrg.set('anon', {
      profile: {
        facts: { federal_state: { value: 'tyrol' } },
        goals: {},
        unknowns: [],
        assumptions: {},
      },
      profilePromptView: 'ANON CONTEXT',
    })

    expect(await loadProjectPromptView('proj-1', 'org-a')).toBe('ORG A CONTEXT')
    expect(await loadProjectPromptView('proj-1', null)).toBe('ANON CONTEXT')
  })

  it('a write evicts the anonymous variant as well as its own', async () => {
    rowsByOrg.set('org-a', {
      profile: {
        facts: { federal_state: { value: 'vienna' } },
        goals: {},
        unknowns: [],
        assumptions: {},
      },
      profilePromptView: 'BEFORE',
    })
    rowsByOrg.set('anon', {
      profile: {
        facts: { federal_state: { value: 'vienna' } },
        goals: {},
        unknowns: [],
        assumptions: {},
      },
      profilePromptView: 'BEFORE',
    })
    await loadProjectPromptView('proj-1', 'org-a')
    await loadProjectPromptView('proj-1', null)
    await loadProjectFederalState('proj-1', 'org-a')

    await invalidateProjectProfileCaches('proj-1', 'org-a')

    expect(store.map.has('promptview-v2:org-a:proj-1')).toBe(false)
    expect(store.map.has('promptview:anon:proj-1')).toBe(false)
    expect(store.map.has('federal-state:org-a:proj-1')).toBe(false)
  })
})

describe('restricted folders and the shared prompt view (ADR-0087)', () => {
  let store: TestStore

  beforeEach(() => {
    store = new TestStore()
    setCacheStore(store)
    rolesReaders.length = 0
    rolesSection = 'documents:\n- Bebauungsplan: bplan.pdf'
  })

  afterEach(() => {
    rolesSection = ''
  })

  it('builds the cached view for nobody in particular', async () => {
    dbRows = rowFor('vienna', 'PROJECT_CONTEXT v1')
    const view = await loadProjectPromptView('proj-1', 'org-1')

    expect(rolesReaders).toEqual([null])
    expect(view).not.toContain('Honorarnote.pdf')
  })

  it('builds the same shared view for every chat: listing a restricted document is not using it', async () => {
    dbRows = rowFor('vienna', 'PROJECT_CONTEXT v1')

    expect(await loadProjectPromptView('proj-1', 'org-1')).not.toContain('Honorarnote.pdf')
    expect(await loadProjectPromptView('proj-1', 'org-1')).not.toContain('Honorarnote.pdf')
    expect(rolesReaders).toEqual([null])
  })
})

describe('unreadable documents ride beside the cached view', () => {
  let store: TestStore

  beforeEach(() => {
    store = new TestStore()
    setCacheStore(store)
    rolesReaders.length = 0
    rolesSection = ''
    unreadableCalls.length = 0
    unreadableSection = ''
    dbRows = rowFor('vienna', 'PROJECT_CONTEXT v1')
  })

  afterEach(() => {
    unreadableSection = ''
  })

  it('appends the unreadable block after the cached view, separated by a blank line', async () => {
    rolesSection = 'documents:\n- Bebauungsplan: bplan.pdf'
    unreadableSection = 'documents_unreadable:\n- Honorarnote.pdf'

    const view = await loadProjectPromptView('proj-1', 'org-1')

    expect(view).toBe(
      'PROJECT_CONTEXT v1\n\ndocuments:\n- Bebauungsplan: bplan.pdf\n\ndocuments_unreadable:\n- Honorarnote.pdf'
    )
  })

  it('returns only the unreadable block when the stored view is empty', async () => {
    dbRows = rowFor('vienna', '')
    unreadableSection = 'documents_unreadable:\n- Honorarnote.pdf'

    expect(await loadProjectPromptView('proj-1', 'org-1')).toBe(
      'documents_unreadable:\n- Honorarnote.pdf'
    )
  })

  it('is not cached: a second call re-reads the unreadable block while the view loads once', async () => {
    unreadableSection = 'documents_unreadable:\n- Honorarnote.pdf'

    await loadProjectPromptView('proj-1', 'org-1')
    unreadableSection = ''
    const second = await loadProjectPromptView('proj-1', 'org-1')

    expect(unreadableCalls).toEqual([
      { projectId: 'proj-1', organizationId: 'org-1' },
      { projectId: 'proj-1', organizationId: 'org-1' },
    ])
    expect(rolesReaders).toHaveLength(1)
    expect(second).toBe('PROJECT_CONTEXT v1')
  })

  it('leaves the view unchanged when the unreadable block is empty', async () => {
    unreadableSection = ''

    const view = await loadProjectPromptView('proj-1', 'org-1')

    expect(view).toBe('PROJECT_CONTEXT v1')
    expect(unreadableCalls).toHaveLength(1)
  })

  it('returns null without reading unreadable documents when there is no project id', async () => {
    unreadableSection = 'documents_unreadable:\n- Honorarnote.pdf'

    expect(await loadProjectPromptView(undefined, 'org-1')).toBeNull()
    expect(unreadableCalls).toHaveLength(0)
  })
})

describe('the derived classes the agent reads follow the gate the page shows them under', () => {
  const derived = {
    value: '4',
    status: 'unconfirmed',
    reason: 'Abgeleitet: OIB-RL 2',
    source: 'agent_suggested',
    updatedAt: '2026-11-01T00:00:00.000Z',
    evidence: [{ kind: 'derivation', rule: 'building_class', citation: 'OIB-RL 2', inputs: [] }],
  }
  const stored = 'PROJECT_CONTEXT v1\n\nassumptions:\n- building_class@bldg1=4 [abgeleitet]'

  beforeEach(() => {
    setCacheStore(new TestStore())
    rowsByOrg.clear()
    rolesSection = ''
    unreadableSection = ''
    rowsByOrg.set('org-law', {
      profile: { facts: {}, goals: {}, unknowns: [], assumptions: { 'building_class@bldg1': derived } },
      profilePromptView: stored,
    })
  })

  afterEach(() => {
    gateState = 'core'
  })

  it('serves the stored view, class included, where the gate names law', async () => {
    gateState = 'core'
    expect(await loadProjectPromptView('p1', 'org-law')).toContain('building_class@bldg1=4')
  })

  it.each(['site_unknown', 'none', 'knowledge_unavailable'])('leaves the derived class out where the gate is %s', async (gate) => {
    gateState = gate
    const view = await loadProjectPromptView('p1', 'org-law')
    expect(view).not.toContain('building_class')
    expect(view).toContain('PROJECT_CONTEXT v1')
  })
})
