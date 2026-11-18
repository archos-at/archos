'use client'

import type { JSX } from 'react'
import { notFound } from 'next/navigation'
import { PlatformRetrievalSettings } from '@/app/app/(shell)/platform/retrieval/platform-retrieval-settings'
import { PageHeader } from '@/components/ui/page-header'
import { useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import { RETRIEVAL_SETTINGS } from '@/lib/retrieval-settings/catalog'

const DEFINITIONS = RETRIEVAL_SETTINGS

interface SettingFixture {
  key: string
  value: number
  defaultValue: number
  overridden: boolean
  updatedByEmail: string | null
  updatedAt: string | null
  note: string | null
}

const PINNED: Record<string, { value: number; note: string }> = {
  'knowledge.top_k': { value: 20, note: 'mehr Kontext für Querschnittsfragen' },
  'web.max_results': { value: 10, note: 'breitere Websuche' },
}

const SETTINGS: SettingFixture[] = DEFINITIONS.map((definition) => {
  const pinned = PINNED[definition.key]
  return {
    key: definition.key,
    value: pinned?.value ?? definition.defaultValue,
    defaultValue: definition.defaultValue,
    overridden: pinned !== undefined,
    note: pinned?.note ?? null,
    updatedByEmail: pinned ? 'owner@app.example' : null,
    updatedAt: pinned ? '2026-07-28T09:00:00Z' : null,
  }
})

const PREVIEW_PATH = '/dev/platform-retrieval'

function installShim(): void {
  if (typeof window === 'undefined' || process.env.NODE_ENV !== 'development') return
  const w = window as unknown as { __platformRetrievalSettingsShim?: boolean }
  if (w.__platformRetrievalSettingsShim) return
  w.__platformRetrievalSettingsShim = true
  const real = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (
      window.location.pathname.startsWith(PREVIEW_PATH) &&
      url.startsWith('/api/platform/retrieval-settings')
    ) {
      if (init?.method === 'PUT') return Response.json({ ok: true })
      return Response.json({ definitions: DEFINITIONS, settings: SETTINGS })
    }
    return real(input, init)
  }
}

installShim()

export default function PlatformRetrievalDevPage(): JSX.Element {
  const t = useTranslations(platformCopy)
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }

  return (
    <main
      className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8 md:px-8"
      data-testid="platform-retrieval-preview"
    >
      <PageHeader
        title={t('sections.retrieval.title')}
        subtitle={t('sections.retrieval.subtitle')}
      />
      <PlatformRetrievalSettings />
    </main>
  )
}
