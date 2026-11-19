/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const store = vi.hoisted(() => ({ active: null as unknown, domain: 'example.org' as string | null }))

vi.mock('./access', () => ({
  requireMailReviewer: vi.fn(async () => ({ closed: false })),
  requireAddressManager: vi.fn(async () => undefined),
  managesProject: vi.fn(async () => true),
}))
vi.mock('./address', async () => {
  const actual = await vi.importActual<typeof import('./address')>('./address')
  return { ...actual, inboundMailDomain: () => store.domain, mintToken: () => 'abcdefgh2345' }
})
vi.mock('./repository', () => ({
  findActiveAddress: vi.fn(async () => store.active),
  addressActivity: vi.fn(async () => ({ lastReceivedAt: null, droppedLast30Days: 2 })),
  ownDomainVerifiedShare: vi.fn(async () => 0.75),
  insertAddress: vi.fn(async (input: { token: string; slug: string }) => {
    store.active = { id: 'addr-1', forwardedFrom: [], ...input }
    return { ok: true, value: store.active }
  }),
  replaceAddress: vi.fn(async (input: { token: string; slug: string }) => {
    store.active = { id: 'addr-2', forwardedFrom: [], ...input }
    return {
      ok: true,
      value: { row: store.active, previousAddressId: 'addr-1', followsEnded: [{ id: 'f-1', threadId: 't-1', userId: 'user_01JCX0R4D8M2W6YB3N5Q7T9V1B' }] },
    }
  }),
  setForwardedFrom: vi.fn(async (_projectId: string, forwardedFrom: string[]) => {
    if (!store.active) return null
    store.active = { ...(store.active as object), forwardedFrom }
    return store.active
  }),
  switchOffAddress: vi.fn(async () => {
    store.active = null
    return { previousAddressId: 'addr-2', followsEnded: [] }
  }),
}))
vi.mock('./audit', () => ({ auditFollowsEnded: vi.fn() }))
vi.mock('./announce', () => ({ settleFollowExpiring: vi.fn(async () => undefined) }))
vi.mock('@/lib/projects/repository', () => ({ findProjectInOrg: vi.fn(async () => ({ name: 'Wohnhaus Mödling' })) }))
vi.mock('@/lib/audit/after-commit', () => ({ recordAuditEventAfterCommit: vi.fn() }))
vi.mock('@/lib/analytics/posthog-server', () => ({ captureServer: vi.fn() }))
vi.mock('@/lib/realtime/door-events', () => ({ publishProjectChanged: vi.fn() }))

import { captureServer } from '@/lib/analytics/posthog-server'
import { recordAuditEventAfterCommit } from '@/lib/audit/after-commit'
import type { AuthorizedSession } from '@/lib/auth/types'
import {
  createInboundMailAddress,
  deleteInboundMailAddress,
  getInboundMailAddress,
  rotateInboundMailAddress,
  setInboundMailForwardedFrom,
} from './address-service'
import { requireAddressManager } from './access'
import { settleFollowExpiring } from './announce'
import { auditFollowsEnded } from './audit'
import { insertAddress, setForwardedFrom } from './repository'

const session = { userId: 'user_01JCX0R4D8M2W6YB3N5Q7T9V1A', organizationId: 'org_1', email: 'm@example.test' } as AuthorizedSession
const PROJECT = '3f0b1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'

beforeEach(() => {
  vi.clearAllMocks()
  store.active = null
  store.domain = 'example.org'
})

describe('the project address', () => {
  it('is read without minting one: "none" until a manager creates it', async () => {
    expect(await getInboundMailAddress(session, PROJECT)).toEqual({
      state: 'none',
      address: null,
      canManage: true,
      lastReceivedAt: null,
      droppedLast30Days: 2,
      ownDomainVerifiedShare: 0.75,
      forwardedFrom: [],
    })
    expect(insertAddress).not.toHaveBeenCalled()
  })

  it('says "unavailable" where the deployment receives no mail, and refuses to create one there', async () => {
    store.domain = null
    expect((await getInboundMailAddress(session, PROJECT)).state).toBe('unavailable')
    await expect(createInboundMailAddress(session, PROJECT)).rejects.toMatchObject({ details: { reason: 'mail_not_received_here' } })
  })

  it('is created once, under the project’s slug, and a second create answers the same one', async () => {
    expect((await createInboundMailAddress(session, PROJECT)).address).toBe('project+wohnhaus-moedling.abcdefgh2345@example.org')
    expect(await createInboundMailAddress(session, PROJECT)).toMatchObject({ state: 'active' })
    expect(insertAddress).toHaveBeenCalledTimes(1)
    expect(recordAuditEventAfterCommit).toHaveBeenCalledWith(expect.objectContaining({ action: 'inbound_mail_address.created' }))
    expect(vi.mocked(captureServer).mock.calls.map(([capture]) => capture)).toEqual([
      { event: 'inbound_mail_address_created', distinctId: session.userId, organizationId: session.organizationId, properties: {} },
    ])
  })

  it('is replaced with the follows it ended in the trail', async () => {
    await rotateInboundMailAddress(session, PROJECT)
    expect(recordAuditEventAfterCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'inbound_mail_address.rotated',
        metadata: { projectId: PROJECT, previousAddressId: 'addr-1', followsEnded: 1 },
      }),
    )
    expect(auditFollowsEnded).toHaveBeenCalledWith('org_1', PROJECT, session.userId, [expect.objectContaining({ id: 'f-1' })])
    expect(settleFollowExpiring).toHaveBeenCalledWith('org_1', ['f-1'])
  })

  it('is switched off, and switching off nothing changes nothing', async () => {
    expect((await deleteInboundMailAddress(session, PROJECT)).state).toBe('none')
    expect(recordAuditEventAfterCommit).toHaveBeenCalledWith(expect.objectContaining({ action: 'inbound_mail_address.deleted', targetId: 'addr-2' }))
  })
})

describe('the office’s existing project addresses that forward here', () => {
  it('are set by a manager, lowercased and once each, and the trail and analytics count them without naming them', async () => {
    await createInboundMailAddress(session, PROJECT)
    const view = await setInboundMailForwardedFrom(session, PROJECT, {
      forwardedFrom: [' Projekt-Kienberg@Buero.at ', 'projekt-kienberg@buero.at', '<kienberg@feld72.at>'],
    })
    expect(requireAddressManager).toHaveBeenCalledWith(session, PROJECT)
    expect(view.forwardedFrom).toEqual(['projekt-kienberg@buero.at', 'kienberg@feld72.at'])
    expect(setForwardedFrom).toHaveBeenCalledWith(PROJECT, ['projekt-kienberg@buero.at', 'kienberg@feld72.at'])
    expect(recordAuditEventAfterCommit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'inbound_mail_address.forwards_changed', targetId: 'addr-1', metadata: { projectId: PROJECT, forwards: 2 } }),
    )
    expect(JSON.stringify(vi.mocked(captureServer).mock.calls)).not.toContain('buero.at')
  })

  it('refuses what is not an address, and the project address itself (a loop)', async () => {
    await createInboundMailAddress(session, PROJECT)
    await expect(setInboundMailForwardedFrom(session, PROJECT, { forwardedFrom: ['kienberg'] })).rejects.toMatchObject({
      status: 400,
      details: { reason: 'forwarding_malformed' },
    })
    await expect(setInboundMailForwardedFrom(session, PROJECT, { forwardedFrom: ['project+haus.abcdefgh2345@example.org'] })).rejects.toMatchObject({
      details: { reason: 'forwarding_project_address' },
    })
    expect(setForwardedFrom).not.toHaveBeenCalled()
  })

  it('needs an address to forward to, and a manager to set them', async () => {
    await expect(setInboundMailForwardedFrom(session, PROJECT, { forwardedFrom: ['p@buero.at'] })).rejects.toMatchObject({ status: 409 })
    vi.mocked(requireAddressManager).mockRejectedValueOnce(Object.assign(new Error('forbidden'), { status: 403 }))
    await expect(setInboundMailForwardedFrom(session, PROJECT, { forwardedFrom: [] })).rejects.toMatchObject({ status: 403 })
  })

  it('are shown with the address, and with no address there are none', async () => {
    expect((await getInboundMailAddress(session, PROJECT)).forwardedFrom).toEqual([])
    await createInboundMailAddress(session, PROJECT)
    await setInboundMailForwardedFrom(session, PROJECT, { forwardedFrom: ['p@buero.at'] })
    expect((await getInboundMailAddress(session, PROJECT)).forwardedFrom).toEqual(['p@buero.at'])
  })
})
