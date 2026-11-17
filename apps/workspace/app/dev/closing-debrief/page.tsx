'use client'

import type { JSX } from 'react'
import { useEffect, useState } from 'react'

import { I18nProvider } from '@/i18n'
import { answerProjectRecord } from '../_fixtures/project-record'
import { ProjectLifecycleCard } from '@/features/projects/components/project-lifecycle-card'
import { projectIntakeDefinitionV1 } from '@/lib/project-profile/intake-definition'
import { buildIntakeProfile } from '@/lib/project-profile/intake-profile'
import type { ProjectAssumption, ProjectPrimitiveValue, ProjectProfile } from '@/lib/project-profile/types'

type Variant = 'default' | 'readonly' | 'empty' | 'structure'
const PROJECT = 'dev-closing-debrief'
const EMPTY = 'dev-closing-debrief-empty'

function item(id: string, kind: string, content: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    scope: 'project',
    projectId: PROJECT,
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
    salience: 0.5,
    pinned: false,
    createdBy: null,
    lastReferencedAt: null,
    recallCount: 0,
    createdAt: '2026-09-01T09:00:00Z',
    updatedAt: '2026-09-02T08:30:00Z',
    ...overrides,
  }
}

const MEMORY = [
  item(
    'm-1',
    'decision',
    'Kapselung K₂60 der Holzdecken mit zweilagigen Gipsfaserplatten statt Gipskarton, weil dafür ein Prüfbericht für die Fuge vorlag.'
  ),
  item('m-2', 'constraint', 'Die BH Baden verlangt die Fluchtwegbreiten in jedem Geschoßgrundriss bemaßt.', { pinned: true }),
  item('m-3', 'decision', 'Laubengang statt zweitem Stiegenhaus; Fluchtniveau unter 11\u00a0m gehalten.'),
  item('m-4', 'derived_fact', 'Die Dachlast beträgt 2 kN/m².'),
  item(
    'm-5',
    'decision',
    'Fluchttreppe außen in Stahl statt eines zweiten Stiegenhauses, weil die Brandwand im Bestand nicht durchbrochen werden durfte.',
    { verification: 'source_grounded', evidence: [{ fileName: 'Bescheid.pdf', page: '3' }] }
  ),
]

const built = (answers: Record<string, ProjectPrimitiveValue>): ProjectProfile =>
  buildIntakeProfile(answers, projectIntakeDefinitionV1, { buildings: [{ id: 'bldg1', name: 'Haupthaus' }] })

const suggested = (value: ProjectPrimitiveValue, reason: string): ProjectAssumption => ({
  value,
  status: 'unconfirmed',
  reason,
  source: 'agent_suggested',
  updatedAt: '2026-10-07T09:00:00Z',
})

const PROFILE: ProjectProfile = {
  ...built({
    A2_country: 'at',
    A2_land: 'lower_austria',
    'C1@bldg1': 'building',
    'C10@bldg1': ['timber', 'reinforced_concrete'],
    'D0@bldg1': ['residential'],
  }),
  assumptions: {
    work_type: suggested(['new_build'], 'Baubeschreibung.pdf, S. 2: „Neubau eines viergeschoßigen Wohnhauses“'),
    oib_edition: suggested('2019', 'Einreichplan.pdf, S. 1: „Nachweis nach OIB-Richtlinien 2019“'),
  },
}

const STRUCTURE = built({ A2_country: 'at', A2_land: 'tyrol', A5: ['new_build'], 'C1@bldg1': 'other' })

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const w = window as unknown as { __closingDebriefShim?: boolean }
  if (!w.__closingDebriefShim) {
    w.__closingDebriefShim = true
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const projectRecord = await answerProjectRecord(PROJECT, url, init)
      if (projectRecord) return projectRecord
      if (url === `/api/projects/${EMPTY}/memory`) return Response.json({ items: [] })
      if (url === `/api/projects/${PROJECT}/memory` && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { content: string }
        return Response.json({ item: item(`m-${Date.now()}`, 'decision', body.content, { provenanceType: 'user' }) }, { status: 201 })
      }
      if (url === `/api/projects/${PROJECT}/memory`) return Response.json({ items: MEMORY })
      const patched = url.startsWith(`/api/projects/${PROJECT}/memory/`) && init?.method === 'PATCH'
      if (patched) {
        const found = MEMORY.find((entry) => url.endsWith(`/${entry.id}`))
        const body = JSON.parse(String(init?.body)) as { status?: string }
        return Response.json({ item: { ...found, ...(body.status ? { status: body.status } : { verification: 'user_confirmed' }) } })
      }
      if (url === `/api/projects/${PROJECT}/experience` && init?.method === 'POST') {
        await new Promise((resolve) => setTimeout(resolve, 1500))
        return Response.json({ suggested: 1, drafted: 1, documentsRead: ['Baubeschreibung.pdf', 'Bescheid.pdf'], error: null })
      }
      if (url === `/api/projects/${PROJECT}/profile/patches` && init?.method === 'POST') {
        return Response.json({ profile: PROFILE })
      }
      if (url.endsWith('/cleanup/proposal')) return Response.json({ items: [], considered: 0, aiUsed: false, aiError: null })
      if (url.endsWith('/status')) return new Response('{}', { status: 409 })
      return real(input, init)
    }
  }
}

export default function ClosingDebriefDevPage(): JSX.Element {
  const [variant, setVariant] = useState<Variant>('default')
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('variant')
    if (value === 'readonly' || value === 'empty' || value === 'structure') setVariant(value)
  }, [])

  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <main className="mx-auto max-w-3xl p-4 sm:p-8" data-testid="closing-debrief-preview">
        <ProjectLifecycleCard
          key={variant}
          projectId={variant === 'empty' ? EMPTY : PROJECT}
          lifecycle={{
            status: 'active',
            pausedAt: null,
            closedAt: null,
            closedOutcome: null,
            endedOn: null,
            startedOn: variant === 'empty' ? null : '2023-04',
            suggestedEndedOn: null,
            suggestedOutcome: null,
          }}
          profile={variant === 'empty' ? null : variant === 'structure' ? STRUCTURE : PROFILE}
          canWriteMemory={variant !== 'readonly'}
        />
      </main>
    </I18nProvider>
  )
}
