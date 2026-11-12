'use client'

/**
 * Dev preview: every interactive element of the kit in every state it has, by
 * family.
 *
 * It exists because the hover of a control was decided control by control: a
 * button answered the pointer with a shadow, a card with a lift, a row with a
 * fill, a tab of one page with its ink and a tab of another with a grey pill.
 * One page that shows them all is where that is seen, and where a new control
 * is checked against the rest (docs/design/design-language.md, „Hover is one
 * step down the ladder“).
 *
 * The states are real: `scripts/capture-forced-states.mjs` forces `:hover`,
 * `:active` and `:focus-visible` on the cells marked `data-force` through the
 * browser's protocol (docs/ux/visual-screenshots.md, „Every state at once“).
 * Opened by hand it is the same grid at rest. 404s outside development
 * (`app/dev/layout.tsx`).
 */

import type { JSX } from 'react'
import { ActionsFamily } from './actions-family'
import { ChoicesFamily } from './choices-family'
import { ObjectsFamily, SmallFamily } from './objects-family'
import { PlacesFamily } from './places-family'

export default function InteractionStatesDevPage(): JSX.Element {
  return (
    <main className="bg-background mx-auto grid w-[1440px] max-w-none" data-testid="interaction-states-preview">
      <header className="grid gap-1 px-8 pb-2 pt-8">
        <h1 className="text-page-title">Zustände aller klickbaren Elemente</h1>
        <p className="text-muted-foreground max-w-[72ch] text-sm">
          Nach Familien: was ein Element ist, bestimmt seine Form, und unter dem Zeiger geht es selbst genau eine Stufe.
          Eine Fläche füllt sich; wo nichts zu füllen ist, geht die Kante Richtung Tinte.
        </p>
      </header>
      <div className="divide-hairline grid divide-y" data-part="inventory">
        <ActionsFamily />
        <PlacesFamily />
        <ChoicesFamily />
        <ObjectsFamily />
        <SmallFamily />
      </div>
    </main>
  )
}
