'use client'

import { useEffect, type FC, type ReactNode } from 'react'
import { CalculationCard } from '@/features/cards/components/CalculationCard'
import { I18nProvider } from '@/i18n'
import type { CalculationStepData } from '@/shared/cards/schemas'

const OIB4 = { document: 'OIB-Richtlinie 4', section: 'Pkt. 3.2', edition: 'Ausgabe Mai 2023' }
const OIB6 = { document: 'OIB-Richtlinie 6', section: 'Pkt. 4.2', edition: 'Ausgabe Mai 2023' }

const STEP_DIMENSIONS: CalculationStepData[] = [
  {
    label: 'Schrittmaß',
    operation: 'sum',
    unit: 'cm',
    operands: [
      {
        label: 'Steigung',
        value: 17,
        unit: 'cm',
        factor: 2,
        provenance: 'computed',
        tolerance: 0.5,
        source: 'Einreichplan, Schnitt A-A',
      },
      { label: 'Auftritt', value: 30, unit: 'cm', provenance: 'declared', source: 'IFC-Modell haus-a.ifc' },
    ],
  },
]

const U_VALUE: CalculationStepData[] = [
  {
    label: 'Wärmedurchgangswiderstand',
    operation: 'sum',
    unit: 'm²K/W',
    operands: [
      { label: 'Rsi', value: 0.13, unit: 'm²K/W' },
      { label: 'Dämmung 18 cm', value: 3.27, unit: 'm²K/W' },
      { label: 'Ziegel 25 cm', value: 0.55, unit: 'm²K/W' },
      { label: 'Rse', value: 0.04, unit: 'm²K/W' },
    ],
  },
  {
    label: 'U-Wert',
    operation: 'quotient',
    unit: 'W/(m²K)',
    operands: [
      { label: '', value: 1 },
      { label: 'Rges', step: 1 },
    ],
  },
]

const Block: FC<{ title: string; note: string; children: ReactNode }> = ({ title, note, children }) => (
  <section className="flex flex-col gap-2">
    <div>
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <p className="max-w-2xl text-xs text-muted-foreground">{note}</p>
    </div>
    <div className="w-[680px] max-w-full">{children}</div>
  </section>
)

const driven = new Set<string>()

const Open: FC<{ block: string; fromEnd?: number }> = ({ block, fromEnd = 1 }) => {
  useEffect(() => {
    if (driven.has(block)) return
    driven.add(block)
    let attempts = 0
    const tick = (): void => {
      const triggers = document.querySelectorAll<HTMLButtonElement>(
        `[data-preview="${block}"] button[aria-expanded]`
      )
      const target = triggers[triggers.length - fromEnd]
      if (target?.getAttribute('aria-expanded') === 'true') return
      target?.click()
      if (attempts++ > 80) return
      window.setTimeout(tick, 50)
    }
    tick()
  }, [block, fromEnd])
  return null
}

export default function CardRevealsPreviewPage() {
  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <main data-testid="card-reveals-preview" className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-8">
        <Block
          title="Rechenweg – Herkunft aufgeklappt"
          note="The sources disclosure driven open: provenance tag and ± band per operand, where each figure is written down, and the sentence saying the card computed the result rather than copying it."
        >
          <div data-preview="sources">
            <CalculationCard
              title="Schrittmaßregel – Treppenlauf Haus A"
              steps={STEP_DIMENSIONS}
              limit={{
                comparator: 'between',
                value: 59,
                upper: 65,
                label: 'Schrittmaßregel',
                reference: OIB4,
              }}
            />
          </div>
        </Block>

        <Block
          title="Rechenweg – knappe Entscheidung"
          note="A two-step U-value whose exact result is 0,2506 W/(m²K) against a ≤ 0,25 limit. The house format would print „0,25“ beside „nicht erfüllt“; the card prints the digits that carry the decision instead."
        >
          <CalculationCard
            title="U-Wert Außenwand aus den Wärmedurchlasswiderständen"
            steps={U_VALUE}
            limit={{ comparator: '<=', value: 0.25, reference: OIB6 }}
            note="Wärmebrücken sind darin nicht berücksichtigt."
          />
        </Block>

        <Open block="sources" />
      </main>
    </I18nProvider>
  )
}
