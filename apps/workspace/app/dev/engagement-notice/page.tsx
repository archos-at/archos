'use client'

import { useState } from 'react'
import { notFound } from 'next/navigation'

import { EngagementNotice } from '@/features/collaboration/components/EngagementNotice'
import { I18nProvider } from '@/i18n'
import type { ConversationEngagement } from '@/lib/db/schema/conversations'
import { PRODUCT_NAME } from '@/lib/brand'
import { SectionLabel } from '@/components/ui/section-label'

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <section className="flex flex-col gap-2">
    <SectionLabel as="h2">
      {label}
    </SectionLabel>
    <div className="bg-card rounded-lg border px-4 py-3">{children}</div>
  </section>
)

const LiveRow = ({
  label,
  initialMode,
  suggestion = null,
}: {
  label: string
  initialMode: ConversationEngagement
  suggestion?: ConversationEngagement | null
}) => {
  const [mode, setMode] = useState<ConversationEngagement>(initialMode)
  return (
    <Row label={label}>
      <EngagementNotice
        mode={mode}
        suggestion={suggestion}
        onChange={(next) => {
          setMode(next)
          return true
        }}
      />
    </Row>
  )
}

export default function EngagementNoticePreviewPage() {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }

  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <main
        data-testid="engagement-notice-preview"
        className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-6 md:p-8"
      >
        <header>
          <h1 className="text-xl font-semibold">Wann {PRODUCT_NAME} antwortet</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Die Regel steht da, wo die Frage entsteht — und ist gleich der Schalter.
          </p>
        </header>

        <LiveRow
          label="Mehrere Personen — das Angebot, nicht die Änderung"
          initialMode="ask"
          suggestion="mention"
        />

        <LiveRow label="Nur auf Erwähnung — die Regel, mit dem Weg zurück" initialMode="mention" />

        {/* Static by design: no control, so nothing to transition. */}
        <Row label="Als Mitlesende — Erklärung ohne Schalter">
          <EngagementNotice mode="mention" onChange={() => true} canChange={false} />
        </Row>
      </main>
    </I18nProvider>
  )
}
