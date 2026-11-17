'use client'

import { useEffect, useMemo, useRef } from 'react'
import { create } from 'zustand'
import { useChatStore } from '../store'
import type { PersonalTurnNote, TurnMemoryItem } from '../lib/turn-memory'
import type { TurnView } from '@/lib/turns/turn-fold'

export interface ConversationPersonalNote extends PersonalTurnNote {
  sourceMessageId: string | null
}

export type NoteRemoval = 'removing' | 'removed' | 'gone' | 'failed'

export interface ProjectShelfAccess {
  canWrite: boolean
  activeIds: readonly string[] | null
}

interface TurnNotesState {
  personal: Record<string, readonly ConversationPersonalNote[]>
  shelves: Record<string, ProjectShelfAccess>
  offices: Record<string, readonly string[] | null>
  removals: Record<string, NoteRemoval>
}

export const useTurnNotes = create<TurnNotesState>()(() => ({ personal: {}, shelves: {}, offices: {}, removals: {} }))

const NO_NOTES: readonly ConversationPersonalNote[] = []
const PAGE = 200

const shelfKey = (projectId: string, conversationId: string): string => `${projectId}:${conversationId}`

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

function personalNoteOf(raw: unknown): ConversationPersonalNote | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.content !== 'string') return null
  return {
    id: raw.id,
    kind: typeof raw.kind === 'string' ? raw.kind : 'preference',
    content: raw.content,
    provenanceType: typeof raw.provenanceType === 'string' ? raw.provenanceType : 'agent',
    sourceMessageId: typeof raw.sourceMessageId === 'string' ? raw.sourceMessageId : null,
  }
}

const loadingPersonal = new Map<string, Promise<void>>()
const loadingShelves = new Map<string, Promise<void>>()
const loadingOffices = new Map<string, Promise<void>>()

function listedIds(body: Record<string, unknown>): readonly string[] | null {
  if (body.nextCursor !== null && body.nextCursor !== undefined) return null
  const rows = Array.isArray(body.items) ? body.items : []
  return rows.flatMap((row) => (isRecord(row) && typeof row.id === 'string' ? [row.id] : []))
}
const stalePersonal = new Set<string>()

export function loadPersonalNotes(conversationId: string, options: { again?: boolean } = {}): Promise<void> {
  const running = loadingPersonal.get(conversationId)
  if (running) {
    if (options.again) stalePersonal.add(conversationId)
    return running
  }
  const load = (async () => {
    try {
      const query = new URLSearchParams({ sourceConversationId: conversationId, limit: String(PAGE) })
      const response = await fetch(`/api/user/memory?${query.toString()}`)
      if (!response.ok) return
      const body: unknown = await response.json()
      const rows = isRecord(body) && Array.isArray(body.items) ? body.items : []
      const notes = rows.map(personalNoteOf).filter((note): note is ConversationPersonalNote => note !== null)
      useTurnNotes.setState((state) => ({ personal: { ...state.personal, [conversationId]: notes } }))
    } catch {
      // Offline or aborted: the next signal reads again.
    } finally {
      loadingPersonal.delete(conversationId)
      if (stalePersonal.delete(conversationId)) void loadPersonalNotes(conversationId)
    }
  })()
  loadingPersonal.set(conversationId, load)
  return load
}

export function loadProjectShelf(projectId: string, conversationId: string): Promise<void> {
  const key = shelfKey(projectId, conversationId)
  const running = loadingShelves.get(key)
  if (running) return running
  const load = (async () => {
    try {
      const query = new URLSearchParams({ conversationId, limit: String(PAGE) })
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/memory?${query.toString()}`)
      if (!response.ok) return
      const body: unknown = await response.json()
      if (!isRecord(body)) return
      const access: ProjectShelfAccess = { canWrite: body.canWrite === true, activeIds: listedIds(body) }
      useTurnNotes.setState((state) => ({ shelves: { ...state.shelves, [key]: access } }))
    } catch {
      // No answer: the chip offers no remove action for project notes.
    } finally {
      loadingShelves.delete(key)
    }
  })()
  loadingShelves.set(key, load)
  return load
}

export function loadOfficeShelf(conversationId: string): Promise<void> {
  const running = loadingOffices.get(conversationId)
  if (running) return running
  const load = (async () => {
    try {
      const query = new URLSearchParams({ conversationId, limit: String(PAGE) })
      const response = await fetch(`/api/organization/memory?${query.toString()}`)
      if (!response.ok) return
      const body: unknown = await response.json()
      if (!isRecord(body)) return
      const ids = listedIds(body)
      useTurnNotes.setState((state) => ({ offices: { ...state.offices, [conversationId]: ids } }))
    } catch {
      // No answer: the chip offers no remove action for office notes.
    } finally {
      loadingOffices.delete(conversationId)
    }
  })()
  loadingOffices.set(conversationId, load)
  return load
}

export function noteAddress(item: TurnMemoryItem, projectId: string | null | undefined): string | null {
  if (!item.noteId) return null
  const id = encodeURIComponent(item.noteId)
  if (item.audience === 'personal') return `/api/user/memory/${id}`
  if (item.audience === 'organization') return `/api/organization/memory/${id}`
  if ((item.audience === 'project' || item.audience === 'restricted') && projectId) {
    return `/api/projects/${encodeURIComponent(projectId)}/memory/${id}`
  }
  return null
}

const setRemoval = (noteId: string, removal: NoteRemoval): void =>
  useTurnNotes.setState((state) => ({ removals: { ...state.removals, [noteId]: removal } }))

export async function removeNote(item: TurnMemoryItem, projectId: string | null | undefined): Promise<void> {
  const address = noteAddress(item, projectId)
  if (!address || !item.noteId) return
  const noteId = item.noteId
  if (useTurnNotes.getState().removals[noteId] === 'removing') return
  setRemoval(noteId, 'removing')
  try {
    const response = await fetch(address, { method: 'DELETE' })
    setRemoval(noteId, response.ok ? 'removed' : response.status === 404 ? 'gone' : 'failed')
  } catch {
    setRemoval(noteId, 'failed')
  }
}

const turnSignal =
  (messageId: string | null | undefined) =>
  (state: { turns?: Record<string, TurnView> }): string => {
    if (!messageId) return ''
    const view = Object.values(state.turns ?? {}).find((turn) => turn.messageId === messageId)
    const reflected = view?.stages.memory_reflection?.status
    return view?.result ? `answered:${reflected ?? ''}` : ''
  }

export function usePersonalTurnNotes(
  conversationId: string | null | undefined,
  messageId: string | null | undefined
): readonly PersonalTurnNote[] {
  const notes = useTurnNotes((state) => (conversationId ? state.personal[conversationId] : undefined))
  const signal = useChatStore(turnSignal(messageId))
  const seen = useRef(signal)
  useEffect(() => {
    if (!conversationId || !messageId) return
    const moved = seen.current !== signal
    seen.current = signal
    if (moved) void loadPersonalNotes(conversationId, { again: true })
    else if (useTurnNotes.getState().personal[conversationId] === undefined) void loadPersonalNotes(conversationId)
  }, [conversationId, messageId, signal])
  return useMemo(
    () => (messageId ? (notes ?? NO_NOTES).filter((note) => note.sourceMessageId === messageId) : NO_NOTES),
    [notes, messageId]
  )
}

export function useProjectShelf(
  projectId: string | null | undefined,
  conversationId: string | null | undefined
): ProjectShelfAccess | undefined {
  return useTurnNotes((state) =>
    projectId && conversationId ? state.shelves[shelfKey(projectId, conversationId)] : undefined
  )
}

export function useOfficeShelf(conversationId: string | null | undefined): readonly string[] | null | undefined {
  return useTurnNotes((state) => (conversationId ? state.offices[conversationId] : undefined))
}

export function resetTurnNotes(): void {
  loadingPersonal.clear()
  loadingShelves.clear()
  loadingOffices.clear()
  stalePersonal.clear()
  useTurnNotes.setState({ personal: {}, shelves: {}, offices: {}, removals: {} })
}
