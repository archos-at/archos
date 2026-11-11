'use client'

/**
 * Switching a conversation to temporary and back (ADR-0180 rule 2): while it
 * is temporary, nothing from it is kept in the project's, the office's or the
 * person's memory.
 *
 * The flag is the server row's (`conversations.temporary`). Each conversation
 * the page switches gets one {@link temporarySwitchMachine}, and the toggle,
 * the line under the composer and the turn all read it: the toggle and the
 * line say what the server holds, or that a switch is on its way, and a turn
 * waits while the person's word and the server's differ
 * ({@link afterTemporarySettled}). Before, a switch made while the create was in
 * flight showed „keeps nothing" at once, the create landed without the flag,
 * the turn opened, and only then was the flag sent; when that send failed the
 * screen flipped back silently after the turn had run.
 *
 * The store's `Conversation.temporary` is the machine's copy for the readers
 * that look there (the history's mark, the memory card): what the server holds,
 * or for a draft what its create will carry.
 */

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

/** The store's copy: what the server holds, or what the create in flight carries. */
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
  // Only a change reaches the store: the start settles on the value it was read from.
  let mirrored = stored
  actor.subscribe((snapshot) => {
    const next = storeCopy(snapshot)
    if (next === mirrored) return
    mirrored = next
    applyTemporary(conversationId, next)
  })
  actor.start()
  // A create that left before this switch was first read.
  const last = lastCreateReport(conversationId)
  if (!onServer && last) actor.send(last)
  return actor
}

// The store's create path reports here; a conversation nobody switched has no machine and needs none.
onCreateReport((conversationId, report) => actors.get(conversationId)?.send(report))

/** Switch the conversation. The machine says what holds; a refusal reaches {@link onTemporaryRefused}. */
export function setConversationTemporary(conversationId: string, temporary: boolean): void {
  switchFor(conversationId).send({ type: 'toggle', temporary })
}

/** Hear a switch the server refused or failed (the toggle says so). Returns the unsubscribe. */
export function onTemporaryRefused(listener: (error: unknown) => void): () => void {
  refusalListeners.add(listener)
  return () => {
    refusalListeners.delete(listener)
  }
}

/**
 * Run `send` once the person's word and the server's agree: at once when no
 * switch is on its way, which is every chat nobody switched mid-create. A turn
 * that opened before the flag landed could be remembered from while the screen
 * said nothing is kept.
 */
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

/** What the toggle and the line show for the conversation; off for none. */
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
  // The row as a list load reports it: another tab or device may have switched.
  useEffect(() => {
    actor?.send({ type: 'row.reported', temporary: stored })
  }, [actor, stored])
  return snapshot ? viewOf(snapshot) : OFF
}

/** Whether the server holds the conversation as temporary (or a draft will be created so). */
export function useConversationTemporary(conversationId: string | null | undefined): boolean {
  return useTemporarySwitch(conversationId).statement === 'temporary'
}

/** Specs only. */
export function resetTemporarySettling(): void {
  for (const actor of actors.values()) actor.stop()
  actors.clear()
  refusalListeners.clear()
}
