'use client'

/**
 * Dev preview for „Mein Gedächtnis“ (ADR-0180): the REAL `PersonalMemoryPanel`
 * over a fetch shim for `/api/user/memory`, so every state is reviewable
 * without a backend. Pick one with the toggles or open it by address:
 *
 *   ?state=notes      three notes, one pinned; add, edit, pin and remove work
 *   ?state=empty      no note yet
 *   ?state=loading    the list never answers
 *   ?state=error      the list answers 500
 *   ?state=conflict   every edit of a text answers 409 (another note says it)
 *
 * The shim is installed at MODULE scope, not in an effect: a child's effect
 * fires first and would race a parent's fetch patch. Not linked from anywhere
 * and 404s outside development (see ../layout.tsx).
 */

import type { JSX } from 'react'
import { PageHeader } from '@/components/ui/page-header'
import { PersonalMemoryPanel } from '@/features/personal-memory'
import { useTranslations } from '@/i18n'
import { personalMemoryCopy } from '@/i18n/namespaces/personal-memory'
import { PreviewStatePicker, usePreviewState } from '../_fixtures/preview-state'

const STATES = ['notes', 'empty', 'loading', 'error', 'conflict'] as const
type PreviewState = (typeof STATES)[number]

interface Note {
  id: string
  kind: 'preference' | 'profile'
  content: string
  provenanceType: 'agent' | 'user' | 'distillation'
  pinned: boolean
  sourceConversationId: string | null
  createdAt: string
  updatedAt: string
}

const note = (id: string, kind: Note['kind'], content: string, overrides: Partial<Note> = {}): Note => ({
  id,
  kind,
  content,
  provenanceType: 'agent',
  pinned: false,
  sourceConversationId: null,
  createdAt: '2026-11-03T09:00:00Z',
  updatedAt: '2026-11-03T09:00:00Z',
  ...overrides,
})

const SEED: Note[] = [
  note('5f0a4c88-0000-4000-8000-0000000000a1', 'preference', 'Antworten bitte knapp, mit der Fundstelle am Ende jedes Absatzes.', {
    pinned: true,
    provenanceType: 'user',
    updatedAt: '2026-11-10T08:12:00Z',
  }),
  note(
    '5f0a4c88-0000-4000-8000-0000000000a2',
    'profile',
    'Leitet im Büro die Einreichplanung und ist Ansprechperson für Brandschutzfragen.',
    { updatedAt: '2026-11-09T15:40:00Z' }
  ),
  note(
    '5f0a4c88-0000-4000-8000-0000000000a3',
    'preference',
    'Flächenangaben immer in Quadratmetern mit einer Nachkommastelle.',
    { provenanceType: 'distillation', updatedAt: '2026-11-06T11:05:00Z' }
  ),
]

/** What the shim serves; the page sets both before it mounts the panel. */
const server: { state: PreviewState; notes: Note[] } = { state: 'notes', notes: [...SEED] }

async function answer(url: string, init?: RequestInit): Promise<Response> {
  const method = init?.method ?? 'GET'
  const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Partial<Note>) : {}
  if (method === 'GET') {
    if (server.state === 'loading') return new Promise<Response>(() => {})
    if (server.state === 'error') return Response.json({ error: 'Internal error' }, { status: 500 })
    return Response.json({ items: server.notes, nextCursor: null })
  }
  if (method === 'POST') {
    const created = note(crypto.randomUUID(), body.kind ?? 'preference', body.content ?? '', {
      provenanceType: 'user',
      updatedAt: new Date().toISOString(),
    })
    server.notes = [created, ...server.notes]
    return Response.json({ item: created }, { status: 201 })
  }
  const id = url.split('/').pop()
  const existing = server.notes.find((candidate) => candidate.id === id)
  if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })
  if (method === 'DELETE') {
    server.notes = server.notes.filter((candidate) => candidate.id !== id)
    return new Response(null, { status: 204 })
  }
  if (server.state === 'conflict' && body.content !== undefined) {
    return Response.json({ error: 'Another personal note already says this' }, { status: 409 })
  }
  const updated = { ...existing, ...body, updatedAt: new Date().toISOString() }
  server.notes = server.notes.map((candidate) => (candidate.id === id ? updated : candidate))
  return Response.json({ item: updated })
}

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const w = window as unknown as { __personalMemoryShim?: boolean }
  if (!w.__personalMemoryShim) {
    w.__personalMemoryShim = true
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const path = url.split('?')[0]
      if (path === '/api/user/memory' || path.startsWith('/api/user/memory/')) return answer(path, init)
      return real(input, init)
    }
  }
}

export default function PersonalMemoryDevPage(): JSX.Element {
  const t = useTranslations(personalMemoryCopy)
  const [state, setState] = usePreviewState(STATES)
  server.state = state
  server.notes = state === 'empty' ? [] : [...SEED]
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 md:px-8" data-testid="personal-memory-preview">
      <PreviewStatePicker label="State" states={STATES} value={state} onChange={setState} />
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      {/* Keyed by the state: each one is a fresh mount and a fresh load. */}
      <PersonalMemoryPanel key={state} />
    </main>
  )
}
