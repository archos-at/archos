'use client'

import { type ReactNode, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/adapters/auth/use-auth'
import { OrganizationSetup } from '@/features/onboarding/components/organization-setup'
import { TOUR_START_URL } from '@/lib/onboarding/product-tour'
import { useTranslations } from '@/i18n'
import { onboardingCopy } from '@/i18n/namespaces/onboarding'
import type { HomeCountry } from '@/lib/organizations/home-country'

const HANDOFF_DELAY_MS = 1200

const OrganizationOnboardingPage = (): ReactNode => {
  const t = useTranslations(onboardingCopy)
  const { user, signOut } = useAuth()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [createdName, setCreatedName] = useState<string | null>(null)
  const [selfServeDisabled, setSelfServeDisabled] = useState(false)

  useEffect(() => {
    fetch('/api/organizations')
      .then(async (res) => (res.ok ? ((await res.json()) as { selfServeDisabled?: boolean }) : {}))
      .then((policy) => setSelfServeDisabled(Boolean(policy.selfServeDisabled)))
      .catch(() => {})
  }, [])

  const create = async ({ name, homeCountry }: { name: string; homeCountry: HomeCountry }): Promise<void> => {
    setError(null)
    try {
      const response = await fetch('/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, homeCountry }),
      })

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        if (data.error === 'self-serve-disabled') throw new Error(t('errors.selfServeDisabled'))
        throw new Error(t('errors.createFailed'))
      }

      setCreatedName(name)
      setTimeout(() => router.replace(TOUR_START_URL), HANDOFF_DELAY_MS)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    }
  }

  return (
    <OrganizationSetup
      email={user?.email}
      selfServeDisabled={selfServeDisabled}
      createdName={createdName}
      error={error}
      onCreate={create}
      onSignOut={() => signOut()}
    />
  )
}

export default OrganizationOnboardingPage
