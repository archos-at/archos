'use client'

import { useSearchParams } from 'next/navigation'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { I18nProvider } from '@/i18n'
import { MarkdownRenderer } from '@/shared/components/MarkdownRenderer'
import { SectionLabel } from '@/components/ui/section-label'

const fence = (source: string) => '```mermaid\n' + source.trim() + '\n```'

const TAUGHT: { label: string; source: string }[] = [
  {
    label: 'flowchart — ein Verfahren, das sich verzweigt und wieder zusammenläuft',
    source: `
flowchart TD
  A["Einreichung"] --> B{"Vollständig?"}
  B -- "nein" --> C["Verbesserungsauftrag"]
  C --> A
  B -- "ja" --> D["Bauverhandlung"]
  D --> E["Baubewilligung"]`,
  },
  {
    label: 'flowchart TD — die Normenhierarchie: was bindet, was auslegt',
    source: `
flowchart TD
  G["Bauordnung (Gesetz)"] --> V["Bautechnikverordnung"]
  V --> R["OIB-RL 2 (verbindlich erklärt)"]
  R -. "verweist" .-> N["ÖNORM B 3806"]
  L["Leitfaden"] -. "erläutert" .-> R`,
  },
  {
    label: 'sequenceDiagram — wer mit wem in welcher Reihenfolge',
    source: `
sequenceDiagram
  participant B as Bauwerber
  participant P as Planer
  participant M as Baubehörde
  participant S as Sachverständige
  B->>P: Auftrag Einreichplanung
  P->>M: Einreichung
  M->>S: Befassung zur Begutachtung
  S-->>M: Gutachten
  M-->>P: Verbesserungsauftrag
  P->>M: Nachreichung
  M-->>B: Bescheid`,
  },
  {
    label: 'stateDiagram-v2 — der Stand eines Verfahrens',
    source: `
stateDiagram-v2
  [*] --> Eingereicht
  Eingereicht --> InPruefung
  InPruefung --> Verbesserung: Mangel
  Verbesserung --> InPruefung
  InPruefung --> Bewilligt
  Bewilligt --> [*]`,
  },
  {
    label: 'gantt — Fristen und Phasen auf einer Zeitachse',
    source: `
gantt
  dateFormat YYYY-MM-DD
  axisFormat %d.%m.
  section Verfahren
  Vorprüfung        :a1, 2026-10-01, 14d
  Bauverhandlung    :a2, after a1, 21d
  Bescheid          :milestone, after a2, 0d
  section Planung
  Ausführungsplanung :b1, 2026-10-10, 30d`,
  },
  {
    label: 'mindmap — ein Überblick über ein Regelwerk',
    source: `
mindmap
  root((OIB-RL 2))
    Grundteil
      Tragfähigkeit im Brandfall
      Ausbreitung von Feuer und Rauch
      Fluchtwege
      Brandbekämpfung
    2.1 Betriebsbauten
      Brandabschnitte nach Fläche
    2.2 Garagen
      Überdachte Stellplätze
      Parkdecks
    2.3 Hohe Gebäude
      Fluchtniveau über 22 m
    Leitfaden
      Abweichungen`,
  },
  {
    label: 'pie — Anteile eines Ganzen',
    source: `
pie title Nutzfläche nach Nutzung
  "Wohnen" : 62
  "Büro" : 25
  "Handel" : 13`,
  },
  {
    label: 'quadrantChart — Varianten auf zwei Achsen abgewogen',
    source: `
quadrantChart
  title Varianten zweiter Fluchtweg
  x-axis Geringe Kosten --> Hohe Kosten
  y-axis Wenig Fläche --> Viel Fläche
  Außentreppe: [0.3, 0.2]
  Zweites Treppenhaus: [0.8, 0.8]
  Sicherheitstreppenhaus: [0.7, 0.4]`,
  },
  {
    label: 'xychart-beta — Werte über einer Achse',
    source: `
xychart-beta
  title "Fluchtweglänge je Geschoß"
  x-axis [EG, 1.OG, 2.OG, 3.OG]
  y-axis "m" 0 --> 50
  bar [22, 31, 38, 44]
  line [40, 40, 40, 40]`,
  },
]

const NOT_TAUGHT: { label: string; source: string }[] = [
  {
    label: 'timeline',
    source: `
timeline
  title OIB-Richtlinie 2
  2007 : Erstausgabe
  2011 : Überarbeitung
  2015 : Neuausgabe
  2019 : Neuausgabe
  2023 : Aktuelle Ausgabe`,
  },
  {
    label: 'journey',
    source: 'journey\n  title Einreichung\n  section Planung\n    Pläne: 3: Planer',
  },
  { label: 'classDiagram', source: 'classDiagram\n  Gebaeude <|-- Wohnhaus' },
  { label: 'erDiagram', source: 'erDiagram\n  PROJEKT ||--o{ PLAN : hat' },
  { label: 'block-beta', source: 'block-beta\n  columns 3\n  a b c' },
  { label: 'sankey-beta', source: 'sankey-beta\n  Wohnen,Nutzfläche,62\n  Büro,Nutzfläche,25' },
]

const PROSE = `Tragende Bauteile in Gebäudeklasse 5 brauchen **R 90** [1].

### Die Prüfung

| Kriterium | Konzept | Status | Fundstelle |
|---|---|---|---|
| Stützen oberirdisch | R 90 | erfüllt | [1] |
| Kellerdecke | Baustoff offen | teilweise | [1] |
| Trennwände | REI 60 | nicht erfüllt | [1] |
| Dachdecke | nicht beschrieben | offen | [1] |

### Unterlagen

- [x] Einreichplan
- [x] Baubeschreibung
- [ ] Brandschutzkonzept, Stand 4
- [ ] Energieausweis

### Die Rechnung

$$
q = \\frac{\\sum M_i H_i}{A}
$$`

function Blocks() {
  const params = useSearchParams()
  const diagrams = params.get('grammars') === 'all' ? [...TAUGHT, ...NOT_TAUGHT] : TAUGHT
  return (
    <main
      data-testid="answer-blocks-preview"
      className="text-foreground mx-auto flex w-full max-w-[680px] flex-col gap-8 p-6"
    >
      <section className="flex flex-col gap-3">
        <SectionLabel as="h2">
          Prosa — Tabelle mit Status, Aufgabenliste, Formel
        </SectionLabel>
        <MarkdownRenderer content={PROSE} />
      </section>
      {diagrams.map((diagram) => (
        <section
          key={diagram.label}
          data-grammar={diagram.label.split(' ')[0]}
          className="flex flex-col gap-3"
        >
          <SectionLabel as="h2">
            {diagram.label}
          </SectionLabel>
          <MarkdownRenderer content={fence(diagram.source)} />
        </section>
      ))}
    </main>
  )
}

export default function AnswerBlocksPreviewPage() {
  if (process.env.NODE_ENV !== 'development') {
    notFound()
  }
  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <Suspense>
        <Blocks />
      </Suspense>
    </I18nProvider>
  )
}
