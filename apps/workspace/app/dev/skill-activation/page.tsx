'use client'

import type { JSX } from 'react'
import { useEffect, useRef } from 'react'

import { I18nProvider } from '@/i18n'
import { SkillsUsedDisclosure } from '@/features/skills/components/SkillsUsedDisclosure'
import { SectionLabel } from '@/components/ui/section-label'

const INVOCABLE = [
  {
    name: 'oib-brandschutznachweis',
    description:
      'Prüft das Projekt gegen OIB-Richtlinie 2 und listet jede Abweichung mit Klausel und Korrekturvorschlag. Einsetzen, wenn ein Brandschutznachweis erstellt oder vor der Einreichung gegengeprüft werden soll.',
    origin: 'platform',
  },
  {
    name: 'schallschutz-bericht',
    description:
      'Entwirft den Schallschutznachweis nach OIB-Richtlinie 5 aus den Projektunterlagen. Einsetzen, wenn Trennbauteile zwischen Wohnungen oder gegen Stiegenhäuser zu beurteilen sind.',
    origin: 'org',
  },
]

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const w = window as unknown as { __skillActivationShim?: boolean }
  if (!w.__skillActivationShim) {
    w.__skillActivationShim = true
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.includes('/api/skills/invocable')) {
        return Response.json({ skills: INVOCABLE })
      }
      return real(input, init)
    }
  }
}

export default function SkillActivationPreviewPage(): JSX.Element {
  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <main
        data-testid="skill-activation-preview"
        className="text-foreground mx-auto flex w-full max-w-[680px] flex-col gap-8 p-6"
      >
        <section className="flex flex-col gap-3">
          <SectionLabel as="h2">
            Geschlossen — ein Skill, unter der Antwort
          </SectionLabel>
          <SkillsUsedDisclosure skillsActivated={['oib-brandschutznachweis']} />
        </section>

        <section className="flex flex-col gap-3">
          <SectionLabel as="h2">
            Geöffnet — drei Skills, einer davon zwischenzeitlich umbenannt
          </SectionLabel>
          <ExpandedDisclosure />
        </section>
      </main>
    </I18nProvider>
  )
}

function ExpandedDisclosure(): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    let stopped = false
    const tick = (): void => {
      if (stopped) return
      const trigger = root.querySelector<HTMLButtonElement>('[data-testid="skills-used-trigger"]')
      if (trigger) {
        trigger.click()
        return
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    return () => {
      stopped = true
    }
  }, [])

  return (
    <div ref={rootRef}>
      <SkillsUsedDisclosure
        skillsActivated={['oib-brandschutznachweis', 'schallschutz-bericht', 'oib-fluchtweg-check']}
      />
    </div>
  )
}
