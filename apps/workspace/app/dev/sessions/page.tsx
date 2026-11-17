'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { AppSidebar } from '@/components/shell/app-sidebar'
import { RightsLostPanel } from '@/features/layout/components/RightsLostPanel'
import { SessionsPanel } from '@/features/layout/components/SessionsPanel'
import { useLayoutStore } from '@/features/layout/store'
import { useChatStore } from '@/features/chat/store'

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000)
const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000)

const SESSIONS = [
  { id: 's-1', title: 'Rettungswege Bürogebäude GK4 Wien', date: minutesAgo(4) },
  { id: 's-2', title: 'Fluchtweglänge im Erdgeschoss', date: minutesAgo(95), temporary: true },
  { id: 's-3', title: 'Brandabschnitte Tiefgarage', date: minutesAgo(240), hasCompletedReport: true },
  { id: 's-4', title: 'Sicherheitstreppenhaus — Anforderungen GK5', date: daysAgo(1) },
  { id: 's-5', title: 'Barrierefreiheit Sanitärräume', date: daysAgo(1) },
  { id: 's-6', title: 'OIB-RL 6 Energieausweis Bestand', date: daysAgo(3), hasActiveDeepResearch: true },
  { id: 's-7', title: 'Schallschutz Trennwände Wohnbau', date: daysAgo(3) },
  { id: 's-8', title: 'Stellplatzverpflichtung Wien Bauordnung', date: daysAgo(6) },
  { id: 's-9', title: 'Belichtung Aufenthaltsräume', date: daysAgo(6) },
  { id: 's-10', title: 'Absturzsicherung Brüstungshöhen', date: daysAgo(11) },
  { id: 's-11', title: 'Aufzugsschacht Entrauchung', date: daysAgo(11) },
  { id: 's-12', title: 'Bauklasse und Gebäudehöhe Parzelle 1042', date: daysAgo(18) },
]

const LOCKED_SESSIONS = [
  { id: 's-lost-1', title: '', date: minutesAgo(30), contentLocked: true },
  { id: 's-lost-2', title: '', date: daysAgo(2), contentLocked: true },
]

const PROJECTS = [
  { id: 'p-1', name: 'Wohnbau Seestadt Baufeld D12' },
  { id: 'p-2', name: 'Sanierung Amtshaus Favoriten' },
]

const RESEARCH_RUNS = {
  total: 3,
  jobs: [
    {
      job_id: 'job-a',
      status: 'running',
      created_at: minutesAgo(12).toISOString(),
      conversation_id: 's-6',
      project_collection: 'preview',
    },
    {
      job_id: 'job-b',
      status: 'completed',
      created_at: minutesAgo(240).toISOString(),
      conversation_id: 's-3',
      project_collection: 'preview',
    },
    {
      job_id: 'job-c',
      status: 'failed',
      created_at: daysAgo(11).toISOString(),
      conversation_id: null,
      project_collection: 'preview',
    },
  ],
}

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const w = window as Window & { __sessionsPreviewFetchShim?: boolean }
  if (!w.__sessionsPreviewFetchShim) {
    w.__sessionsPreviewFetchShim = true
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/jobs/async/jobs')) {
        return new Response(JSON.stringify(RESEARCH_RUNS), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return real(input, init)
    }
  }
}

export default function SessionsPreviewPage() {
  const variant = useSearchParams()?.get('variant') ?? 'default'
  const setSessionsPanelOpen = useLayoutStore((s) => s.setSessionsPanelOpen)

  useEffect(() => {
    setSessionsPanelOpen(true)
  }, [setSessionsPanelOpen])

  useEffect(() => {
    useChatStore.setState({ isStreaming: variant === 'busy' })
  }, [variant])

  useEffect(() => {
    if (variant !== 'search' && variant !== 'no-match') return
    const input = document.querySelector<HTMLInputElement>('input[type="text"]')
    if (!input) return
    const setValue = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set
    setValue?.call(input, variant === 'search' ? 'brand' : 'zzzz')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, [variant])

  const rightsLost = variant === 'rights-lost'
  const sessions = variant === 'empty' ? [] : rightsLost ? [...LOCKED_SESSIONS, ...SESSIONS.slice(0, 5)] : SESSIONS

  return (
    <div
      className="bg-background text-foreground flex h-dvh flex-col overflow-hidden md:flex-row"
      data-testid="sessions-preview"
    >
      {/* The real rail — the surface the panel overlays. `md:contents` so it
          stays a direct flex child on desktop; hidden below `md`, matching the
          chat route where the standalone mobile bar is suppressed. */}
      <div className="hidden md:contents">
        <AppSidebar
          projectId="p-1"
          projects={PROJECTS}
          user={{ name: 'Anna Berger', email: 'anna.berger@example.at' }}
          authRequired={false}
          canAccessInbox
        />
      </div>

      {/* Chat-plane stand-in — the surface the sheet rises over. The sheet
          itself portals to <body>, so where it is rendered from matters only
          for props. */}
      <main className="relative min-w-0 flex-1 overflow-hidden">
        {rightsLost ? (
          <div className="flex h-full">
            <RightsLostPanel />
          </div>
        ) : (
          <p className="text-muted-foreground p-6 font-mono text-xs">
            /dev/sessions — chat plane stand-in (the history sheet rises above it)
          </p>
        )}

        <SessionsPanel
          sessions={sessions}
          selectedSessionId={rightsLost ? 's-lost-1' : 's-2'}
          onSelectSession={() => {}}
          onNewSession={() => {}}
          onDeleteSession={() => {}}
          onDeleteAllSessions={() => {}}
          onRenameSession={() => {}}
          projectId={variant === 'research' ? 'p-1' : undefined}
        />
      </main>
    </div>
  )
}
