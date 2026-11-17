'use client'

/**
 * Dev preview for „Mein Gedächtnis“ (ADR-0180): the REAL `PersonalMemoryPanel`
 * over a fetch shim for `/api/user/memory`, so every state is reviewable
 * without a backend. Pick one with the toggles or open it by address:
 *
 *   ?state=notes      five notes, one pinned, three topics and one without; add,
 *                     edit, pin, remove, move to a topic, and rename, merge,
 *                     ungroup or remove a topic work the way the server does
 *   ?state=empty      no note yet
 *   ?state=loading    the list never answers
 *   ?state=error      the list answers 500
 *   ?state=conflict   every edit of a text answers 409 (another note says it)
 *
 * The shim answers the list with `topics` (the counts of the notes it holds)
 * and honours `?topic=` the way the list route does: an empty value is the
 * notes without a topic. The topic routes move and remove notes in the shim's
 * own copy, so a preview session can see the result.
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
  topic: string | null
  sourceConversationId: string | null
  createdAt: string
  updatedAt: string
}

/** The body of a topic route: a rename or merge (`from`, `to`) or a removal (`name`). */
type Body = Partial<Note> & { from?: string | null; to?: string | null; name?: string }

const note = (id: string, kind: Note['kind'], content: string, overrides: Partial<Note> = {}): Note => ({
  id,
  kind,
  content,
  provenanceType: 'agent',
  pinned: false,
  topic: null,
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
    { topic: 'Brandschutz', updatedAt: '2026-11-09T15:40:00Z' }
  ),
  note(
    '5f0a4c88-0000-4000-8000-0000000000a3',
    'preference',
    'Flächenangaben immer in Quadratmetern mit einer Nachkommastelle.',
    { provenanceType: 'distillation', topic: 'Flächen', updatedAt: '2026-11-06T11:05:00Z' }
  ),
  note(
    '5f0a4c88-0000-4000-8000-0000000000a4',
    'preference',
    'Bei Stellplatzfragen zuerst die Stellplatzsatzung der Gemeinde nennen, dann den Bebauungsplan.',
    { topic: 'Stellplätze', updatedAt: '2026-11-05T10:20:00Z' }
  ),
  note(
    '5f0a4c88-0000-4000-8000-0000000000a5',
    'preference',
    'Brandschutznachweise immer mit Fundstelle im Entwurf nennen.',
    { topic: 'Brandschutz', updatedAt: '2026-11-04T14:00:00Z' }
  ),
]

/** What the shim serves; the page sets both before it mounts the panel. */
const server: { state: PreviewState; notes: Note[] } = { state: 'notes', notes: [...SEED] }

/** Two topics name one topic when they differ only in case (`resolveTopic`, the German rules); null is no topic. */
function sameTopic(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b
  return a.toLocaleLowerCase('de') === b.toLocaleLowerCase('de')
}

/** The topics of the notes with how many each holds, most first (`summarizeTopics`). */
function topicSummary(notes: Note[]): { name: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const candidate of notes) {
    if (candidate.topic !== null) counts.set(candidate.topic, (counts.get(candidate.topic) ?? 0) + 1)
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'de'))
}

/** The topic a write stores: the spelling the shelf already has, else the text itself (`resolveTopic`). */
function resolveName(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim().replace(/\s+/g, ' ')
  if (text === '') return null
  return topicSummary(server.notes).find((topic) => sameTopic(topic.name, text))?.name ?? text
}

/** `PATCH` moves every note on `from` to `to` (a `to` another topic has merges them); `DELETE` removes the notes on `name`. */
function answerTopics(method: string, body: Body): Response {
  if (method === 'PATCH') {
    const from = body.from ?? null
    const to = resolveName(body.to)
    const moved = server.notes.filter((candidate) => sameTopic(candidate.topic, from)).length
    const now = new Date().toISOString()
    server.notes = server.notes.map((candidate) =>
      sameTopic(candidate.topic, from) ? { ...candidate, topic: to, updatedAt: now } : candidate
    )
    return Response.json({ moved })
  }
  if (method === 'DELETE') {
    const name = body.name ?? null
    const removed = server.notes.filter((candidate) => sameTopic(candidate.topic, name)).length
    server.notes = server.notes.filter((candidate) => !sameTopic(candidate.topic, name))
    return Response.json({ removed })
  }
  return Response.json({ error: 'Method not allowed' }, { status: 405 })
}

async function answer(url: string, init?: RequestInit): Promise<Response> {
  const method = init?.method ?? 'GET'
  const { pathname, searchParams } = new URL(url, 'http://preview.local')
  const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Body) : {}
  if (method === 'GET') {
    if (server.state === 'loading') return new Promise<Response>(() => {})
    if (server.state === 'error') return Response.json({ error: 'Internal error' }, { status: 500 })
    // `?topic=`: the notes of that topic, an empty value the notes without one.
    const topic = searchParams.get('topic')
    const items =
      topic === null ? server.notes : server.notes.filter((candidate) => sameTopic(candidate.topic, topic === '' ? null : topic))
    return Response.json({ items, nextCursor: null, topics: topicSummary(server.notes) })
  }
  if (method === 'POST') {
    const created = note(crypto.randomUUID(), body.kind ?? 'preference', body.content ?? '', {
      provenanceType: 'user',
      topic: resolveName(body.topic),
      updatedAt: new Date().toISOString(),
    })
    server.notes = [created, ...server.notes]
    return Response.json({ item: created }, { status: 201 })
  }
  if (pathname === '/api/user/memory/topics') return answerTopics(method, body)
  const id = pathname.split('/').pop()
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
      if (path === '/api/user/memory' || path.startsWith('/api/user/memory/')) return answer(url, init)
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
      <PageHeader title={t('title')} subtitle={t('subtitle')} subtitleOnPhone />
      {/* Keyed by the state: each one is a fresh mount and a fresh load. */}
      <PersonalMemoryPanel key={state} />
    </main>
  )
}
