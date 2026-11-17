'use client'

import { useState } from 'react'
import { notFound } from 'next/navigation'

import { AwaitingBanner } from '@/features/collaboration/components/AwaitingBanner'
import { I18nProvider } from '@/i18n'
import type { AwaitingStateResponse, PendingMentionView } from '@/lib/mentions/types'
import { SectionLabel } from '@/components/ui/section-label'

const person = (userId: string, name: string) => ({
  userId,
  name,
  email: `${name.toLowerCase().replace(/\s+/g, '.')}@arch-buero.at`,
  profilePictureUrl: null,
})

const MATTHIAS = person('u-matthias', 'Matthias Bigl')

const now = Date.parse('2026-07-29T10:00:00Z')
const ago = (minutes: number): string => new Date(now - minutes * 60_000).toISOString()

const request = (overrides: Partial<PendingMentionView> = {}): PendingMentionView => ({
  id: 'r-anna',
  person: person('u-anna', 'Anna Weber'),
  requestedBy: MATTHIAS,
  note: null,
  anchorId: 'm-9',
  createdAt: ago(23),
  ...overrides,
})

const ONE: AwaitingStateResponse = {
  pending: [
    request({
      note: 'Ist die Annahme richtig, dass das Atrium als eigener Brandabschnitt geführt wird?',
    }),
  ],
  awaitingMe: false,
}

const MANY: AwaitingStateResponse = {
  pending: [
    request({
      note: 'Passt die Entrauchung im Atrium so, wie sie im Einreichplan steht?',
    }),
    request({
      id: 'r-markus',
      person: person('u-markus', 'Markus Hofer'),
      requestedBy: person('u-anna', 'Anna Weber'),
      note: 'Hast du die Rauchabzugsflächen im Kern B schon mit der Behörde abgestimmt?',
      createdAt: ago(90),
    }),
    request({
      id: 'r-sabine',
      person: person('u-sabine', 'Sabine Gruber'),
      requestedBy: person('u-klaus', 'Klaus Berger'),
      note: null,
      createdAt: ago(150),
    }),
  ],
  awaitingMe: false,
}

const ME: AwaitingStateResponse = {
  pending: [
    request({
      id: 'r-me',
      person: person('u-me', 'Matthias Bigl'),
      requestedBy: person('u-anna', 'Anna Weber'),
      note: 'Kannst du die Fluchtwegbreite im Kern B bestätigen?',
      createdAt: ago(6),
    }),
  ],
  awaitingMe: true,
}

const Section = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <section className="flex flex-col gap-2">
    <SectionLabel as="h2">
      {label}
    </SectionLabel>
    {children}
  </section>
)

export default function AwaitingBannerPreviewPage() {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }

  const [released, setReleased] = useState<string[]>([])
  const withoutReleased = (state: AwaitingStateResponse): AwaitingStateResponse => ({
    ...state,
    pending: state.pending.filter((entry) => !released.includes(entry.id)),
  })
  const onRelease = async (requestId: string): Promise<boolean> => {
    setReleased((current) => [...current, requestId])
    return true
  }

  return (
    <I18nProvider initialLocale="de" fixedLocale>
    <main
      data-testid="awaiting-banner-preview"
      className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-6 text-foreground md:p-8"
    >
      <header>
        <h1 className="text-xl font-semibold">Warten auf eine Antwort</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Der Assistent hält sich zurück — und sagt, warum.
        </p>
      </header>

      <Section label="Eine Person">
        <AwaitingBanner
          awaiting={withoutReleased(ONE)}
          onRelease={onRelease}
          onAskAgent={() => undefined}
        />
      </Section>

      <Section label="Mehrere Personen">
        <AwaitingBanner
          awaiting={withoutReleased(MANY)}
          onRelease={onRelease}
          onAskAgent={() => undefined}
        />
      </Section>

      <Section label="Ihre Einschätzung ist gefragt">
        {/* The one state that carries "Rückfrage an …": the reader was asked
            something they may not be able to answer without more information, and
            typing that question as plain text is the move that misfires. */}
        <AwaitingBanner
          awaiting={withoutReleased(ME)}
          onRelease={onRelease}
          onAskAgent={() => undefined}
          onAskBack={() => undefined}
        />
      </Section>
    </main>
    </I18nProvider>
  )
}
