import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./service', () => ({ heldWorksOf: vi.fn() }))
vi.mock('./repository', () => ({ listOrganizationsWithOfficeEditions: vi.fn() }))
vi.mock('../context/service', () => ({ knowledgeContextForTurn: vi.fn() }))
vi.mock('@/lib/organizations/members-holding', () => ({ activeMembersHolding: vi.fn() }))
vi.mock('@/lib/inbox/service', () => ({
  emitInboxItems: vi.fn(async () => 0),
  resolveInboxItemsOfType: vi.fn(async () => 0),
}))
vi.mock('./access', () => ({ officeStandardsEnabled: vi.fn(async () => true) }))
vi.mock('@/lib/inbox/repository', () => ({ readGroupPayloads: vi.fn(async () => new Map()) }))
vi.mock('@/lib/projects/repository', () => ({ listProjectsInOrg: vi.fn(async () => []) }))
vi.mock('@/lib/db/tenant-context', () => ({ withTenant: (_context: unknown, run: () => unknown) => run() }))

import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import { inboxItemCopy } from '@/lib/inbox/item-copy'
import { inboxGroupKey } from '@/lib/inbox/registry'
import { readGroupPayloads } from '@/lib/inbox/repository'
import { emitInboxItems, resolveInboxItemsOfType, type InboxEmission } from '@/lib/inbox/service'
import type { InboxItemView } from '@/lib/inbox/types'
import { activeMembersHolding } from '@/lib/organizations/members-holding'
import { listProjectsInOrg } from '@/lib/projects/repository'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { createTranslator } from '@/i18n/translate'
import { knowledgeContextForTurn } from '../context/service'
import type { KnowledgeContext } from '../context/wire'
import type { StoredEntry } from '../store/repository'
import { officeStandardsEnabled } from './access'
import { bindingNormsOf } from './binding-edition'
import { affectedNorms, noticeNewEditions, sweepNewEditionNotices } from './new-edition-notice'
import { listOrganizationsWithOfficeEditions } from './repository'
import { heldWorksOf } from './service'

function held(editionId: string, editionLabel: string, designation = 'ÖNORM B 1600:2017'): StoredEntry {
  return {
    workId: 'work_b1600',
    workStandsAlone: false,
    editionId,
    copyId: `copy_${editionId}`,
    documentId: `doc_${editionId}`,
    confirmed: true,
    provenance: {},
    terms: {},
    lastCheck: null,
    createdAt: new Date('2026-01-01'),
    values: {
      kind: 'technical_standard',
      title: 'Barrierefreies Bauen',
      designation,
      editionLabel,
      issuedOn: editionLabel,
      inForceFrom: null,
      inForceTo: null,
      territoryIds: [],
      issuer: null,
      addressees: [],
      licenceClass: 'licensed',
    },
  }
}

const binds = (editionLabel: string) =>
  ({
    uses: [
      {
        role: 'binding',
        via: 'relation',
        workId: 'work:oenorm-b-1600',
        editionId: `edition:oenorm-b-1600-${editionLabel}`,
        designation: 'ÖNORM B 1600',
        editionLabel,
        route: { workId: 'work:oib-rl-4', designation: 'OIB-RL 4', editionLabel: '2023', provision: null },
      },
    ],
  }) as unknown as KnowledgeContext

const NOTHING = { uses: [] } as unknown as KnowledgeContext
const OLD = held('edition_b1600_2017', '2017-04-15')
const project = (id: string, name: string, status = 'active') => ({ id, name, status }) as unknown as Awaited<ReturnType<typeof listProjectsInOrg>>[number]
const ANCHOR = 'önorm b 1600@2023-02-01'

const emitted = () => vi.mocked(emitInboxItems).mock.calls.flatMap(([emissions]) => emissions as InboxEmission[])

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(officeStandardsEnabled).mockResolvedValue(true)
  vi.mocked(heldWorksOf).mockResolvedValue([[OLD]])
  vi.mocked(activeMembersHolding).mockResolvedValue(['user_anna', 'user_ben'])
  vi.mocked(readGroupPayloads).mockResolvedValue(new Map())
  vi.mocked(listProjectsInOrg).mockResolvedValue([
    project('p_seestadt', 'Wohnbau Seestadt Baufeld D12'),
    project('p_mollard', 'Dachausbau Mollardgasse'),
    project('p_floridsdorf', 'Wohnhaus Floridsdorf'),
    project('p_erdberg', 'Bürohaus Erdberg', 'closed'),
  ])
  vi.mocked(knowledgeContextForTurn).mockImplementation(async (_organizationId, projectId) =>
    projectId === 'p_floridsdorf' ? binds('2017-04-15') : projectId === 'p_erdberg' ? NOTHING : binds('2023-02-01'),
  )
})

describe('which norms the office holds are no longer binding for its projects', () => {
  const project2023 = { name: 'Wohnbau Seestadt Baufeld D12', bindings: bindingNormsOf(binds('2023-02-01').uses) }
  const project2017 = { name: 'Wohnhaus Floridsdorf', bindings: bindingNormsOf(binds('2017-04-15').uses) }

  it('names a held norm once per binding edition, with every active project it no longer binds for', () => {
    expect(affectedNorms([[OLD]], [project2023, project2017, { ...project2023, name: 'Dachausbau Mollardgasse' }])).toEqual([
      {
        anchorId: ANCHOR,
        subject: 'ÖNORM B 1600:2017',
        entryId: 'edition_b1600_2017',
        standing: { editionLabel: '2023-02-01', startsOn: '2023-02-01', via: { designation: 'OIB-RL 4', editionLabel: '2023' }, held: false, newer: true },
        projects: ['Wohnbau Seestadt Baufeld D12', 'Dachausbau Mollardgasse'],
      },
    ])
  })

  it('names nothing when the office holds the binding edition or a later one, the resolver names none, or no project is there', () => {
    expect(affectedNorms([[OLD, held('edition_b1600_2023', '2023-02-01', 'ÖNORM B 1600:2023')]], [project2023])).toEqual([])
    expect(affectedNorms([[OLD]], [project2017, { name: 'Ohne Bindung', bindings: new Map() }])).toEqual([])
    expect(affectedNorms([[OLD]], [])).toEqual([])
    expect(affectedNorms([[held('edition_b1600_2023', '2023-02-01', 'ÖNORM B 1600:2023')]], [project2017])).toEqual([])
  })
})

describe('the Postfach item', () => {
  it('tells everyone who manages the Büroablage, once per norm and binding edition, naming the projects it affects', async () => {
    expect(await noticeNewEditions('org_1')).toEqual({ newer: 1, notified: 2, resolved: 0 })
    expect(knowledgeContextForTurn).not.toHaveBeenCalledWith('org_1', 'p_erdberg', undefined, null, 'run')
    expect(activeMembersHolding).toHaveBeenCalledWith('org_1', ORG_PERMISSIONS.officeShelfManage)
    expect(resolveInboxItemsOfType).toHaveBeenCalledWith({ organizationId: 'org_1', types: ['base_knowledge.new_edition'], keepAnchors: [ANCHOR] })
    const groupKey = inboxGroupKey('base_knowledge.new_edition', 'organization', 'org_1', ANCHOR)
    expect(emitted()).toEqual(
      ['user_anna', 'user_ben'].map((recipientUserId) => ({
        organizationId: 'org_1',
        recipientUserId,
        type: 'base_knowledge.new_edition',
        resourceType: 'organization',
        resourceId: 'org_1',
        anchorId: ANCHOR,
        actorUserId: null,
        groupKey,
        payload: {
          subject: 'ÖNORM B 1600:2017',
          entryId: 'edition_b1600_2017',
          related: '2023-02-01',
          excerpt: 'Wohnbau Seestadt Baufeld D12, Dachausbau Mollardgasse',
          variant: 'via',
          via: 'OIB-RL 4 2023',
        },
      })),
    )
  })

  it('reads in the office’s words: the copy is no longer binding, which edition is and why, and whom it affects', () => {
    const dictionary = { collaboration: collaborationCopy.messages.de }
    const t = createTranslator(dictionary, 'collaboration')
    const item = {
      type: 'base_knowledge.new_edition',
      state: 'unread',
      resourceType: 'organization',
      actorName: null,
      count: 1,
      href: '/app/base-knowledge?entry=edition_b1600_2017',
      subject: 'ÖNORM B 1600:2017',
      related: '2023-02-01',
      via: 'OIB-RL 4 2023',
      excerpt: 'Wohnbau Seestadt Baufeld D12, Dachausbau Mollardgasse',
      variant: 'via',
      answerIn: null,
    } as unknown as InboxItemView
    expect(inboxItemCopy(item, t, dictionary, 'de')).toEqual({
      title: 'ÖNORM B 1600:2017 ist nicht mehr die verbindliche Ausgabe',
      body: 'Verbindlich ist die Ausgabe 2023-02-01, laut OIB-RL 4 2023. Betrifft: Wohnbau Seestadt Baufeld D12, Dachausbau Mollardgasse',
    })
  })

  it('tells each person once', async () => {
    const groupKey = inboxGroupKey('base_knowledge.new_edition', 'organization', 'org_1', ANCHOR)
    vi.mocked(readGroupPayloads).mockResolvedValue(new Map([[`user_anna\n${groupKey}`, {}]]))
    expect(await noticeNewEditions('org_1')).toMatchObject({ notified: 1 })
    expect(emitted().map((emission) => emission.recipientUserId)).toEqual(['user_ben'])
  })

  it('says nothing, and settles what it said, once the office holds the binding edition or no active project is affected', async () => {
    vi.mocked(resolveInboxItemsOfType).mockResolvedValue(2)
    vi.mocked(heldWorksOf).mockResolvedValue([[OLD, held('edition_b1600_2023', '2023-02-01', 'ÖNORM B 1600:2023')]])
    expect(await noticeNewEditions('org_1')).toEqual({ newer: 0, notified: 0, resolved: 2 })
    vi.mocked(heldWorksOf).mockResolvedValue([[OLD]])
    vi.mocked(listProjectsInOrg).mockResolvedValue([project('p_erdberg', 'Bürohaus Erdberg', 'closed')])
    expect(await noticeNewEditions('org_1')).toEqual({ newer: 0, notified: 0, resolved: 2 })
    expect(resolveInboxItemsOfType).toHaveBeenCalledWith({ organizationId: 'org_1', types: ['base_knowledge.new_edition'], keepAnchors: [] })
    expect(emitInboxItems).not.toHaveBeenCalled()
  })

  it('reads no project for an office that holds no confirmed norm', async () => {
    vi.mocked(heldWorksOf).mockResolvedValue([])
    expect(await noticeNewEditions('org_1')).toMatchObject({ newer: 0, notified: 0 })
    expect(listProjectsInOrg).not.toHaveBeenCalled()
  })
})

describe('the daily sweep', () => {
  it('compares every office holding standards, and fails the run only after the others had their turn', async () => {
    vi.mocked(listOrganizationsWithOfficeEditions).mockResolvedValue(['org_broken', 'org_1'])
    vi.mocked(heldWorksOf).mockImplementation(async (organizationId) => {
      if (organizationId === 'org_broken') throw new Error('records read failed')
      return [[OLD]]
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(sweepNewEditionNotices()).rejects.toThrow('new editions: 1 of 2 organization(s) failed')
    expect(emitted().map((emission) => emission.organizationId)).toEqual(['org_1', 'org_1'])
  })

  it('tells an office that lost its own standards nothing, and resolves what it was told', async () => {
    vi.mocked(listOrganizationsWithOfficeEditions).mockResolvedValue(['org_off', 'org_1'])
    vi.mocked(officeStandardsEnabled).mockImplementation(async (organizationId) => organizationId !== 'org_off')
    vi.mocked(resolveInboxItemsOfType).mockImplementation(async ({ organizationId }) => (organizationId === 'org_off' ? 2 : 0))

    expect(await sweepNewEditionNotices()).toEqual({ organizations: 2, notified: 2, resolved: 2, failed: 0 })
    expect(heldWorksOf).not.toHaveBeenCalledWith('org_off')
    expect(resolveInboxItemsOfType).toHaveBeenCalledWith({ organizationId: 'org_off', types: ['base_knowledge.new_edition'] })
    expect(emitted().map((emission) => emission.organizationId)).toEqual(['org_1', 'org_1'])
  })
})
