'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { createActor, fromPromise, type Actor } from 'xstate'
import { useChatStore } from '../store'
import { isConversationOnServer } from './conversation-on-server'
import { lastCreateReport, onCreateReport } from './temporary-created'
import {
  temporarySwitchMachine,
  viewOf,
  type TemporarySwitchSnapshot,
  type TemporarySwitchView,
} from './temporary-switch-machine'

const getConversationsClient = async () =>
  (await import('@/adapters/api/conversations-client')).conversationsClient

type SwitchActor = Actor<typeof temporarySwitchMachine>

const actors = new Map<string, SwitchActor>()
const refusalListeners = new Set<(error: unknown) => void>()

const OFF: TemporarySwitchView = { pressed: false, pending: false, statement: null, sendBlocked: false }

function storedTemporary(conversationId: string): boolean {
  const { currentConversation, conversations } = useChatStore.getState()
  const conversation =
    currentConversation?.id === conversationId
      ? currentConversation
      : conversations.find((candidate) => candidate.id === conversationId)
  return conversation?.temporary === true
}

function applyTemporary(conversationId: string, temporary: boolean): void {
  if (storedTemporary(conversationId) === temporary) return
  useChatStore.setState((state) => ({
    conversations: state.conversations.map((conversation) =>
      conversation.id === conversationId ? { ...conversation, temporary } : conversation
    ),
    currentConversation:
      state.currentConversation?.id === conversationId
        ? { ...state.currentConversation, temporary }
        : state.currentConversation,
  }))
}

function storeCopy(snapshot: TemporarySwitchSnapshot): boolean {
  return snapshot.matches('creating') ? snapshot.context.carried : snapshot.context.confirmed
}

function switchFor(conversationId: string, stored: boolean = storedTemporary(conversationId)): SwitchActor {
  const existing = actors.get(conversationId)
  if (existing) return existing
  const onServer = isConversationOnServer(conversationId)
  const machine = temporarySwitchMachine.provide({
    actors: {
      save: fromPromise<boolean, { temporary: boolean }>(async ({ input }) => {
        const client = await getConversationsClient()
        const conversation = await client.setTemporary(conversationId, input.temporary)
        return conversation.temporary === true
      }),
    },
    actions: {
      notifyRefused: (_, { error }) => {
        for (const listener of refusalListeners) listener(error)
      },
    },
  })
  const actor = createActor(machine, { input: { onServer, temporary: stored } })
  actors.set(conversationId, actor)
  let mirrored = stored
  actor.subscribe((snapshot) => {
    const next = storeCopy(snapshot)
    if (next === mirrored) return
    mirrored = next
    applyTemporary(conversationId, next)
  })
  actor.start()
  const last = lastCreateReport(conversationId)
  if (!onServer && last) actor.send(last)
  return actor
}

onCreateReport((conversationId, report) => actors.get(conversationId)?.send(report))

export function setConversationTemporary(conversationId: string, temporary: boolean): void {
  switchFor(conversationId).send({ type: 'toggle', temporary })
}

export function onTemporaryRefused(listener: (error: unknown) => void): () => void {
  refusalListeners.add(listener)
  return () => {
    refusalListeners.delete(listener)
  }
}

export function afterTemporarySettled(conversationId: string, send: () => void): void {
  const actor = actors.get(conversationId)
  if (!actor || !viewOf(actor.getSnapshot()).sendBlocked) {
    send()
    return
  }
  const subscription = actor.subscribe((snapshot) => {
    if (viewOf(snapshot).sendBlocked) return
    subscription.unsubscribe()
    send()
  })
}

const noSubscription = (): (() => void) => () => {}

export function useTemporarySwitch(conversationId: string | null | undefined): TemporarySwitchView {
  const stored = useChatStore((state) => {
    if (!conversationId) return false
    if (state.currentConversation?.id === conversationId) return state.currentConversation.temporary === true
    return state.conversations.some((conversation) => conversation.id === conversationId && conversation.temporary === true)
  })
  const actor = conversationId ? switchFor(conversationId, stored) : null
  const snapshot = useSyncExternalStore(
    actor ? (listener) => actor.subscribe(listener).unsubscribe : noSubscription,
    () => actor?.getSnapshot() ?? null,
    () => actor?.getSnapshot() ?? null
  )
  useEffect(() => {
    actor?.send({ type: 'row.reported', temporary: stored })
  }, [actor, stored])
  return snapshot ? viewOf(snapshot) : OFF
}

export function useConversationTemporary(conversationId: string | null | undefined): boolean {
  return useTemporarySwitch(conversationId).statement === 'temporary'
}

export function resetTemporarySettling(): void {
  for (const actor of actors.values()) actor.stop()
  actors.clear()
  refusalListeners.clear()
}
