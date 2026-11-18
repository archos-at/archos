'use client'

import { useEffect, useState } from 'react'
import { notFound } from 'next/navigation'

import { AgentPrompt } from '@/features/chat/components/AgentPrompt'
import { useChatStore } from '@/features/chat/store'
import { I18nProvider } from '@/i18n'
import { SectionLabel } from '@/components/ui/section-label'

const PLAN_BODY =
  '**Research Plan Preview**\n\n' +
  '**Title:** Brandschutzanforderungen für Gebäudeklasse 4 in Wien\n\n' +
  '**Sections:**\n' +
  '  1. Einleitung und Rechtsrahmen\n' +
  '  2. OIB-Richtlinie 2 im Überblick\n' +
  '  3. Anforderungen an Fluchtwege\n' +
  '  4. Brandabschnitte und Bauteile\n' +
  '  5. Abweichungen und Kompensation\n' +
  '  6. Zusammenfassung\n\n' +
  '---\n'

const THREE_WAY_CONTENT =
  PLAN_BODY +
  'Reply **approve** to proceed, **shallow** for a quick answer instead, ' +
  '**cancel** to dismiss, or provide feedback to revise the plan.'

const timestamp = new Date('2026-07-29T10:00:00Z')

const Section = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <section className="flex flex-col gap-2">
    <SectionLabel as="h2">
      {label}
    </SectionLabel>
    {children}
  </section>
)

export default function PlanApprovalPreviewPage() {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }

  const [liveResponse, setLiveResponse] = useState<string | null>(null)
  useEffect(() => {
    useChatStore.setState({ respondToInteractionFn: setLiveResponse })
    return () => {
      useChatStore.setState({ respondToInteractionFn: null })
    }
  }, [])

  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <main
        data-testid="plan-approval-preview"
        className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-6 text-foreground md:p-8"
      >
        <header>
          <h1 className="text-xl font-semibold">Rechercheplan-Entscheidung</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Starten, kurz beantworten lassen — oder abbrechen, mit Quittung.
          </p>
        </header>

        <Section label="Die Entscheidung — drei Wege">
          <AgentPrompt
            content={THREE_WAY_CONTENT}
            isResponded={liveResponse !== null}
            response={liveResponse ?? undefined}
            timestamp={timestamp}
          />
        </Section>

        <Section label="Beantwortet: kurze Antwort angefordert">
          <AgentPrompt
            content={THREE_WAY_CONTENT}
            isResponded
            response="shallow"
            timestamp={timestamp}
          />
        </Section>

        <Section label="Beantwortet: abgebrochen">
          <AgentPrompt
            content={THREE_WAY_CONTENT}
            isResponded
            response="cancel"
            timestamp={timestamp}
          />
        </Section>

      </main>
    </I18nProvider>
  )
}
