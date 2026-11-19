import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./service', () => ({ directoryStandingsOf: vi.fn() }))
vi.mock('./repository', () => ({ listOrganizationsWithOfficeEditions: vi.fn() }))
vi.mock('@/lib/organizations/members-holding', () => ({ activeMembersHolding: vi.fn() }))
vi.mock('@/lib/inbox/service', () => ({
  emitInboxItems: vi.fn(async () => 0),
  resolveInboxItemsAnchoredOn: vi.fn(async () => 0),
  resolveInboxItemsOfType: vi.fn(async () => 0),
}))
vi.mock('./access', () => ({ officeStandardsEnabled: vi.fn(async () => true) }))
vi.mock('@/lib/inbox/repository', () => ({ readGroupPayloads: vi.fn(async () => new Map()) }))
vi.mock('@/lib/projects/repository', () => ({ listProjectsInOrg: vi.fn(async () => []) }))
vi.mock('@/lib/project-profile/salvage', () => ({ salvageProjectProfile: (stored: unknown) => ({ profile: stored }) }))
vi.mock('@/lib/db/tenant-context', () => ({ withTenant: (_context: unknown, run: () => unknown) => run() }))

import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import { inboxItemCopy } from '@/lib/inbox/item-copy'
import { inboxGroupKey } from '@/lib/inbox/registry'
import { readGroupPayloads } from '@/lib/inbox/repository'
import { emitInboxItems, resolveInboxItemsAnchoredOn, resolveInboxItemsOfType, type InboxEmission } from '@/lib/inbox/service'
import type { InboxItemView } from '@/lib/inbox/types'
import { activeMembersHolding } from '@/lib/organizations/members-holding'
import { listProjectsInOrg } from '@/lib/projects/repository'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { createTranslator } from '@/i18n/translate'
import { officeStandardsEnabled } from './access'
import { noticeNewEditions, sweepNewEditionNotices } from './new-edition-notice'
import { listOrganizationsWithOfficeEditions } from './repository'
import { directoryStandingsOf } from './service'

const NOW = new Date('2026-11-19T05:13:00Z')
const B1600 = { workId: 'work_b1600', designation: 'ÖNORM B 1600', standing: { inForce: { editionLabel: '2023-02-01', startsOn: '2023-02-01' }, held: false } }
const B3806 = { workId: 'work_b3806', designation: 'ÖNORM B 3806', standing: { inForce: { editionLabel: '2023-03-01', startsOn: '2023-03-01' }, held: true } }
const filed = (day: string) => ({ facts: { 'procedure_type@p1': { value: 'baubewilligung' }, 'filed_on@p1': { value: day } } })
const project = (name: string, status: string, profile: object) => ({ name, status, profile }) as unknown as Awaited<ReturnType<typeof listProjectsInOrg>>[number]

const emitted = () => vi.mocked(emitInboxItems).mock.calls.flatMap(([emissions]) => emissions as InboxEmission[])

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(officeStandardsEnabled).mockResolvedValue(true)
  vi.mocked(directoryStandingsOf).mockResolvedValue([B1600, B3806])
  vi.mocked(activeMembersHolding).mockResolvedValue(['user_anna', 'user_ben'])
  vi.mocked(readGroupPayloads).mockResolvedValue(new Map())
  vi.mocked(listProjectsInOrg).mockResolvedValue([
    project('Wohnbau Seestadt Baufeld D12', 'active', {}),
    project('Dachausbau Mollardgasse', 'active', filed('2024-06-30')),
    project('Wohnhaus Floridsdorf', 'active', filed('2022-11-02')),
    project('Bürohaus Erdberg', 'closed', {}),
  ])
})

describe('a newer edition the platform lists', () => {
  it('tells everyone who manages the Büroablage, naming the projects whose reference day falls after it', async () => {
    expect(await noticeNewEditions('org_1', NOW)).toEqual({ newer: 1, notified: 2, resolved: 0 })
    expect(activeMembersHolding).toHaveBeenCalledWith('org_1', ORG_PERMISSIONS.officeShelfManage)
    const groupKey = inboxGroupKey('base_knowledge.new_edition', 'organization', 'org_1', 'önorm b 1600@2023-02-01')
    expect(emitted()).toEqual(
      ['user_anna', 'user_ben'].map((recipientUserId) => ({
        organizationId: 'org_1',
        recipientUserId,
        type: 'base_knowledge.new_edition',
        resourceType: 'organization',
        resourceId: 'org_1',
        anchorId: 'önorm b 1600@2023-02-01',
        actorUserId: null,
        groupKey,
        payload: {
          subject: 'ÖNORM B 1600',
          related: '2023-02-01',
          startsOn: '2023-02-01',
          variant: 'projects',
          excerpt: 'Wohnbau Seestadt Baufeld D12, Dachausbau Mollardgasse',
        },
      })),
    )
  })

  it('reads as a Postfach item naming the norm, the edition in force and the projects after it', () => {
    const dictionary = { collaboration: collaborationCopy.messages.de }
    const t = createTranslator(dictionary, 'collaboration')
    const item = {
      type: 'base_knowledge.new_edition',
      state: 'unread',
      resourceType: 'organization',
      actorName: null,
      count: 1,
      href: '/app/base-knowledge',
      subject: 'ÖNORM B 1600',
      related: '2023-02-01',
      excerpt: 'Wohnbau Seestadt Baufeld D12',
      variant: 'projects',
      answerIn: null,
    } as unknown as InboxItemView
    expect(inboxItemCopy(item, t, dictionary)).toEqual({
      title: 'ÖNORM B 1600: neue Ausgabe erschienen',
      body: 'Laut Normenverzeichnis gilt heute die Ausgabe 2023-02-01, die Büroablage hat nur eine ältere. Projekte mit Stichtag danach:',
    })
  })

  it('tells each person once, and settles the notice once the office holds the edition', async () => {
    const groupKey = inboxGroupKey('base_knowledge.new_edition', 'organization', 'org_1', 'önorm b 1600@2023-02-01')
    vi.mocked(readGroupPayloads).mockResolvedValue(new Map([[`user_anna\n${groupKey}`, {}]]))
    vi.mocked(resolveInboxItemsAnchoredOn).mockResolvedValue(1)
    expect(await noticeNewEditions('org_1', NOW)).toEqual({ newer: 1, notified: 1, resolved: 1 })
    expect(emitted().map((emission) => emission.recipientUserId)).toEqual(['user_ben'])
    expect(resolveInboxItemsAnchoredOn).toHaveBeenCalledWith({ organizationId: 'org_1', types: ['base_knowledge.new_edition'], anchorId: 'önorm b 3806@2023-03-01' })
  })

  it('says nothing for a work the office holds current, or the platform does not list', async () => {
    vi.mocked(directoryStandingsOf).mockResolvedValue([B3806])
    expect(await noticeNewEditions('org_1', NOW)).toMatchObject({ newer: 0, notified: 0 })
    expect(emitInboxItems).not.toHaveBeenCalled()
  })
})

describe('the daily sweep', () => {
  it('compares every office holding standards, and fails the run only after the others had their turn', async () => {
    vi.mocked(listOrganizationsWithOfficeEditions).mockResolvedValue(['org_broken', 'org_1'])
    vi.mocked(directoryStandingsOf).mockImplementation(async (organizationId) => {
      if (organizationId === 'org_broken') throw new Error('platform read failed')
      return [B1600]
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(sweepNewEditionNotices(NOW)).rejects.toThrow('new editions: 1 of 2 organization(s) failed')
    expect(emitted().map((emission) => emission.organizationId)).toEqual(['org_1', 'org_1'])
  })

  it('tells an office that lost its own standards nothing, and resolves what it was told', async () => {
    vi.mocked(listOrganizationsWithOfficeEditions).mockResolvedValue(['org_off', 'org_1'])
    vi.mocked(officeStandardsEnabled).mockImplementation(async (organizationId) => organizationId !== 'org_off')
    vi.mocked(resolveInboxItemsOfType).mockResolvedValue(2)
    vi.mocked(resolveInboxItemsAnchoredOn).mockResolvedValue(0)

    expect(await sweepNewEditionNotices(NOW)).toEqual({ organizations: 2, notified: 2, resolved: 2, failed: 0 })
    expect(directoryStandingsOf).not.toHaveBeenCalledWith('org_off', expect.anything())
    expect(resolveInboxItemsOfType).toHaveBeenCalledWith({ organizationId: 'org_off', types: ['base_knowledge.new_edition'] })
    expect(resolveInboxItemsOfType).toHaveBeenCalledTimes(1)
    expect(emitted().map((emission) => emission.organizationId)).toEqual(['org_1', 'org_1'])
  })
})
