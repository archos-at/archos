import type { AnswerCard } from '@/shared/cards/schemas'
import type { MessageStages } from '@/lib/conversations/message-stages'
import type { CardInteractions } from '@/features/cards/card-decision'
import type { AnswerMeta } from '@/lib/conversations/message-answer-meta'
import { FIRE_SOURCES, OIB2, OIB4, STAIR_SOURCES } from './source-fixtures'

export const structuredQuestion =
  'Welche Feuerwiderstandsklasse brauchen tragende Bauteile in Gebäudeklasse 5, und erfüllt unser Konzept das?'

export const structuredAnswer = `Tragende Bauteile in Gebäudeklasse 5 brauchen **R 90** oberirdisch und **R 90 aus A2** in den unterirdischen Geschoßen [1].

### Oberirdisch und im Keller gilt nicht dasselbe

| Bauteil | Anforderung | Fundstelle |
|---|---|---|
| Tragende Bauteile, oberirdisch | **R 90** | [1] |
| Tragende Bauteile, unterirdisch | **R 90 und A2** | [1] |
| Trennwände zwischen Nutzungseinheiten | **REI 90** | [1] |
| Decken über dem obersten Geschoß | **R 30** | [1] |

### Das Brandschutzkonzept deckt drei von vier Punkten

| Kriterium | Konzept | Status | Fundstelle |
|---|---|---|---|
| Stützen und Wände oberirdisch | R 90 | erfüllt | [1] |
| Kellerdecke | R 90, Baustoff nicht angegeben | teilweise | [1] |
| Wohnungstrennwände | REI 60 | nicht erfüllt | [1] |
| Dachdecke | nicht beschrieben | offen | [1] |

### Eine Abweichung entscheidet die Behörde

\`\`\`mermaid
flowchart TD
  K["Abweichung im Brandschutzkonzept begründen"] --> E["Mit dem Bauansuchen einreichen"]
  E --> B{"Gleichwertiges Schutzniveau?"}
  B -->|ja| J["Bewilligt mit der Baubewilligung"]
  B -->|nein| N["REI 90 ausführen"]
\`\`\`

- [x] Brandschutzkonzept, Stand 3
- [ ] Nachweis der Gleichwertigkeit für die Wohnungstrennwände

${FIRE_SOURCES}`

export const ledeCardQuestion =
  'Erfüllt der Treppenlauf im Haus A die Schrittmaßregel bei 17 cm Steigung und 30 cm Auftritt?'

export const ledeCardAnswer = `Ja — der Lauf hält die Schrittmaßregel ein: aus 17 cm Steigung und 30 cm Auftritt ergibt sich ein Schrittmaß innerhalb des zulässigen Bandes von 59 bis 65 cm [1].

Maßgeblich ist nicht die einzelne Stufe, sondern das Verhältnis von Steigung und Auftritt über den gesamten Lauf. Die Regel bildet die natürliche Schrittlänge ab — zweimal die Steigung plus einmal den Auftritt — und hält den Lauf begehbar, ohne dass die Schrittfolge auf halber Höhe wechselt.

[[card:1]]

Die aus dem Einreichplan abgegriffene Steigung trägt eine Toleranz von ± 0,5 cm. Das Ergebnis bleibt damit in jeder Lage innerhalb der Regel; erst ab 65,5 cm wäre der Lauf gesondert nachzuweisen.

Für Wohngebäude der Gebäudeklasse 4 ist zusätzlich eine nutzbare Laufbreite von mindestens 1,20 m einzuhalten [2]. Sie wird von der Schrittmaßregel nicht berührt und ist getrennt zu prüfen.

${STAIR_SOURCES}`

export const ledeCards: AnswerCard[] = [
  {
    type: 'calculation',
    title: 'Schrittmaßregel – Treppenlauf Haus A',
    steps: [
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
          { label: 'Auftritt', value: 30, unit: 'cm', provenance: 'declared' },
        ],
      },
    ],
    limit: {
      comparator: 'between',
      value: 59,
      upper: 65,
      label: 'Schrittmaßregel',
      reference: OIB4,
    },
  } as AnswerCard,
]

export const streamingQuestion =
  'Welche Feuerwiderstandsklasse brauchen tragende Wände in GK 5 und wie unterscheidet sich das vom obersten Geschoß?'

const streamingFinal = `Tragende Wände in GK 5 brauchen in sonstigen oberirdischen Geschoßen **R 90**; im obersten Geschoß gilt **R 60** [1].

| Lage | Feuerwiderstand | Fundstelle |
|---|---|---|
| Sonstige oberirdische Geschoße, bis zu 6 oberirdische Geschoße | R 90 | [1] |
| Sonstige oberirdische Geschoße, mehr als 6 oberirdische Geschoße | R 90 und A2 | [1] |
| Oberstes Geschoß | R 60 | [1] |

Für GK 5 mit höchstens 6 oberirdischen Geschoßen genügt unter der Bedingung der Fußnote (5) R 60 auch in den beiden obersten Geschoßen: Die übrigen oberirdischen Geschoße müssen dann R 90 und A2 erfüllen [1].`

export const streamingPartial = `Tragende Wände in GK 5 brauchen in sonstigen oberirdischen Geschoßen **R 90**; im obersten Geschoß gilt **R 60** [1].

| Lage | Feuerwiderstand | Fundstelle |
|---|---|---|
| Sonstige oberirdische Geschoße, bis zu 6 oberirdische Geschoße | R 90 | [1] |
| Sonstige oberirdische Geschoße, mehr als 6`

export const streamingSettled = `${streamingFinal}

## Quellen
- [1] [KB] OIB-RL_2_Brandschutz.pdf, p.12`

export const variantsQuestion =
  'Für den zweiten Fluchtweg in GK 4 überlegen wir eine Außentreppe oder ein zweites Treppenhaus. Was müsste ich jeweils nachweisen?'

export const variantsAnswer = `In GK 4 verlangt Tabelle 3 für ein zweites Treppenhaus oberirdisch Wände REI 60 und Treppenläufe R 60; eine Außentreppe muss aus A2 bestehen und darf im Brandfall nicht durch Flammeneinwirkung oder gefahrbringende Strahlungswärme beeinträchtigt werden [1].

Der zusätzliche Fluchtweg muss unabhängig sein und zu einem weiteren Treppenhaus oder einer weiteren Außentreppe gemäß Tabelle 3 führen; für diesen Weg ist die Gehweglänge nicht begrenzt [2]. Für beide Varianten ist außerdem nachzuweisen, dass der Ausgang zu einem sicheren Ort im Freien führt und die Treppe hinsichtlich ihrer nutzbaren Breite zur Personenzahl passt [1][3].

[[card:1]]

Die Übersicht geht von OIB-Richtlinie 2, Ausgabe Mai 2023, aus. Ob diese Ausgabe in Ihrem Bundesland verbindlich gilt und ob landesrechtliche Abweichungen bestehen, ist ohne Angabe des Bundeslands offen.

## Quellen
- [1] [KB] oib-rl_2_ausgabe_mai_2023.pdf, p.23
- [2] [KB] oib-rl_2_ausgabe_mai_2023.pdf, p.13
- [3] [KB] oib-rl_4_ausgabe_mai_2023.pdf, p.6`

export const variantsCards: AnswerCard[] = [
  {
    type: 'surface',
    title: 'Nachweis je Variante',
    components: [
      {
        id: 'root',
        component: 'Tabs',
        tabs: [
          { title: 'Außentreppe', child: 'aussen' },
          { title: 'Zweites Treppenhaus', child: 'innen' },
        ],
      },
      {
        id: 'aussen',
        component: 'Text',
        text: [
          '| Nachweis | Was darzustellen bzw. zu belegen ist | Fundstelle |',
          '|---|---|---|',
          '| Unabhängiger Fluchtweg | Wegführung aus den betroffenen Geschoßen zur Außentreppe; Ausgang zu einem sicheren Ort im Freien | OIB-RL 2, Pkt. 5.1.4 und Tabelle 3 [2][1] |',
          '| Treppenkonstruktion | Ausführung in A2; keine Beeinträchtigung durch Flammeneinwirkung oder gefahrbringende Strahlungswärme | OIB-RL 2, Tabelle 3 [1] |',
          '| Nutzbarkeit | Lichte Treppenlaufbreite anhand der maximal gleichzeitig auf die Treppe angewiesenen Personen | OIB-RL 4, Pkt. 2.4 [3] |',
        ].join('\n'),
      },
      {
        id: 'innen',
        component: 'Text',
        text: [
          '| Nachweis | Was darzustellen bzw. zu belegen ist | Fundstelle |',
          '|---|---|---|',
          '| Unabhängiger Fluchtweg | Wegführung aus den betroffenen Geschoßen zum zweiten Treppenhaus; Ausgang zu einem sicheren Ort im Freien | OIB-RL 2, Pkt. 5.1.4 und Pkt. 5.1.1 [2][1] |',
          '| Wände und Decke | Oberirdisch: Wände REI 60; unterirdisch: REI 90 und A2; Decke über dem Treppenhaus REI 60 | OIB-RL 2, Tabelle 3 [1] |',
          '| Türen und Treppenläufe | Türen gemäß Tabelle 3 nach angrenzender Nutzung; Treppenläufe R 60 | OIB-RL 2, Tabelle 3 [1] |',
          '| Nutzbarkeit | Lichte Treppenlaufbreite anhand der maximal gleichzeitig auf die Treppe angewiesenen Personen | OIB-RL 4, Pkt. 2.4 [3] |',
        ].join('\n'),
      },
    ],
  } as unknown as AnswerCard,
]

export const twoCardsQuestion =
  'Welche Gebäudeklasse hat unser Wohnhaus — und hält der Treppenlauf die Schrittmaßregel ein?'

export const twoCardsAnswer = `Das Wohnhaus liegt mit einem obersten Fluchtniveau von 9,20 m in **Gebäudeklasse 4**; die Grenze zu GK 5 liegt bei 11 m [1].

Maßgeblich ist das Fluchtniveau des obersten Geschoßes mit Aufenthaltsräumen, gemessen über dem tiefsten Punkt des angrenzenden Geländes:

[[card:1]]

Verschiebt sich das Fluchtniveau im Zuge der Planung über 11 m, gelten die Anforderungen der Gebäudeklasse 5 [1].

Der Treppenlauf hält die Schrittmaßregel ein; die Rechnung steht unter der Antwort.

${FIRE_SOURCES}`

export const twoCards: AnswerCard[] = [
  {
    type: 'building_section',
    title: 'Gebäudeschnitt – Höhenprüfung GK 4',
    storeys: [
      { label: 'KG', height_m: 2.5, below_grade: true },
      { label: 'EG', height_m: 3.2 },
      { label: '1.OG', height_m: 3.0 },
      { label: '2.OG', height_m: 3.0 },
      { label: '3.OG', height_m: 3.0 },
    ],
    markers: [
      { label: 'Fluchtniveau', height_m: 9.2, kind: 'escape_level' },
      { label: 'GK4-Grenze', height_m: 11, kind: 'threshold' },
    ],
    reference: OIB2,
  } as AnswerCard,
  ...ledeCards,
]

export const followUpsQuestion = 'Was ist das Fluchtniveau und wie wird es gemessen?'

export const followUpsAnswer = `Das Fluchtniveau ist der **Fußboden des obersten Geschoßes mit Aufenthaltsräumen**, gemessen über dem tiefsten Punkt des angrenzenden Geländes. Es entscheidet über die Gebäudeklasse und damit über fast jede Brandschutzanforderung [1].

Gemessen wird lotrecht: vom tiefsten Punkt des Geländes an der Gebäudeaußenseite bis zur Oberkante des Fußbodens im obersten Geschoß mit Aufenthaltsräumen. Dachgeschoße zählen mit, sobald sie Aufenthaltsräume enthalten; ein reiner Technik- oder Abstellraum darüber bleibt außer Betracht.

Bei Hanglagen ist der tiefste Geländepunkt maßgeblich, nicht der Eingang. Das ist der häufigste Grund, warum ein Projekt in der Einreichung eine Klasse höher landet als in der Vorbemessung angenommen [2].

${STAIR_SOURCES}`

export const followUpsStageItems = [
  {
    question: 'Welche Gebäudeklasse ergibt sich für mein Projekt?',
    hint: 'aus dem Grundriss und dem Schnitt',
  },
  {
    question: 'Was ändert sich beim Sprung von GK 4 auf GK 5?',
    hint: 'Vergleich der Anforderungen',
  },
  { question: 'Zählt mein Dachgeschoß als Aufenthaltsraum?' },
  { question: 'Wie weise ich das Fluchtniveau im Einreichplan nach?' },
]

export const memoryQuestion = 'Zählt das Dachgeschoß als Aufenthaltsraum, wenn dort nur ein Büro liegt?'

export const memoryAnswer = `Ja. Ein Büro ist ein **Aufenthaltsraum** im Sinne der OIB-Richtlinien, weil es zum nicht nur vorübergehenden Aufenthalt von Menschen bestimmt ist. Damit zählt das Dachgeschoß für das Fluchtniveau mit [1].

Für Ihr Projekt heißt das: das oberste Geschoß mit Aufenthaltsräumen ist das Dachgeschoß, und das Fluchtniveau ist von dessen Fußboden zu messen — nicht vom darunterliegenden Regelgeschoß.

Ein reiner Technik-, Abstell- oder Trockenraum bliebe außer Betracht; sobald dort ein Arbeitsplatz eingerichtet ist, ändert sich die Beurteilung [2].

${STAIR_SOURCES}`

export const memoryStage: MessageStages = {
  memoryReflection: {
    items: [
      {
        id: 'row-1',
        kind: 'derived_fact',
        content:
          'Das Dachgeschoß enthält ein Büro und zählt damit als Geschoß mit Aufenthaltsräumen.',
      },
      {
        id: 'row-2',
        kind: 'constraint',
        content: 'Das Fluchtniveau ist ab Oberkante Fußboden des Dachgeschoßes zu messen.',
      },
    ],
  },
}

export const memoryCorrectionCards: AnswerCard[] = [
  {
    type: 'memory_proposal',
    title: 'Korrektur merken?',
    content: 'Das Fluchtniveau beträgt 11,40 m (Fußboden Dachgeschoß); das Gebäude liegt in Gebäudeklasse 5.',
    kind: 'derived_fact',
    confidence: 'high',
    supersedes: 'Das Fluchtniveau beträgt 9,80 m; das Gebäude liegt in Gebäudeklasse 4.',
    proposal_id: null,
  } as AnswerCard,
]

export const memoryCorrectionDecisions: CardInteractions = {
  'memory_proposal-0': { decision: 'savedProject', decidedAt: '2024-01-15T14:30:20.000Z' },
}

export const memoryCorrectionStage: MessageStages = {
  memoryReflection: {
    items: [
      {
        id: 'row-3',
        kind: 'constraint',
        content: 'Das Fluchtniveau ist ab Oberkante Fußboden des Dachgeschoßes zu messen.',
      },
    ],
  },
}

export const anatomyQuestion = 'Wie hoch muss das Geländer an der Dachterrasse sein?'

export const anatomyAnswer = `Maßgeblich ist die Absturzhöhe, nicht das Geschoß: gemessen wird von der Oberkante des begehbaren Belags bis zur tiefer liegenden angrenzenden Fläche — hier rund 13,2 m bis zum Gelände, also klar über der 12-m-Grenze [1].

Die Füllung ist getrennt zu beurteilen. Öffnungen dürfen 12 cm nicht überschreiten, und zwischen 20 und 60 cm über dem Belag sind waagrechte Elemente unzulässig, weil sie als Aufstiegshilfe wirken [1].

[[callout]]

Für Wien verlangt § 109 BO zusätzlich die Darstellung der Verankerung im Einreichplan; die Ausführung selbst bleibt Sache der Detailplanung [2].

${STAIR_SOURCES}`

export const anatomyMeta: AnswerMeta = {
  v: 1,
  summary:
    'Für die Dachterrasse sind 1,20 m Umwehrungshöhe erforderlich, weil die Absturzhöhe mit rund 13,2 m über der 12-m-Grenze liegt; gemessen wird ab Oberkante des begehbaren Belags.',
  verdict: {
    value: '1,20 m',
    subject: 'Erforderliche Höhe der Umwehrung',
    reference: { document: 'OIB-Richtlinie 4', section: 'Pkt. 4.1', edition: 'Ausgabe Mai 2023' },
  },
  callout: {
    kind: 'warning',
    text: 'Aufkantungen und Pflanztröge am Rand zählen zur Standfläche: die 1,20 m sind ab deren Oberkante zu messen.',
  },
  takeaways: [
    {
      text: 'Über 12 m Absturzhöhe sind 1,20 m Umwehrungshöhe erforderlich',
      detail: 'Unter 12 m genügen 1,00 m; die Grenze entscheidet, nicht das Geschoß.',
    },
    { text: 'Öffnungen der Füllung höchstens 12 cm' },
    { text: 'Keine waagrechten Elemente zwischen 20 und 60 cm über dem Belag' },
  ],
}

export const FEEDBACK_STATES: Record<
  string,
  { messageId: string; verdict: string; reason: string | null; comment: string | null }[]
> = {
  'conv-feedback-rest': [],
  'conv-feedback-down': [
    { messageId: 'msg-feedback-down', verdict: 'down', reason: 'inaccurate', comment: null },
  ],
}

export const feedbackQuestion =
  'Wie breit muss die Haupttreppe in einem Wohnhaus der Gebäudeklasse 4 sein?'

export const feedbackAnswer = `Die nutzbare **Laufbreite** der Haupttreppe muss mindestens **1,20 m** betragen. Gemessen wird zwischen den begrenzenden Bauteilen, Handläufe dürfen bis 10 cm je Seite einragen [1].

Für Wien konkretisiert § 111 BO die Ausführung: die Breite ist über den gesamten Lauf einzuhalten, Einbauten und Verziehungen dürfen sie an keiner Stelle unterschreiten [2].

${STAIR_SOURCES}`
