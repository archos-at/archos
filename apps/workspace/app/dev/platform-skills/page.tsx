'use client'

import type { JSX } from 'react'
import type { SkillCategoryListItem } from '@/adapters/api/skills-client'

import { PageHeader } from '@/components/ui/page-header'
import { I18nProvider, useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import { PlatformSkillCatalog } from '@/app/app/(shell)/platform/skills/platform-skill-catalog'

const CATEGORIES: SkillCategoryListItem[] = [
  {
    id: 'cat-oib',
    name: 'OIB',
    description: null,
    slug: 'oib',
    sortOrder: 10,
    scope: 'platform',
  },
]

const SKILLS = [
  {
    id: 'ps-1',
    name: 'oib-fire-check',
    description: 'Checks a project against the OIB fire-safety guideline (OIB-Richtlinie 2).',
    body: 'Act as a fire-safety reviewer.\n\n1. Identify every fire-safety relevant building part.\n2. Verify each against OIB-Richtlinie 2.\n3. List deviations with the exact clause number.',
    metadata: { 'grid-agents': 'deep_researcher' },
    published: true,
    delivery: 'offer' as const,
    categoryId: 'cat-oib',
    createdAt: '2026-08-01T09:00:00Z',
    updatedAt: '2026-08-10T09:00:00Z',
  },
  {
    id: 'ps-3',
    name: 'oib-paragraph-citations',
    description:
      'Every normative claim carries the OIB clause it rests on — the house rule for the whole fleet.',
    body: 'When you state that something is required, permitted or forbidden, name the OIB-Richtlinie and the exact clause number it comes from.',
    metadata: {},
    published: true,
    delivery: 'offer' as const,
    categoryId: null,
    createdAt: '2026-08-12T09:00:00Z',
    updatedAt: '2026-08-12T09:00:00Z',
  },
  {
    id: 'ps-2',
    name: 'energy-certificate-check',
    description: 'Reviews the energy certificate against OIB-Richtlinie 6.',
    body: 'Compare the project’s energy certificate against OIB-Richtlinie 6 and list every value that misses its limit.',
    metadata: {},
    published: false,
    delivery: 'offer' as const,
    categoryId: 'cat-oib',
    createdAt: '2026-08-11T09:00:00Z',
    updatedAt: '2026-08-11T09:00:00Z',
  },
]

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const w = window as unknown as { __platformSkillsShim?: boolean }
  if (!w.__platformSkillsShim) {
    w.__platformSkillsShim = true
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
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url === '/api/platform/skills') {
        return Response.json({ skills: SKILLS })
      }
      if (url === '/api/platform/skill-categories' && method === 'GET') {
        return Response.json({ categories })
      }
      if (url === '/api/platform/skill-categories' && method === 'POST') {
        const body = parseJsonBody(init?.body)
        const created = {
          id: `cat-dev-${Date.now()}`,
          name:
            typeof body?.name === 'string' && body.name.trim()
              ? body.name.trim()
              : 'Neue Kategorie',
          description: null,
          slug: null,
          sortOrder: 0,
          scope: 'platform' as const,
        }
        categories.push(created)
        return Response.json({ category: created }, { status: 201 })
      }
      const match = /^\/api\/platform\/skill-categories\/([^/]+)$/.exec(
        new URL(url, location.origin).pathname
      )
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
      if (url === '/api/platform/skill-categories') {
        return Response.json({ categories: CATEGORIES })
      }
      if (url.startsWith('/api/platform/skills/')) {
        return Response.json({ skill: SKILLS[0] })
      }
      return real(input, init)
    }
  }
}

function Preview(): JSX.Element {
  const t = useTranslations(platformCopy)
  return (
    <main
      className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8 md:px-8"
      data-testid="platform-skills-preview"
    >
      <PageHeader title={t('sections.skills.title')} subtitle={t('sections.skills.subtitle')} />
      <PlatformSkillCatalog />
    </main>
  )
}

export default function PlatformSkillsDevPage(): JSX.Element {
  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <Preview />
    </I18nProvider>
  )
}
