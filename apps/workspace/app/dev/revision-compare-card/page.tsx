'use client'

import type { FC, ReactNode } from 'react'
import { I18nProvider } from '@/i18n'
import { RevisionCompareCard } from '@/features/cards/components/RevisionCompareCard'
import { a1SheetPdf } from '../_fixtures/a1-sheet'

const OLDER_ID = 'dev-compare-older'
const NEWER_ID = 'dev-compare-newer'

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const w = window as unknown as { __revisionCompareCardShim?: boolean }
  if (!w.__revisionCompareCardShim) {
    w.__revisionCompareCardShim = true
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const revision = url.endsWith(`/api/documents/${OLDER_ID}/file`)
        ? 'C'
        : url.endsWith(`/api/documents/${NEWER_ID}/file`)
          ? 'D'
          : null
      if (revision) return new Response(a1SheetPdf(revision), { headers: { 'Content-Type': 'application/pdf' } })
      return real(input, init)
    }
  }
}

const CHANGES = [
  { region: [0.765, 0.852, 0.225, 0.135], label: 'Plankopf: Index D statt C' },
  { region: [0.415, 0.39, 0.105, 0.16], label: 'Treppenkern: Laufbreite 1,10 m statt 1,00 m' },
]

const Scenario: FC<{ id: string; title: string; children: ReactNode }> = ({ id, title, children }) => (
  <section data-testid={`revision-compare-scenario-${id}`} className="flex flex-col gap-3">
    <h2 className="text-foreground text-sm font-semibold">{title}</h2>
    {children}
  </section>
)

const Preview: FC = () => (
  <main
    data-testid="revision-compare-card-preview"
    className="text-foreground mx-auto flex w-full max-w-[720px] flex-col gap-10 p-4 sm:p-6"
  >
    <Scenario id="changes" title="Zwei Änderungen">
      <RevisionCompareCard
        olderId={OLDER_ID}
        newerId={NEWER_ID}
        olderName="EG_Grundriss_Index_C.pdf"
        newerName="EG_Grundriss_Index_D.pdf"
        page={1}
        changes={CHANGES}
        summary={CHANGES.map((change) => change.label)}
        eager
      />
    </Scenario>
    <Scenario id="none" title="Ohne Änderungen">
      <RevisionCompareCard olderId={OLDER_ID} newerId={NEWER_ID} page={1} changes={[]} summary={[]} eager />
    </Scenario>
  </main>
)

export default function RevisionCompareCardPreviewPage() {
  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <Preview />
    </I18nProvider>
  )
}
