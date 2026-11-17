'use client'

import type { JSX } from 'react'
import { useEffect, useRef } from 'react'

import { I18nProvider } from '@/i18n'
import { SkillRawDocumentSection } from '@/features/skills/components/SkillRawDocumentSection'
import { renderSkillDocument } from '@/features/skills/lib/skill-document'

const DOCUMENT = renderSkillDocument({
  name: 'brandschutz-check',
  description:
    'Prüft Bauteile und Fluchtwege gegen OIB-Richtlinie 2. Einsetzen, wenn ein Brandschutznachweis erstellt oder vor der Einreichung gegengeprüft werden soll.',
  body: 'Handle als Brandschutzprüfer.\n\n1. Bestimme die Gebäudeklasse.\n2. Prüfe jedes Bauteil gegen OIB-Richtlinie 2.',
  metadata: { 'grid-hidden': 'true', 'grid-cards': 'calculation' },
})

const BROKEN = `---
name: brandschutz-check
description: Prüft Bauteile und Fluchtwege gegen OIB-Richtlinie 2.

Handle als Brandschutzprüfer.`

export default function SkillEditorAdvancedPreviewPage(): JSX.Element {
  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <main
        data-testid="skill-editor-advanced-preview"
        className="text-foreground mx-auto flex w-full max-w-[680px] flex-col gap-8 p-6"
      >
        <Driver />
      </main>
    </I18nProvider>
  )
}

function Driver(): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    let stopped = false

    const type = (element: HTMLTextAreaElement, value: string): void => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value',
      )?.set
      setter?.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
    }

    const tick = (): void => {
      if (stopped) return
      const sections = root.querySelectorAll<HTMLElement>('[data-testid="skill-raw-document"]')
      if (sections.length < 2) {
        requestAnimationFrame(tick)
        return
      }
      const triggers = root.querySelectorAll<HTMLButtonElement>(
        '[data-testid="skill-raw-document"] > button',
      )
      for (const trigger of triggers) {
        if (trigger.getAttribute('data-state') !== 'open') trigger.click()
      }
      requestAnimationFrame(() => {
        if (stopped) return
        const areas = root.querySelectorAll<HTMLTextAreaElement>(
          '[data-testid="skill-raw-document"] textarea',
        )
        if (areas.length < 2) {
          requestAnimationFrame(tick)
          return
        }
        type(areas[0], DOCUMENT.replace('grid-cards: calculation', 'grid-cards: stair_diagram'))
        type(areas[1], BROKEN)
      })
    }
    requestAnimationFrame(tick)
    return () => {
      stopped = true
    }
  }, [])

  return (
    <div ref={rootRef} className="flex flex-col gap-8">
      <SkillRawDocumentSection document={DOCUMENT} onApply={() => {}} />
      <SkillRawDocumentSection document={DOCUMENT} onApply={() => {}} />
    </div>
  )
}
