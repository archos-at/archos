'use client'

import type { JSX } from 'react'
import { Suspense, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'

import { I18nProvider } from '@/i18n'
import { SkillEditorDialog } from '@/features/skills/components/skill-editor-dialog'
import { SkillDocumentPreview } from '@/features/skills/components/SkillDocumentPreview'

const SKILL = {
  name: 'brandschutz-check',
  description: 'Prüft den Brandschutz im Projekt.',
  body: `Handle als Brandschutzprüfer für ein Wiener Wohnbauprojekt.

1. Lies die Projektunterlagen und liste jedes brandschutzrelevante Bauteil mit Geschoß und Bezeichnung.
2. Bestimme die Gebäudeklasse aus Bauwerkshöhe, Geschoßanzahl und Nutzung.
3. Prüfe jedes Bauteil gegen OIB-Richtlinie 2 (Feuerwiderstand tragender und trennender Bauteile).
4. Prüfe Fluchtwege gegen OIB-Richtlinie 2.3 (Länge, Breite, Anzahl der Ausgänge).
5. Nenne jede Abweichung mit der genauen Klausel und einem konkreten Korrekturvorschlag.

Nenne fehlende Angaben ausdrücklich als fehlend — nie als erfüllt.`,
  metadata: { 'grid-hidden': 'true', 'grid-cards': 'calculation' },
}

const FINDINGS = {
  findings: [
    {
      severity: 'error',
      field: 'description',
      check: '4.8-description-trigger-style',
      message:
        'Die Beschreibung sagt nicht, WANN der Skill einzusetzen ist — der Agent kann ihn dadurch kaum von „einreichplan-checkliste“ unterscheiden.',
      fix: 'Ergänzen Sie den Anlass: „Einsetzen, wenn ein Brandschutznachweis nach OIB-Richtlinie 2 erstellt oder vor der Einreichung gegengeprüft werden soll.“',
    },
    {
      severity: 'warning',
      field: 'name',
      check: '2-naming-quality',
      message:
        'Der Name nennt die Richtlinie nicht, obwohl die Anweisung ausschließlich gegen OIB 2 prüft.',
      fix: 'Benennen Sie den Skill in „oib-brandschutznachweis“ um, damit er im /-Menü neben den übrigen OIB-Skills gefunden wird.',
    },
    {
      severity: 'suggestion',
      field: 'body',
      check: '3-ambiguous-terms',
      message:
        'Schritt 2 setzt die Gebäudeklasse voraus, sagt aber nicht, was zu tun ist, wenn das Projekt keine angibt.',
      fix: 'Halten Sie den Abbruchfall fest: ohne Gebäudeklasse keine Beurteilung, sondern eine Rückfrage.',
    },
  ],
}

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const w = window as unknown as { __skillEditorShim?: boolean }
  if (!w.__skillEditorShim) {
    w.__skillEditorShim = true
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.includes('/api/skills/review')) {
        return Response.json(FINDINGS)
      }
      return real(input, init)
    }
  }
}

export default function SkillEditorPreviewPage(): JSX.Element {
  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <main
        data-testid="skill-editor-preview"
        className="text-foreground mx-auto flex w-full max-w-[680px] flex-col gap-8 p-6"
      >
        {/* The REAL builder, open. `?step=` walks it forward by pressing its
            own „Weiter", so each step can be captured as an author meets it —
            step 1 is the two lines an agent reads every turn, step 3 is the
            check the save waits on. */}
        <Suspense>
          <BuilderAtStep />
        </Suspense>

        <SkillDocumentPreview
          name={SKILL.name}
          description={SKILL.description}
          body={SKILL.body}
          metadata={SKILL.metadata}
        />
      </main>
    </I18nProvider>
  )
}

function BuilderAtStep(): JSX.Element {
  const target = Number(useSearchParams()?.get('step') ?? '1')

  useEffect(() => {
    if (!Number.isFinite(target) || target <= 1) return
    let stopped = false
    let pressed = 0
    const tick = (): void => {
      if (stopped) return
      if (pressed < target - 1) {
        const next = document.querySelector<HTMLButtonElement>('[data-testid="skill-next"]')
        if (next) {
          next.click()
          pressed += 1
        }
        requestAnimationFrame(tick)
        return
      }
      const check = document.querySelector<HTMLButtonElement>('[data-testid="skill-review-run"]')
      if (check) {
        check.click()
        return
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    return () => {
      stopped = true
    }
  }, [target])

  return (
    <SkillEditorDialog
      open
      onOpenChange={() => {}}
      skill={{
        ...SKILL,
        id: 'skill-preview',
        origin: 'org',
        enabled: true,
        categoryId: null,
        clonedFrom: null,
        createdAt: null,
        updatedAt: null,
      }}
      onSaved={() => {}}
    />
  )
}
