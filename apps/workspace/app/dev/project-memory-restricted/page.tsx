'use client'

import type { JSX } from 'react'
import { notFound } from 'next/navigation'

import { ProjectMemoryPanel } from '@/features/projects/components/project-memory-panel'

const CLEARED = 'dev-memory-cleared'
const UNCLEARED = 'dev-memory-uncleared'
const RESTRICTED_FOLDER = '01234567-89ab-4cde-8f01-23456789abcd'

interface ShelfItem {
  id: string
  topic: string | null
  restrictedFolderIds: string[] | null
  [field: string]: unknown
}

interface ShelfBody {
  topic?: string | null
  from?: string | null
  to?: string | null
}

function item(id: string, kind: string, content: string, overrides: Partial<ShelfItem> = {}): ShelfItem {
  return {
    id,
    scope: 'project',
    projectId: CLEARED,
    organizationId: 'org_dev',
    kind,
    content,
    status: 'active',
    confidence: 'high',
    verification: 'unverified',
    provenanceType: 'distillation',
    sourceConversationId: null,
    supersedesId: null,
    conflictsWithId: null,
    restrictedFolderIds: null,
    restrictionJudge: null,
    salience: 0.5,
    pinned: false,
    topic: null,
    createdBy: null,
    lastReferencedAt: null,
    recallCount: 0,
    embedding: null,
    embeddingModel: null,
    embeddedAt: null,
    createdAt: '2026-10-01T09:00:00Z',
    updatedAt: '2026-10-02T08:30:00Z',
    ...overrides,
  }
}

const OPEN = [
  item('m-open-1', 'decision', 'Die Bauherrschaft hat sich für ein extensiv begrüntes Flachdach entschieden.', { topic: 'Dach' }),
  item('m-open-2', 'constraint', 'Gebäudeklasse 4 nach OIB-RL 2, Fluchtniveau 10,4 m.', { topic: 'Brandschutz' }),
  item('m-open-3', 'open_question', 'Ist die Stellplatzablöse mit der Gemeinde schon geklärt?', { topic: 'Stellplätze' }),
  item('m-open-4', 'derived_fact', 'Bruttogeschossfläche 3.210 m² laut Entwurf vom 2. Oktober.'),
]
const RESTRICTED = item(
  'm-restricted-1',
  'derived_fact',
  'Das Honorar für die Leistungsphasen 5–8 ist mit 184.000 € netto pauschal vereinbart.',
  { restrictedFolderIds: [RESTRICTED_FOLDER], restrictedFolderNames: ['Verträge'], topic: 'Honorar' }
)
const JUDGED = item(
  'm-restricted-2',
  'decision',
  'Die Nachtragsforderung des Statikers wird erst nach Prüfung der Mehrmassen freigegeben.',
  { restrictedFolderIds: [RESTRICTED_FOLDER], restrictedFolderNames: ['Verträge'], restrictionJudge: 'drawn', topic: 'Honorar' }
)
const OFFICE = item('m-office-1', 'constraint', 'Büro: Die Bauordnung gilt für jedes Projekt.', {
  scope: 'organization',
  projectId: null,
  topic: 'Bauordnung',
})

const SHELVES: Record<string, ShelfItem[]> = {
  [CLEARED]: [RESTRICTED, JUDGED, ...OPEN, OFFICE],
  [UNCLEARED]: [...OPEN, OFFICE],
}

function sameTopic(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b
  return a.toLocaleLowerCase('de') === b.toLocaleLowerCase('de')
}

function topicSummary(shelf: ShelfItem[]): { name: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const candidate of shelf) {
    if (candidate.topic !== null) counts.set(candidate.topic, (counts.get(candidate.topic) ?? 0) + 1)
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'de'))
}

function resolveName(raw: string | null | undefined, shelf: ShelfItem[]): string | null {
  const text = (raw ?? '').trim().replace(/\s+/g, ' ')
  if (text === '') return null
  return topicSummary(shelf).find((topic) => sameTopic(topic.name, text))?.name ?? text
}

function filterByTopic(shelf: ShelfItem[], topic: string | null): ShelfItem[] {
  if (topic === null) return shelf
  return shelf.filter((candidate) => sameTopic(candidate.topic, topic === '' ? null : topic))
}

function renameTopic(projectId: string, body: ShelfBody): Response {
  const shelf = SHELVES[projectId]
  const from = body.from ?? null
  const to = resolveName(body.to, shelf)
  const onProject = (candidate: ShelfItem) => candidate.scope === 'project' && sameTopic(candidate.topic, from)
  const moved = shelf.filter(onProject).length
  SHELVES[projectId] = shelf.map((candidate) => (onProject(candidate) ? { ...candidate, topic: to } : candidate))
  return Response.json({ moved })
}

function moveNote(projectId: string, itemId: string, body: ShelfBody): Response {
  const shelf = SHELVES[projectId]
  const existing = shelf.find((candidate) => candidate.id === itemId && candidate.scope === 'project')
  if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })
  const moved = { ...existing, topic: resolveName(body.topic, shelf), updatedAt: new Date().toISOString() }
  SHELVES[projectId] = shelf.map((candidate) => (candidate.id === itemId ? moved : candidate))
  return Response.json({ item: moved })
}

function moveOfficeNote(itemId: string, body: ShelfBody): Response {
  const existing = SHELVES[CLEARED].find((candidate) => candidate.id === itemId && candidate.scope === 'organization')
  if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })
  const office = SHELVES[CLEARED].filter((candidate) => candidate.scope === 'organization')
  const moved = { ...existing, topic: resolveName(body.topic, office), updatedAt: new Date().toISOString() }
  for (const projectId of Object.keys(SHELVES)) {
    SHELVES[projectId] = SHELVES[projectId].map((candidate) => (candidate.id === itemId ? moved : candidate))
  }
  return Response.json({ item: moved })
}

async function answerShelf(projectId: string, segment: string | undefined, url: URL, init?: RequestInit): Promise<Response> {
  const method = init?.method ?? 'GET'
  const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as ShelfBody) : {}
  if (method === 'GET' && segment === undefined) {
    const shelf = SHELVES[projectId]
    const items = filterByTopic(shelf, url.searchParams.get('topic'))
    return Response.json({ items, nextCursor: null, topics: topicSummary(shelf) })
  }
  if (method === 'PATCH' && segment === 'topics') return renameTopic(projectId, body)
  if (method === 'PATCH' && segment !== undefined) return moveNote(projectId, segment, body)
  return Response.json({ error: 'Method not allowed' }, { status: 405 })
}

const SHELF_PATH = /^\/api\/projects\/([^/]+)\/memory(?:\/([^/]+))?$/
const OFFICE_NOTE_PATH = /^\/api\/organization\/memory\/([^/]+)$/

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const w = window as unknown as { __restrictedMemoryShim?: boolean }
  if (!w.__restrictedMemoryShim) {
    w.__restrictedMemoryShim = true
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const parsed = new URL(url, 'http://preview.local')
      const match = SHELF_PATH.exec(parsed.pathname)
      if (match && SHELVES[match[1]]) return answerShelf(match[1], match[2], parsed, init)
      const office = OFFICE_NOTE_PATH.exec(parsed.pathname)
      if (office && init?.method === 'PATCH') {
        const body = typeof init.body === 'string' ? (JSON.parse(init.body) as ShelfBody) : {}
        return moveOfficeNote(office[1], body)
      }
      return real(input, init)
    }
  }
}

export default function RestrictedMemoryDevPage(): JSX.Element {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }
  return (
    <main className="mx-auto grid max-w-6xl grid-cols-1 gap-8 p-4 sm:p-8 lg:grid-cols-2" data-testid="restricted-memory-preview">
      <section className="min-w-0 space-y-3">
        <h1 className="text-lg font-semibold">Freigegeben für „Verträge“</h1>
        <ProjectMemoryPanel projectId={CLEARED} />
      </section>
      <section className="min-w-0 space-y-3">
        <h1 className="text-lg font-semibold">Nicht freigegeben</h1>
        <ProjectMemoryPanel projectId={UNCLEARED} />
      </section>
    </main>
  )
}
