'use client'

import type { JSX } from 'react'
import { notFound } from 'next/navigation'
import { PlatformModelDefaults } from '@/app/app/(shell)/platform/models/platform-model-defaults'
import { PageHeader } from '@/components/ui/page-header'
import { SectionLabel } from '@/components/ui/section-label'
import { PlatformAccessProvider } from '@/features/platform/platform-access'
import { useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { AGENT_GROUPS as REGISTRY } from '@/lib/model-config/agent-groups'

const AGENT_GROUPS = REGISTRY.map(({ id, label, description }) => ({ id, label, description }))

const DEFAULTS = {
  follow_ups: {
    model: 'deepseek/deepseek-v4-flash',
    updatedByEmail: 'owner@app.example',
    updatedAt: '2026-07-28T09:00:00Z',
    zdrSafe: true,
  },
  shallow_research: {
    model: 'anthropic/claude-sonnet-5',
    updatedByEmail: 'owner@app.example',
    updatedAt: '2026-07-28T09:00:00Z',
    zdrSafe: true,
  },
  deep_research_router: {
    model: 'vendor/router-mini',
    updatedByEmail: 'owner@app.example',
    updatedAt: '2026-07-28T09:00:00Z',
    zdrSafe: false,
  },
}

const WORKFLOW_DEFAULTS = Object.fromEntries(
  AGENT_GROUPS.map((group) => [group.id, 'openai/gpt-6-luna'])
)

const EFFORTS = {
  follow_ups: {
    effort: 'none',
    updatedByEmail: 'owner@app.example',
    updatedAt: '2026-08-01T09:00:00Z',
  },
  deep_research: {
    effort: 'xhigh',
    updatedByEmail: 'owner@app.example',
    updatedAt: '2026-08-01T09:00:00Z',
  },
}

const WORKFLOW_EFFORTS: Record<string, string | null> = {
  follow_ups: 'none',
  clarifier: 'medium',
  shallow_research: 'low',
  deep_research: 'medium',
  deep_research_router: 'none',
  memory_reflection: 'medium',
  ingest_vlm: null,
}

const CATALOG = [
  {
    id: 'anthropic/claude-sonnet-5',
    name: 'Claude Sonnet 5',
    contextLength: 200000,
    promptPrice: 0.000003,
    completionPrice: 0.000015,
  },
  {
    id: 'deepseek/deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    contextLength: 163840,
    promptPrice: 0.00000027,
    completionPrice: 0.0000011,
  },
]

const PREVIEW_PATH = '/dev/platform-models'

function installShim(): void {
  if (typeof window === 'undefined' || process.env.NODE_ENV !== 'development') return
  const w = window as unknown as { __platformModelDefaultsShim?: boolean }
  if (w.__platformModelDefaultsShim) return
  w.__platformModelDefaultsShim = true
  const real = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (window.location.pathname.startsWith(PREVIEW_PATH)) {
      if (url.includes('/api/platform/model-defaults/models')) {
        return Response.json({ group: 'preview', models: CATALOG })
      }
      if (url.includes('/api/platform/model-defaults')) {
        return Response.json({
          agentGroups: AGENT_GROUPS,
          defaults: DEFAULTS,
          workflowDefaults: WORKFLOW_DEFAULTS,
          workflowDefaultsZdrSafe: Object.fromEntries(
            Object.keys(WORKFLOW_DEFAULTS).map((group) => [group, true])
          ),
        })
      }
      if (url.includes('/api/platform/reasoning-efforts')) {
        return Response.json({ efforts: EFFORTS, workflowEfforts: WORKFLOW_EFFORTS })
      }
    }
    return real(input, init)
  }
}

installShim()

export default function PlatformModelsDevPage(): JSX.Element {
  const t = useTranslations(platformCopy)
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }

  return (
    <main
      className="mx-auto flex max-w-4xl flex-col gap-10 px-4 py-8 md:px-8"
      data-testid="platform-models-preview"
    >
      <div className="flex flex-col gap-6">
        <PageHeader title={t('sections.models.title')} subtitle={t('sections.models.subtitle')} />
        <PlatformModelDefaults />
      </div>
      {/* The read-only support role: same rows, no write control. */}
      <section className="flex flex-col gap-3">
        <SectionLabel as="h2">Read-only (platform:settings:view)</SectionLabel>
        <PlatformAccessProvider permissions={[PLATFORM_PERMISSIONS.settingsView]}>
          <PlatformModelDefaults />
        </PlatformAccessProvider>
      </section>
    </main>
  )
}
