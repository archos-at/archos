import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { ApiRequestError } from '@/adapters/api/api-error'
import { fixtureClient, LIST_VARIANTS } from '@/app/dev/inbound-mail/fixtures'
import { refreshInboundMailWaiting, resetInboundMailWaitingForTests, useInboundMailWaiting } from './use-inbound-mail-waiting'

beforeEach(() => resetInboundMailWaitingForTests())

describe('useInboundMailWaiting', () => {
  it('counts the waiting mails, one read for every surface', async () => {
    const client = fixtureClient({ list: LIST_VARIANTS.many })
    const list = vi.spyOn(client, 'list')
    const first = renderHook(() => useInboundMailWaiting('p', true, client))
    const second = renderHook(() => useInboundMailWaiting('p', true, client))
    await waitFor(() => expect(first.result.current.count).toBe(9))
    expect(second.result.current).toMatchObject({ count: 9, more: true })
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('counts what the list shows as rows: an outsider’s mail yes, automatic mail (its folded group) no', async () => {
    const client = fixtureClient({ list: LIST_VARIANTS['unverified-group'] })
    const { result } = renderHook(() => useInboundMailWaiting('p', true, client))
    await waitFor(() => expect(result.current.count).toBe(3))
  })

  it('stamps each read with what it saw, so a list can tell that something arrived or was decided elsewhere', async () => {
    const client = fixtureClient({ list: LIST_VARIANTS.one })
    const { result } = renderHook(() => useInboundMailWaiting('p', true, client))
    await waitFor(() => expect(result.current.stamp).toBeTruthy())
    const first = result.current.stamp
    vi.spyOn(client, 'list').mockResolvedValue({ items: [], threadGroups: [], nextCursor: null })
    await refreshInboundMailWaiting('p', client)
    await waitFor(() => expect(result.current.stamp).not.toBe(first))
    expect(result.current.count).toBe(0)
  })

  it('reads nothing while off', () => {
    const client = fixtureClient({ list: LIST_VARIANTS.many })
    const list = vi.spyOn(client, 'list')
    const { result } = renderHook(() => useInboundMailWaiting('p', false, client))
    expect(result.current.count).toBeNull()
    expect(list).not.toHaveBeenCalled()
  })

  it('shows no number to a reader the project refuses, and never asks again', async () => {
    const client = fixtureClient()
    const list = vi.spyOn(client, 'list').mockRejectedValue(new ApiRequestError('no', 404))
    const { result } = renderHook(() => useInboundMailWaiting('p', true, client))
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1))
    await refreshInboundMailWaiting('p', client)
    expect(list).toHaveBeenCalledTimes(1)
    expect(result.current.count).toBeNull()
  })

  it('keeps the last number when a read fails', async () => {
    const client = fixtureClient({ list: LIST_VARIANTS.one })
    const { result } = renderHook(() => useInboundMailWaiting('p', true, client))
    await waitFor(() => expect(result.current.count).toBe(1))
    vi.spyOn(client, 'list').mockRejectedValue(new ApiRequestError('down', 503))
    await refreshInboundMailWaiting('p', client)
    expect(result.current.count).toBe(1)
  })
})
