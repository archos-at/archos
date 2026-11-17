'use client'

import { notFound } from 'next/navigation'
import { use } from 'react'

import { ProjectIntakeWizard } from '@/features/projects/components/project-intake-wizard'
import { projectIntakeDefinitionV1 } from '@/lib/project-profile/intake-definition'
import type { ProjectProfile } from '@/lib/project-profile/types'

const fact = (value: unknown) => ({
  value: value as never,
  confidence: 'confirmed' as const,
  source: 'onboarding' as const,
  updatedAt: '2026-08-01T00:00:00.000Z',
})

const EXISTING_PROFILE: ProjectProfile = {
  facts: {
    project_name: fact('Demo · Hoftrakt Lacknergasse'),
    site_address: fact('Lacknergasse 12, 1170 Wien'),
    country: fact('at'),
    federal_state: fact('vienna'),
    work_type: fact(['refurbishment', 'conversion']),
    project_phase: fact('preliminary_design'),
    'building_name@bldg1': fact('Hoftrakt'),
    'building_type@bldg1': fact('building'),
    'construction_status@bldg1': fact('existing'),
    'existing_year_built@bldg1': fact(1962),
    'existing_use@bldg1': fact('Werkstatt und Lager'),
    'heritage_protection@bldg1': fact(false),
    'existing_measures@bldg1': fact(['envelope_refurbishment', 'interior_conversion']),
    'existing_storeys_above_ground@bldg1': fact(3),
    'storeys_above_ground@bldg1': fact(4),
  },
  goals: {},
  unknowns: [],
  assumptions: {},
}

export default function IntakeGalleryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }
  const params = use(searchParams)
  const existing = params.variant === 'existing'

  return (
    <main className="bg-background min-h-screen">
      <ProjectIntakeWizard
        key={existing ? 'existing' : 'default'}
        projectId={existing ? 'dev-bestand' : 'dev'}
        projectName={existing ? 'Demo · Hoftrakt Lacknergasse' : 'Demo · WHA Quellenstraße'}
        mode={existing ? 'edit' : 'create'}
        initialStep={existing ? 2 : 0}
        initialProfile={existing ? EXISTING_PROFILE : null}
        definitionOverride={projectIntakeDefinitionV1}
      />
    </main>
  )
}
