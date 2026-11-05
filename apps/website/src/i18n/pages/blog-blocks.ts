/**
 * Copy of the blog blocks page (`/blog-bausteine/`, unlisted): every post block with example
 * content from an architecture office, both locales. The page's structure lives in
 * `src/views/BlogBlocksView.astro`; the blocks' contracts in `src/components/blocks/contracts.ts`.
 * The figures are examples, and the page says so.
 */
import type { ChartBlock, KeyFiguresBlock, LegalSourceBlock, QaExcerptBlock } from '../../components/blocks/contracts';

const de = {
  meta: {
    title: 'Bausteine für Blogbeiträge',
    description: 'Die Bausteine, die in einen Beitrag gesetzt werden können, mit Beispielinhalt. Nicht verlinkt, nicht indexiert.',
  },
  kicker: 'Intern',
  heading: 'Bausteine für Blogbeiträge.',
  lead: 'Jeder Baustein, den die Redaktion in einen Beitrag setzen kann, mit Beispielinhalt aus einem Architekturbüro. Alle Zahlen auf dieser Seite sind Beispielwerte.',
  takeaways: {
    name: 'Das Wichtigste in Kürze',
    note: 'Steht am Anfang eines Beitrags: drei bis fünf Sätze, die man mitnimmt.',
    items: [
      'Rev. D ändert drei Dinge im Inneren des Moduls: Arbeitsplatz, Einbauschrank und Installationswand.',
      'Tragwerk, Fassade und Modultrennwände sind gleich geblieben.',
      'Jede Änderung geht auf ein Protokoll, eine Mail oder das Raumprogramm zurück.',
    ],
  },
  figures: {
    name: 'Kennzahlen',
    note: 'Zwei bis vier Werte in einer Reihe. Jeder Wert nennt seine Quelle.',
    block: {
      items: [
        { value: '3', label: 'Änderungen im Inneren', source: 'Planvergleich Rev. C mit Rev. D, Modul 1:25' },
        { value: '0', label: 'Änderungen an Tragwerk und Fassade', source: 'Planvergleich Rev. C mit Rev. D, Modul 1:25' },
        { value: '10', label: 'Protokolle und Mails gelesen', source: 'Projektablage, Stand 25.09.' },
      ],
    } satisfies KeyFiguresBlock,
  },
  compare: {
    name: 'Vorher und nachher',
    note: 'Zwei Planstände derselben Zeichnung. Die Trennlinie lässt sich mit der Maus, dem Finger und den Pfeiltasten verschieben.',
    beforeLabel: 'Rev. C, 12.09.',
    afterLabel: 'Rev. D, 25.09.',
    beforeAlt: 'Grundriss eines Wohnmoduls, Rev. C: Küchenzeile in der Mitte der oberen Wand, Bad rechts oben, Eingang rechts.',
    afterAlt: 'Derselbe Grundriss in Rev. D: Küchenzeile über die ganze Breite mit Schreibplatz, Einbauschrank am Eingang, Vorsatzschale am Bad.',
    caption: 'Wohnmodul im Grundriss, Rev. C vom 12.09. und Rev. D vom 25.09.',
  },
  annotated: {
    name: 'Bild mit Markierungen',
    note: 'Nummern auf einer Zeichnung und dieselben Nummern als Liste darunter.',
    alt: 'Grundriss eines Wohnmoduls in Rev. D mit drei nummerierten Markierungen.',
    caption: 'Was sich in Rev. D geändert hat, mit dem Beleg für jede Änderung.',
    markers: [
      {
        x: 22.5,
        y: 26,
        title: 'Arbeitsplatz in die Küchenzeile integriert',
        text: 'Die Küchenzeile läuft jetzt über die ganze Modulbreite, links mit Schreibplatz. Wunsch der Bauherrschaft nach einem Arbeitsplatz je Einheit, Protokoll Nr. 12.',
      },
      { x: 80.3, y: 74, title: 'Einbauschrank am Eingang ergänzt', text: 'Mehr Stauraum, wie im Raumprogramm je Einheit gefordert, S. 6.' },
      {
        x: 65,
        y: 40,
        title: 'Installationswand am Bad ergänzt',
        text: 'Die Leitungen laufen gebündelt in der neuen Vorsatzschale und nicht mehr durch die Modultrennwand. TGA-Abstimmung vom 25.09.',
      },
    ],
  },
  charts: {
    name: 'Diagramme',
    note: 'Säulen, gruppiert oder gestapelt, und Linien. Die Werte tippt die Redaktion als kleine Tabelle; das Diagramm entsteht auf dem Server.',
    blocks: [
      {
        form: 'bar',
        title: 'Mit jedem Planstand ändern sich weniger Räume.',
        caption: 'Geänderte Räume je Planstand, Wohnbau mit 24 Einheiten.',
        labels: ['Rev. A', 'Rev. B', 'Rev. C', 'Rev. D', 'Rev. E'],
        series: [{ name: 'Geänderte Räume', values: [14, 9, 6, 3, 1] }],
        source: 'Beispielwerte',
      },
      {
        form: 'bar',
        title: 'In der Ausführung entstehen die meisten Planstände.',
        caption: 'Planstände je Leistungsphase in zwei Projekten.',
        labels: ['Vorentwurf', 'Entwurf', 'Einreichung', 'Ausführung'],
        series: [
          { name: 'Wohnbau Seestadt', values: [4, 6, 3, 11] },
          { name: 'Schule Floridsdorf', values: [3, 5, 4, 9] },
        ],
        source: 'Beispielwerte',
      },
      {
        form: 'bar',
        stacking: 'stacked',
        title: 'Die meisten Rückfragen betreffen den Brandschutz.',
        caption: 'Rückfragen der Behörde je Monat, nach Thema.',
        labels: ['Jän.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni'],
        series: [
          { name: 'Brandschutz', values: [5, 7, 4, 6, 8, 5] },
          { name: 'Barrierefreiheit', values: [2, 3, 2, 4, 2, 3] },
          { name: 'Stellplätze', values: [1, 1, 2, 1, 0, 2] },
        ],
        source: 'Beispielwerte',
      },
      {
        form: 'line',
        title: 'Bis zur Einreichung sinkt die Zahl offener Rückfragen.',
        caption: 'Offene und neue Rückfragen im Projekt je Kalenderwoche.',
        axisLabel: 'Rückfragen',
        labels: ['KW 30', 'KW 31', 'KW 32', 'KW 33', 'KW 34', 'KW 35', 'KW 36', 'KW 37', 'KW 38', 'KW 39', 'KW 40', 'KW 41'],
        series: [
          { name: 'Offen', values: [18, 21, 24, 22, 19, 17, 15, 12, 10, 7, 5, 3] },
          { name: 'Neu', values: [6, 7, 5, 3, 2, 3, 2, 1, 2, 1, 1, 0] },
        ],
        source: 'Beispielwerte',
      },
    ] satisfies ChartBlock[],
  },
  legal: {
    name: 'Rechtsquelle',
    note: 'Eine Norm oder ein Gesetz, auf das sich der Beitrag stützt: Fundstelle, Fassung, Wortlaut und der Weg zur Quelle.',
    block: {
      title: 'OIB-Richtlinie 3',
      section: 'Punkt 11.2.1',
      version: 'Ausgabe Mai 2023',
      issuer: 'Österreichisches Institut für Bautechnik',
      excerpt: 'Die lichte Raumhöhe von Aufenthaltsräumen muss mindestens 2,50 m betragen.',
      url: 'https://www.oib.or.at/',
    } satisfies LegalSourceBlock,
  },
  qa: {
    name: 'Frage und Antwort',
    note: 'Eine Frage aus dem Büro und die Antwort, wie sie im Workspace steht, mit ihren Quellen.',
    block: {
      question: 'Ist der Aufgang als Fluchtweg breit genug?',
      asker: 'Projektleiterin, Wohnbau in Wien',
      answer:
        '**Ja, bis auf eine Stelle.** Das Brandschutzkonzept setzt für den Aufgang eine lichte Breite von mindestens 1,20 m an. Im Grundriss 1:100 ist er mit 1,30 m eingetragen, der Handlauf ist dabei schon abgezogen.\n\nAm Podest im 2. OG steht ein Schacht, der die Breite auf 1,15 m verringert. Das sollte mit der Haustechnik geklärt werden, bevor der Plan zur Einreichung geht.',
      sources: [
        { kind: 'project', title: 'Grundrisse 1:100', detail: 'Rev. D' },
        { kind: 'project', title: 'Brandschutzkonzept', detail: 'Punkt 4.2' },
        { kind: 'building_law', title: 'OIB-Richtlinie 2', detail: 'Punkt 5' },
        { kind: 'office', title: 'Checkliste Fluchtwege' },
      ],
      sourceCount: 7,
    } satisfies QaExcerptBlock,
  },
};

const en: typeof de = {
  meta: {
    title: 'Blocks for blog posts',
    description: 'The blocks that can be placed in a post, with example content. Not linked, not indexed.',
  },
  kicker: 'Internal',
  heading: 'Blocks for blog posts.',
  lead: 'Every block the editors can place in a post, with example content from an architecture office. All numbers on this page are example values.',
  takeaways: {
    name: 'Key takeaways',
    note: 'Sits at the top of a post: three to five sentences to take away.',
    items: [
      'Rev. D changes three things inside the module: the workplace, a built-in cabinet and an installation wall.',
      'Structure, facade and the walls between modules are unchanged.',
      'Every change goes back to a meeting record, an email or the room schedule.',
    ],
  },
  figures: {
    name: 'Key figures',
    note: 'Two to four values in a row. Every value names its source.',
    block: {
      items: [
        { value: '3', label: 'changes inside the module', source: 'Comparison of Rev. C with Rev. D, module 1:25' },
        { value: '0', label: 'changes to structure and facade', source: 'Comparison of Rev. C with Rev. D, module 1:25' },
        { value: '10', label: 'meeting records and emails read', source: 'Project files as of 25 Sept.' },
      ],
    },
  },
  compare: {
    name: 'Before and after',
    note: 'Two revisions of the same drawing. The divider moves with a mouse, a finger and the arrow keys.',
    beforeLabel: 'Rev. C, 12 Sept.',
    afterLabel: 'Rev. D, 25 Sept.',
    beforeAlt: 'Floor plan of a residential module, Rev. C: kitchen counter in the middle of the upper wall, bathroom top right, entrance on the right.',
    afterAlt: 'The same floor plan in Rev. D: kitchen counter across the full width with a desk, built-in cabinet at the entrance, installation wall at the bathroom.',
    caption: 'Residential module in plan, Rev. C of 12 September and Rev. D of 25 September.',
  },
  annotated: {
    name: 'Image with markers',
    note: 'Numbers on a drawing and the same numbers as a list below it.',
    alt: 'Floor plan of a residential module in Rev. D with three numbered markers.',
    caption: 'What changed in Rev. D, with the record behind each change.',
    markers: [
      {
        x: 22.5,
        y: 26,
        title: 'Workplace built into the kitchen counter',
        text: 'The counter now runs the full width of the module, with a desk on the left. The client asked for a workplace in every unit, meeting record no. 12.',
      },
      { x: 80.3, y: 74, title: 'Built-in cabinet at the entrance', text: 'More storage, as the room schedule asks for every unit, p. 6.' },
      {
        x: 65,
        y: 40,
        title: 'Installation wall at the bathroom',
        text: 'The services now run together in the new lining wall instead of through the wall between modules. Building services meeting of 25 September.',
      },
    ],
  },
  charts: {
    name: 'Charts',
    note: 'Bars, grouped or stacked, and lines. The editors type the values as a small table; the chart is drawn on the server.',
    blocks: [
      {
        form: 'bar',
        title: 'Each revision changes fewer rooms.',
        caption: 'Rooms changed per revision, housing with 24 units.',
        labels: ['Rev. A', 'Rev. B', 'Rev. C', 'Rev. D', 'Rev. E'],
        series: [{ name: 'Rooms changed', values: [14, 9, 6, 3, 1] }],
        source: 'Example values',
      },
      {
        form: 'bar',
        title: 'Most revisions come during construction documents.',
        caption: 'Revisions per work stage in two projects.',
        labels: ['Pre-design', 'Design', 'Permit', 'Construction'],
        series: [
          { name: 'Housing, Seestadt', values: [4, 6, 3, 11] },
          { name: 'School, Floridsdorf', values: [3, 5, 4, 9] },
        ],
        source: 'Example values',
      },
      {
        form: 'bar',
        stacking: 'stacked',
        title: 'Most queries concern fire safety.',
        caption: 'Queries from the authority per month, by topic.',
        labels: ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June'],
        series: [
          { name: 'Fire safety', values: [5, 7, 4, 6, 8, 5] },
          { name: 'Accessibility', values: [2, 3, 2, 4, 2, 3] },
          { name: 'Parking', values: [1, 1, 2, 1, 0, 2] },
        ],
        source: 'Example values',
      },
      {
        form: 'line',
        title: 'Open queries fall towards the permit application.',
        caption: 'Open and new queries in the project per calendar week.',
        axisLabel: 'Queries',
        labels: ['W 30', 'W 31', 'W 32', 'W 33', 'W 34', 'W 35', 'W 36', 'W 37', 'W 38', 'W 39', 'W 40', 'W 41'],
        series: [
          { name: 'Open', values: [18, 21, 24, 22, 19, 17, 15, 12, 10, 7, 5, 3] },
          { name: 'New', values: [6, 7, 5, 3, 2, 3, 2, 1, 2, 1, 1, 0] },
        ],
        source: 'Example values',
      },
    ],
  },
  legal: {
    name: 'Legal source',
    note: 'A norm or a law the post relies on: the passage, the edition, its wording and the way to the source.',
    block: {
      title: 'OIB-Richtlinie 3',
      section: 'Point 11.2.1',
      version: 'Edition May 2023',
      issuer: 'Austrian Institute of Construction Engineering',
      excerpt: 'Die lichte Raumhöhe von Aufenthaltsräumen muss mindestens 2,50 m betragen.',
      url: 'https://www.oib.or.at/',
    },
  },
  qa: {
    name: 'Question and answer',
    note: 'A question from the office and the answer as the workspace gives it, with its sources.',
    block: {
      question: 'Is the stair wide enough as an escape route?',
      asker: 'Project lead, housing in Vienna',
      answer:
        '**Yes, except in one place.** The fire safety concept sets a clear width of at least 1.20 m for the stair. The 1:100 floor plan shows 1.30 m, with the handrail already taken off.\n\nAt the landing on the second floor a shaft narrows it to 1.15 m. That should be settled with the building services engineers before the plan goes in for the permit.',
      sources: [
        { kind: 'project', title: 'Floor plans 1:100', detail: 'Rev. D' },
        { kind: 'project', title: 'Fire safety concept', detail: 'point 4.2' },
        { kind: 'building_law', title: 'OIB-Richtlinie 2', detail: 'point 5' },
        { kind: 'office', title: 'Escape route checklist' },
      ],
      sourceCount: 7,
    },
  },
};

export default { de, en };
