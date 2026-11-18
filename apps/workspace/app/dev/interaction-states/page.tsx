'use client'

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
