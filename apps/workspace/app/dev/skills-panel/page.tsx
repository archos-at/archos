'use client'

import type { JSX } from 'react'
import type { SkillCategoryListItem } from '@/adapters/api/skills-client'

import { I18nProvider } from '@/i18n'
import { SkillsPanel } from '@/features/skills/components/skills-panel'

const CATEGORIES: SkillCategoryListItem[] = [
  {
    id: 'cat-oib',
    name: 'OIB',
    description: null,
    slug: 'oib',
    sortOrder: 10,
    scope: 'platform',
  },
  {
    id: 'cat-eigene',
    name: 'Eigene Prüfungen',
    description: 'Büro-interne Abläufe.',
    slug: null,
    sortOrder: 0,
    scope: 'org',
  },
]

const SKILLS = [
  {
    id: 'skill-1',
    name: 'acoustic-report',
    description: 'Drafts the acoustic compliance report (OIB-Richtlinie 5).',
    body: 'Draft a report on sound insulation per OIB Richtlinie 5.\n\nUse the project documents as the source of truth for the building’s construction.',
    metadata: {},
    origin: 'org',
    enabled: true,
    clonedFrom: null,
    categoryId: 'cat-eigene',
    createdAt: '2026-07-10T09:00:00Z',
    updatedAt: '2026-07-16T09:00:00Z',
  },
  {
    id: 'skill-2',
    name: 'escape-routes',
    description: 'Verifies escape route widths and lengths against OIB-Richtlinie 2.3.',
    body: 'Verify every escape route’s width and length against OIB-Richtlinie 2.3.\n\nName each deviation with its exact clause.',
    metadata: { 'grid-agents': 'deep_researcher' },
    origin: 'org',
    enabled: false,
    clonedFrom: null,
    categoryId: null,
    createdAt: '2026-07-12T10:00:00Z',
    updatedAt: '2026-07-12T10:00:00Z',
  },
  {
    id: null,
    name: 'oib-fire-check',
    description: 'Checks a project against the OIB fire-safety guideline (OIB-Richtlinie 2).',
    body: 'Act as a fire-safety reviewer.\n\n1. Read the project brief and identify every fire-safety relevant building part.\n2. Verify each against OIB-Richtlinie 2 (brandschutztechnische Anforderungen).\n3. List deviations with the exact clause number and a suggested fix.',
    metadata: { 'grid-catalog': 'curated' },
    origin: 'platform',
    enabled: true,
    clonedFrom: null,
    categoryId: 'cat-oib',
    createdAt: null,
    updatedAt: null,
  },
  {
    id: null,
    name: 'energy-certificate-check',
    description: 'Reviews the energy certificate against OIB-Richtlinie 6.',
    body: 'Compare the project’s energy certificate against OIB-Richtlinie 6 and list every value that misses its limit.',
    metadata: { 'grid-catalog': 'curated', 'grid-agents': 'deep_researcher' },
    origin: 'platform',
    enabled: false,
    clonedFrom: null,
    categoryId: null,
    createdAt: null,
    updatedAt: null,
  },
]

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const w = window as unknown as { __skillsPanelShim?: boolean }
  if (!w.__skillsPanelShim) {
    w.__skillsPanelShim = true
    const categories: SkillCategoryListItem[] = [...CATEGORIES]

    const parseJsonBody = (body: BodyInit | null | undefined): { name?: unknown } => {
      if (typeof body !== 'string') return {}
      try {
        return JSON.parse(body) as { name?: unknown }
      } catch {
        return {}
      }
    }
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url === '/api/skills') {
        return Response.json({ skills: SKILLS, categories })
      }
      if (url === '/api/skill-categories' && method === 'GET') {
        return Response.json({ categories })
      }
      if (url === '/api/skill-categories' && method === 'POST') {
        const body = parseJsonBody(init?.body)
        const created = {
          id: `cat-dev-${Date.now()}`,
          name: typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : 'Neue Kategorie',
          description: null,
          slug: null,
          sortOrder: 0,
          scope: 'org' as const,
        }
        categories.push(created)
        return Response.json({ category: created }, { status: 201 })
      }
      const match = /^\/api\/skill-categories\/([^/]+)$/.exec(new URL(url, location.origin).pathname)
      if (match && (method === 'PATCH' || method === 'DELETE')) {
        const index = categories.findIndex((category) => category.id === match[1])
        if (index === -1) return Response.json({ error: 'not found' }, { status: 404 })
        if (method === 'DELETE') {
          categories.splice(index, 1)
          return Response.json({ deleted: true })
        }
        const body = parseJsonBody(init?.body)
        if (typeof body?.name === 'string' && body.name.trim()) {
          categories[index] = { ...categories[index], name: body.name.trim() }
        }
        return Response.json({ category: categories[index] })
      }
      if (url.startsWith('/api/skills/curated/')) {
        return Response.json({ skill: null })
      }
      return real(input, init)
    }
  }
}

export default function SkillsDevPage(): JSX.Element {
  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <main className="mx-auto flex flex-col gap-6 p-8" data-testid="skills-panel-preview">
        <SkillsPanel canManageOrgSkills />
      </main>
    </I18nProvider>
  )
}
