'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PushPreferences, PushPreferencesPatch } from '@/lib/inbox/push-categories'
import { DEFAULT_PUSH_PREFERENCES } from '@/lib/inbox/push-categories'
import {
  classifyPushSupport,
  currentSubscription,
  deviceOfSubscription,
  forgetThisDevice,
  PushPermissionError,
  readCapabilities,
  registrationBody,
  subscribeThisDevice,
  type PushSupport,
} from '@/lib/push/browser'
import { pushClient, type PushClient } from '@/lib/push/client'
import type { PushDeviceView } from '@/lib/push/types'

export type PushPhase = 'loading' | 'off' | 'unsupported' | 'needs-install' | 'denied' | 'ready'

export type PushActionError = 'enable' | 'remove' | 'preferences' | null

export interface UsePushNotificationsResult {
  phase: PushPhase
  thisDeviceOn: boolean
  devices: PushDeviceView[]
  thisDeviceId: string | null
  preferences: PushPreferences
  busy: boolean
  error: PushActionError
  enable: () => Promise<void>
  disable: () => Promise<void>
  removeDevice: (id: string) => Promise<void>
  updatePreferences: (patch: PushPreferencesPatch) => Promise<void>
}

function phaseOf(support: PushSupport): PushPhase {
  if (support === 'granted' || support === 'default') return 'ready'
  return support
}

export function usePushNotifications(client: PushClient = pushClient): UsePushNotificationsResult {
  const [phase, setPhase] = useState<PushPhase>('loading')
  const [devices, setDevices] = useState<PushDeviceView[]>([])
  const [endpoint, setEndpoint] = useState<string | null>(null)
  const [preferences, setPreferences] = useState<PushPreferences>(DEFAULT_PUSH_PREFERENCES)
  const [publicKey, setPublicKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<PushActionError>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const load = useCallback(async () => {
    try {
      const config = await client.config()
      if (!alive.current) return
      if (!config.enabled) {
        setPhase('off')
        return
      }
      setPublicKey(config.publicKey)
      const support = classifyPushSupport(readCapabilities())
      setPhase(phaseOf(support))
      const [list, prefs, subscription] = await Promise.all([
        client.listDevices(),
        client.getPreferences(),
        support === 'granted' || support === 'default' ? currentSubscription() : Promise.resolve(null),
      ])
      if (!alive.current) return
      setDevices(list)
      setPreferences(prefs)
      setEndpoint(subscription?.endpoint ?? null)
    } catch {
      if (alive.current) setPhase((current) => (current === 'loading' ? 'off' : current))
    }
  }, [client])

  useEffect(() => {
    void load()
  }, [load])

  const thisDevice = useMemo(
    () => (endpoint ? (devices.find((device) => device.endpoint === endpoint) ?? null) : null),
    [devices, endpoint]
  )

  const run = useCallback(async (kind: Exclude<PushActionError, null>, action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (cause) {
      if (!alive.current) return
      if (cause instanceof PushPermissionError) {
        setPhase(classifyPushSupport(readCapabilities()) === 'denied' ? 'denied' : 'ready')
      } else {
        setError(kind)
      }
    } finally {
      if (alive.current) setBusy(false)
    }
  }, [])

  const enable = useCallback(
    () =>
      run('enable', async () => {
        if (!publicKey) throw new Error('no public key')
        const subscription = await subscribeThisDevice(publicKey)
        const device = await client.registerDevice(registrationBody(subscription))
        if (!alive.current) return
        setEndpoint(subscription.endpoint)
        setDevices((current) => [device, ...current.filter((entry) => entry.id !== device.id)])
      }),
    [client, publicKey, run]
  )

  const disable = useCallback(
    () =>
      run('remove', async () => {
        await forgetThisDevice(client)
        if (!alive.current) return
        setEndpoint(null)
        setDevices(await client.listDevices())
      }),
    [client, run]
  )

  const removeDevice = useCallback(
    (id: string) =>
      run('remove', async () => {
        const subscription = await currentSubscription()
        const isThis = deviceOfSubscription(devices, subscription)?.id === id
        await client.removeDevice(id)
        if (isThis) await subscription?.unsubscribe().catch(() => false)
        if (!alive.current) return
        if (isThis) setEndpoint(null)
        setDevices((current) => current.filter((device) => device.id !== id))
      }),
    [client, devices, run]
  )

  const updatePreferences = useCallback(
    (patch: PushPreferencesPatch) =>
      run('preferences', async () => {
        setPreferences(await client.updatePreferences(patch))
      }),
    [client, run]
  )

  return {
    phase,
    thisDeviceOn: thisDevice !== null,
    devices,
    thisDeviceId: thisDevice?.id ?? null,
    preferences,
    busy,
    error,
    enable,
    disable,
    removeDevice,
    updatePreferences,
  }
}

export async function refreshRegisteredDevice(client: PushClient = pushClient): Promise<void> {
  const subscription = await currentSubscription()
  if (!subscription) return
  const device = deviceOfSubscription(await client.listDevices(), subscription)
  if (device) await client.registerDevice(registrationBody(subscription))
}
