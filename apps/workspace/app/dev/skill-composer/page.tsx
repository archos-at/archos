'use client'

import type { JSX } from 'react'
import { useState } from 'react'
import { useSearchParams } from 'next/navigation'

import { I18nProvider } from '@/i18n'
import { InvokedSkillChip } from '@/features/skills/components/InvokedSkillChip'
import {
  SlashCommandPicker,
  type SlashCommandSkill,
} from '@/features/skills/components/SlashCommandPicker'
import { SectionLabel } from '@/components/ui/section-label'

const SKILLS: SlashCommandSkill[] = [
  {
    name: 'oib-brandschutznachweis',
    description:
      'Prüft das Projekt gegen OIB-Richtlinie 2 und listet jede Abweichung mit Klausel und Korrekturvorschlag. Einsetzen, wenn ein Brandschutznachweis erstellt oder vor der Einreichung gegengeprüft werden soll.',
    origin: 'platform',
  },
  {
    name: 'oib-fluchtweg-check',
    description:
      'Prüft Fluchtweglängen, Gangbreiten und Stiegenhäuser gegen OIB-Richtlinie 2.3. Einsetzen bei Fragen zu Fluchtwegen, Notausgängen und zur Entfluchtung einzelner Geschoße.',
    origin: 'platform',
  },
  {
    name: 'energieausweis-vorpruefung',
    description:
      'Vergleicht die Bauteilaufbauten mit den Höchstwerten der OIB-Richtlinie 6 und nennt die Bauteile, die den Nachweis kippen. Einsetzen vor der Beauftragung des Energieausweises.',
    origin: 'org',
  },
  {
    name: 'schallschutz-bericht',
    description:
      'Entwirft den Schallschutznachweis nach OIB-Richtlinie 5 aus den Projektunterlagen. Einsetzen, wenn Trennbauteile zwischen Wohnungen oder gegen Stiegenhäuser zu beurteilen sind.',
    origin: 'org',
  },
  {
    name: 'einreichplan-checkliste',
    description:
      'Geht den Einreichplan gegen die Wiener Bauordnung und die zugehörigen OIB-Richtlinien durch. Einsetzen kurz vor Abgabe, um fehlende Angaben und Pläne zu finden.',
    origin: 'platform-clone',
  },
]

export default function SkillComposerPreviewPage(): JSX.Element {
  const params = useSearchParams()
  const variant = params?.get('variant') ?? 'default'
  const isEmpty = variant === 'empty'

  const [invoked, setInvoked] = useState<SlashCommandSkill>(SKILLS[0])

  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <main
        data-testid="skill-composer-preview"
        className="text-foreground mx-auto flex w-full max-w-[680px] flex-col gap-8 p-6"
      >
        <section className="flex flex-col gap-3">
          <SectionLabel as="h2">
            {isEmpty
              ? 'Slash-Menü — Organisation ohne Skills'
              : 'Slash-Menü — getippt: /oib'}
          </SectionLabel>

          <SlashCommandPicker
            query={isEmpty ? '' : 'oib'}
            skills={isEmpty ? [] : SKILLS}
            onSelect={(skill) => setInvoked(skill)}
          />

          {!isEmpty && (
            <>
              <SectionLabel as="h2" className="mt-4">
                Nach der Auswahl — unter dem Eingabefeld
              </SectionLabel>
              {/* `onRemove` supplied: the removable form is the one every author
                  meets, and an unremovable chip only exists on a read-only
                  composer. */}
              <InvokedSkillChip
                name={invoked.name}
                description={invoked.description}
                onRemove={() => undefined}
              />
            </>
          )}
        </section>
      </main>
    </I18nProvider>
  )
}
