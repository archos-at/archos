'use client'

import { I18nProvider } from '@/i18n'
import { AnswerCardItem } from '@/features/cards/components/AnswerCards'
import cases from '@/features/cards/lib/formula-cases.json'
import type { AnswerCard } from '@/shared/cards/schemas'

type Card = Record<string, unknown> & { type: string }

const GUIDELINES = ['2', '3', '4', '6'].map((number) => `OIB-Richtlinie ${number}`)
const siteWhere = (editions: Record<string, string>) => ({
  coverage: 'settled',
  editions: Object.entries(editions).map(([designation, edition_label]) => ({ designation, edition_label })),
})
const BINDS_2023 = siteWhere(Object.fromEntries(GUIDELINES.map((work) => [work, 'Ausgabe Mai 2023'])))
const BINDS_RL6_2025 = siteWhere({
  ...Object.fromEntries(GUIDELINES.map((work) => [work, 'Ausgabe Mai 2023'])),
  'OIB-Richtlinie 6': 'Ausgabe September 2025',
})

const previews = (cases.cases as Array<{ id: string; preview?: boolean; card?: unknown }>)
  .filter((entry) => entry.preview && entry.card)
  .map((entry) => ({ id: entry.id, card: { ...(entry.card as Card), site_binding: BINDS_2023 } }))

const leaf = (id: string, card: Card) => {
  const { type, ...props } = card
  return { id, component: type, ...props }
}

const byId = (id: string): Card => previews.find((entry) => entry.id === id)?.card as Card

const VARIANTS = {
  type: 'surface',
  title: 'Zwei Fälle in Tabs',
  components: [
    {
      id: 'root',
      component: 'Tabs',
      tabs: [
        { title: 'Außenwand', child: 'wall' },
        { title: 'Stiege', child: 'stair' },
      ],
    },
    leaf('wall', byId('u-value-external-wall')),
    leaf('stair', byId('stair-main-within')),
  ],
}

const LATER_EDITION = { ...byId('u-value-external-wall'), site_binding: BINDS_RL6_2025 }

const CARDS = [...previews.map((entry) => entry.card), LATER_EDITION, VARIANTS] as unknown as AnswerCard[]

export default function FormulaCardsPreview() {
  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <div data-testid="formula-cards-preview" className="flex min-h-screen flex-col items-center gap-8 bg-background px-4 py-8 sm:p-10">
        {CARDS.map((card, index) => (
          <section key={index} className="flex w-[680px] max-w-full flex-col gap-2" data-preview-index={index}>
            <AnswerCardItem card={card} index={index} messageId={`preview-${index}`} />
          </section>
        ))}
      </div>
    </I18nProvider>
  )
}
