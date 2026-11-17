'use client'

import { notFound } from 'next/navigation'

import { I18nProvider } from '@/i18n'
import { DocumentRoleField } from '@/features/projects/components/document-role-field'
import { ProjectBasisStep } from '@/features/projects/components/project-basis-step'

const PROJECT_ID = 'preview-project'

const BINDINGS = [
  {
    id: 'b1',
    documentId: 'd1',
    role: 'development_plan',
    scopeInstanceId: null,
    confidence: 'declared',
    filename: 'bebauungsplan-1042.pdf',
    displayName: 'B-Plan 1042 · Plandokument',
  },
  {
    id: 'b2',
    documentId: 'd2',
    role: 'existing_plans',
    scopeInstanceId: 'bldg1',
    confidence: 'declared',
    filename: 'bestand-eg.pdf',
    displayName: 'Bestand Erdgeschoß',
  },
  {
    id: 'b3',
    documentId: 'd3',
    role: 'existing_plans',
    scopeInstanceId: 'bldg1',
    confidence: 'suggested',
    filename: 'schnitt-a-a.pdf',
    displayName: null,
  },
]

const DOCUMENTS = [
  { id: 'd1', filename: 'bebauungsplan-1042.pdf', displayName: 'B-Plan 1042 · Plandokument' },
  { id: 'd2', filename: 'bestand-eg.pdf', displayName: 'Bestand Erdgeschoß' },
  { id: 'd3', filename: 'schnitt-a-a.pdf', displayName: null },
  { id: 'd4', filename: 'lageplan-vermessung.pdf', displayName: 'Lageplan (Vermessung)' },
  { id: 'd5', filename: 'gutachten-baugrund.pdf', displayName: null },
]

if (typeof window !== 'undefined') {
  const real = window.fetch.bind(window)
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/document-roles')) {
      return new Response(JSON.stringify({ roles: BINDINGS }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url.includes('/api/documents?')) {
      return new Response(JSON.stringify({ documents: DOCUMENTS }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return real(input, init)
  }) as typeof window.fetch
}

const ANSWERS = {
  B2: 'yes',
  A5: ['Neubau', 'Abbruch'],
  'C2@bldg1': 'existing',
  'C2@bldg2': 'new_build',
}

const BUILDINGS = [
  { id: 'bldg1', name: 'Bestandsgebäude Hoftrakt' },
  { id: 'bldg2', name: 'Neubau Straßentrakt' },
]

export default function DocumentRolesPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <main className="mx-auto flex max-w-3xl flex-col gap-10 p-8">
        <section className="flex flex-col gap-3">
          <h1 className="text-lg font-semibold">Im Assistenten: Bebauungsplan</h1>
          <div className="rounded-xl border bg-card p-4">
            <DocumentRoleField
              projectId={PROJECT_ID}
              role="development_plan"
              label="Bebauungsplan ablegen"
            />
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Mehrere Blätter, ein Bauwerk</h2>
          <div className="rounded-xl border bg-card p-4">
            <DocumentRoleField
              projectId={PROJECT_ID}
              role="existing_plans"
              scopeInstanceId="bldg1"
              label="Bestandspläne — Bestandsgebäude Hoftrakt"
            />
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Modul I · Projektgrundlagen</h2>
          <ProjectBasisStep projectId={PROJECT_ID} answers={ANSWERS} buildings={BUILDINGS} />
        </section>
      </main>
    </I18nProvider>
  )
}
