'use client'

import type { JSX } from 'react'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { SectionLabel } from '@/components/ui/section-label'
import { RunKillSwitch, type KillResult } from '@/app/app/(shell)/platform/run-kill-switch'
import {
  VectorMaintenance,
  type ReconcileResult,
} from '@/app/app/(shell)/platform/vector-maintenance'
import { PlatformAccessProvider } from '@/features/platform/platform-access'
import { I18nProvider, useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'

const RESULT: ReconcileResult = {
  collectionsScanned: 24,
  orphansFound: 6,
  orphansDeleted: 1148,
  summariesForgotten: 3,
  failures: [
    { collectionName: 'org-nordbau_proj-hafenspeicher', error: 'list returned 503' },
    { collectionName: 'org-lindner_proj-schulcampus-ost', error: 'delete returned 500' },
  ],
}

const KILL_RESULT: KillResult = {
  jobsFound: 7,
  jobsKilled: 6,
  jobsAlreadyFinished: 1,
  runsClosed: 2,
  failures: [{ id: 'job-4f2c', error: 'worker unreachable' }],
  truncated: false,
}

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const w = window as unknown as { __platformMaintenanceShim?: boolean }
  if (!w.__platformMaintenanceShim) {
    w.__platformMaintenanceShim = true
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.startsWith('/api/platform/maintenance/reconcile-vectors')) {
        return Response.json(RESULT)
      }
      if (url.startsWith('/api/platform/maintenance/kill-runs')) {
        return Response.json(KILL_RESULT)
      }
      return real(input, init)
    }
  }
}

function Preview(): JSX.Element {
  const t = useTranslations(platformCopy)
  return (
    <main
      data-testid="platform-maintenance-preview"
      className="mx-auto flex max-w-4xl flex-col gap-12 px-4 py-8 md:px-8"
    >
      <div className="flex flex-col gap-6">
        <PageHeader
          title={t('sections.maintenance.title')}
          subtitle={t('sections.maintenance.subtitle')}
        />
        <VectorMaintenance />
        <RunKillSwitch />
      </div>

      <section className="flex flex-col gap-6">
        <SectionLabel as="h2">Nach einem Lauf</SectionLabel>
        <VectorMaintenance initialResult={RESULT} />
        <RunKillSwitch initialResult={KILL_RESULT} />
      </section>

      {/* The read-only support role: same explanation, no way to fire it. */}
      <section className="flex flex-col gap-6">
        <SectionLabel as="h2">Nur Lesezugriff (platform:settings:view)</SectionLabel>
        <PlatformAccessProvider permissions={[PLATFORM_PERMISSIONS.settingsView]}>
          <RunKillSwitch />
        </PlatformAccessProvider>
      </section>
    </main>
  )
}

export default function PlatformMaintenanceDevPage(): JSX.Element {
  if (process.env.NODE_ENV !== 'development') notFound()
  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <Preview />
    </I18nProvider>
  )
}
