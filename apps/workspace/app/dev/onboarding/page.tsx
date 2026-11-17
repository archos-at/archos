'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { OrganizationSetup } from '@/features/onboarding/components/organization-setup'
import type { JSX } from 'react'

function Preview(): JSX.Element {
  const state = useSearchParams().get('state') ?? 'form'
  const [createdName, setCreatedName] = useState<string | null>(
    state === 'done' ? 'Musterarchitektur ZT GmbH' : null,
  )

  return (
    <OrganizationSetup
      email="anna.berger@example.at"
      selfServeDisabled={state === 'invite-only'}
      createdName={createdName}
      error={state === 'error' ? 'Failed to create organization.' : null}
      onCreate={async ({ name }) => {
        await new Promise((resolve) => setTimeout(resolve, 600))
        setCreatedName(name)
      }}
      onSignOut={() => {}}
    />
  )
}

export default function OnboardingPreview(): JSX.Element {
  return (
    <Suspense>
      <Preview />
    </Suspense>
  )
}
