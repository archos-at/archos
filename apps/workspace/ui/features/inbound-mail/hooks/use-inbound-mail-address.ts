'use client'

import { useCallback, useEffect, useState } from 'react'
import type { InboundMailAddressView } from '@/lib/inbound-mail/inbound-mail-wire'
import { inboundMailAddressClient, type InboundMailAddressClient } from '../lib/client'

export type AddressState = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; address: InboundMailAddressView }

export interface UseInboundMailAddress {
  state: AddressState
  reload: () => Promise<void>
  create: () => Promise<InboundMailAddressView>
  rotate: () => Promise<InboundMailAddressView>
  remove: () => Promise<InboundMailAddressView>
  setForwardedFrom: (forwardedFrom: readonly string[]) => Promise<InboundMailAddressView>
}

export function useInboundMailAddress(
  projectId: string,
  enabled: boolean,
  client: InboundMailAddressClient = inboundMailAddressClient,
): UseInboundMailAddress {
  const [state, setState] = useState<AddressState>({ kind: 'loading' })

  const reload = useCallback(async () => {
    setState((current) => (current.kind === 'ready' ? current : { kind: 'loading' }))
    try {
      setState({ kind: 'ready', address: await client.get(projectId) })
    } catch {
      setState({ kind: 'error' })
    }
  }, [client, projectId])

  useEffect(() => {
    if (enabled) void reload()
  }, [enabled, reload])

  const act = useCallback(
    async (action: (projectId: string) => Promise<InboundMailAddressView>) => {
      const address = await action(projectId)
      setState({ kind: 'ready', address })
      return address
    },
    [projectId],
  )

  return {
    state,
    reload,
    create: () => act(client.create),
    rotate: () => act(client.rotate),
    remove: () => act(client.remove),
    setForwardedFrom: (forwardedFrom) => act((id) => client.setForwardedFrom(id, forwardedFrom)),
  }
}
