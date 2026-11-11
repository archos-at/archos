'use client'

/**
 * What the „noted“ chip of an answer knows that the message does not hold
 * (ADR-0180): the reader's own personal notes of the conversation, whether the
 * reader may take a project note back, and which notes were taken back in
 * this tab.
 *
 * **Personal notes are read per person, never off the message.** A shared
 * conversation's messages are read by other people, so a note about the asker
 * rides no frame. The agent stores it with the id of the answer it was saved
 * under (`personal_memory.source_message_id`), and this store asks
 * `GET /api/user/memory?sourceConversationId=…` once per CONVERSATION, not per
 * rendered answer: every answer of the thread reads the one list and picks the
 * notes that carry its own message id. Row-level security answers the owner's
 * rows only, so a colleague reading the same conversation gets an empty list.
 *
 * The list is read again when something says it changed, never on a timer:
 * the answer's turn delivered its result (the `remember` tool may have kept a
 * note), or its reflection stage reported, with or without content (the stage
 * may have kept one; an `empty` frame is still the signal).
 *
 * **Whether a project note can be taken back is the route's answer.** The
 * project's memory list says `canWrite` (`project:memory:write`, what the
 * panel is given by its page), and names the notes of this conversation that
 * are still active, so a row whose note was removed elsewhere says so instead
 * of offering to remove it again. Asked when the chip is opened.
 */

import { useEffect, useMemo, useRef } from 'react'
import { create } from 'zustand'
import { useChatStore } from '../store'
import type { PersonalTurnNote, TurnMemoryItem } from '../lib/turn-memory'
import type { TurnView } from '../lib/turn-fold'

/** One of the reader's personal notes of a conversation, with the answer it was saved under. */
export interface ConversationPersonalNote extends PersonalTurnNote {
  sourceMessageId: string | null
}

/**
 * Where taking a note back stands. `gone`: the note was already removed when
 * the reader asked (or is no longer active in the project's memory).
 */
export type NoteRemoval = 'removing' | 'removed' | 'gone' | 'failed'

/** What the project's memory list says to this reader about one conversation's notes. */
export interface ProjectShelfAccess {
  /** The reader may edit and remove the project's notes. */
  canWrite: boolean
  /** The conversation's notes that are still active; null when the list did not fit one page. */
  activeIds: readonly string[] | null
}

interface TurnNotesState {
  /** The reader's personal notes, by the conversation they were saved from. */
  personal: Record<string, readonly ConversationPersonalNote[]>
  /** By `shelfKey(projectId, conversationId)`. */
  shelves: Record<string, ProjectShelfAccess>
  /** By note id. */
  removals: Record<string, NoteRemoval>
}

export const useTurnNotes = create<TurnNotesState>()(() => ({ personal: {}, shelves: {}, removals: {} }))

const NO_NOTES: readonly ConversationPersonalNote[] = []
/** One page; a person holds a few dozen notes in all (ADR-0180 rule 3). */
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

/** Reads in flight, so every answer of a thread asking at once costs one request. */
const loadingPersonal = new Map<string, Promise<void>>()
const loadingShelves = new Map<string, Promise<void>>()
/** Conversations whose notes were asked for again during a read: read once more after it. */
const stalePersonal = new Set<string>()

/**
 * Read the reader's personal notes of the conversation. Fail-soft: a failed
 * read leaves what was known, and the chip shows no personal row it cannot
 * vouch for.
 */
export function loadPersonalNotes(conversationId: string, options: { again?: boolean } = {}): Promise<void> {
  const running = loadingPersonal.get(conversationId)
  if (running) {
    // Asked AGAIN while a read is under way: that read may predate the note.
    // A second answer of the thread asking for the first time just joins it.
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

/** Ask the project's memory what this reader may do with the conversation's notes. Fail-soft: no answer, no action. */
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
      const rows = Array.isArray(body.items) ? body.items : []
      const ids = rows.flatMap((row) => (isRecord(row) && typeof row.id === 'string' ? [row.id] : []))
      const access: ProjectShelfAccess = {
        canWrite: body.canWrite === true,
        activeIds: body.nextCursor === null || body.nextCursor === undefined ? ids : null,
      }
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

/** The item route that deletes this note, by the shelf it is on; null when the turn cannot name it. */
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

/**
 * Take a note back: DELETE on its own item route, in the reader's session, so
 * the route's authorization decides. A 404 is a note that was already removed.
 */
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

/**
 * What the answer's own turn has said so far that can change the reader's
 * notes: its result arrived (the `remember` tool may have kept one), and its
 * reflection stage reported, with content or without (`empty` is how a pass
 * that kept only a personal note reports). Empty for an answer whose turn is
 * not in this tab's memory, a reloaded thread: its notes are in the first read.
 */
const turnSignal =
  (messageId: string | null | undefined) =>
  (state: { turns?: Record<string, TurnView> }): string => {
    if (!messageId) return ''
    const view = Object.values(state.turns ?? {}).find((turn) => turn.messageId === messageId)
    const reflected = view?.stages.memory_reflection?.status
    return view?.result ? `answered:${reflected ?? ''}` : ''
  }

/**
 * The reader's own personal notes saved under this answer. The conversation's
 * list is read once, by whichever answer mounts first, and again when this
 * answer's turn says it may have changed.
 */
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

/** What the project's memory said about the conversation's notes; undefined until asked. */
export function useProjectShelf(
  projectId: string | null | undefined,
  conversationId: string | null | undefined
): ProjectShelfAccess | undefined {
  return useTurnNotes((state) =>
    projectId && conversationId ? state.shelves[shelfKey(projectId, conversationId)] : undefined
  )
}

/** Specs only: forget everything read and removed. */
export function resetTurnNotes(): void {
  loadingPersonal.clear()
  loadingShelves.clear()
  stalePersonal.clear()
  useTurnNotes.setState({ personal: {}, shelves: {}, removals: {} })
}
