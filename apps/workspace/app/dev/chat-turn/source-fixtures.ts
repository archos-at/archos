import type { CitationSource } from '@/features/chat/types'

export const citations: CitationSource[] = [
  {
    id: 'c1',
    content: '',
    timestamp: new Date('2024-01-15T14:30:00'),
    isCited: true,
    kind: 'building_law',
    lane: 'building_law_oib',
    laneLabel: 'OIB-Richtlinie',
    fileName: 'OIB-RL_2_Brandschutz.pdf',
    title: 'OIB-Richtlinie 2 · Brandschutz',
    page: 18,
    number: 1,
  },
  {
    id: 'c2',
    content: '',
    timestamp: new Date('2024-01-15T14:30:00'),
    isCited: true,
    kind: 'building_law',
    lane: 'building_law_ris',
    laneLabel: 'Bundesrecht',
    title: 'Bauordnung für Wien § 108',
    url: 'https://www.ris.bka.gv.at/',
    number: 2,
  },
]

export const OIB2 = { document: 'OIB-Richtlinie 2', section: 'Tabelle 1b', edition: 'Ausgabe Mai 2023' }
export const OIB4 = { document: 'OIB-Richtlinie 4', section: 'Pkt. 2.2', edition: 'Ausgabe Mai 2023' }

export const stairCitations: CitationSource[] = [
  {
    id: 's1',
    content: '',
    timestamp: new Date('2024-01-15T14:30:00'),
    isCited: true,
    kind: 'building_law',
    lane: 'building_law_oib',
    laneLabel: 'OIB-Richtlinie',
    fileName: 'OIB-RL_4_Nutzungssicherheit.pdf',
    title: 'OIB-Richtlinie 4 · Nutzungssicherheit',
    page: 7,
    number: 1,
  },
  {
    id: 's2',
    content: '',
    timestamp: new Date('2024-01-15T14:30:00'),
    isCited: true,
    kind: 'building_law',
    lane: 'building_law_ris',
    laneLabel: 'Bundesrecht',
    title: 'Bauordnung für Wien § 109',
    url: 'https://www.ris.bka.gv.at/',
    number: 2,
  },
]

export const STAIR_SOURCES = `## Quellen
- [1] [KB] OIB-RL_4_Nutzungssicherheit.pdf, Pkt. 2.2
- [2] [RIS] Bauordnung für Wien § 109 — https://www.ris.bka.gv.at/`

export const fireCitations: CitationSource[] = [
  {
    id: 'f1',
    content: '',
    timestamp: new Date('2024-01-15T14:30:00'),
    isCited: true,
    kind: 'building_law',
    lane: 'building_law_oib',
    laneLabel: 'OIB-Richtlinie',
    fileName: 'OIB-RL_2_Brandschutz.pdf',
    title: 'OIB-Richtlinie 2 · Brandschutz',
    page: 12,
    number: 1,
  },
  {
    id: 'f2',
    content: '',
    timestamp: new Date('2024-01-15T14:30:00'),
    isCited: true,
    kind: 'building_law',
    lane: 'building_law_ris',
    laneLabel: 'Bundesrecht',
    title: 'Bauordnung für Wien §§ 60 ff.',
    url: 'https://www.ris.bka.gv.at/',
    number: 2,
  },
]

export const FIRE_SOURCES = `## Quellen
- [1] [KB] OIB-RL_2_Brandschutz.pdf, Tabelle 1b
- [2] [RIS] Bauordnung für Wien §§ 60 ff. — https://www.ris.bka.gv.at/`

export const variantsCitations: CitationSource[] = [1, 2, 3].map((number) => ({
  id: `v${number}`,
  content: '',
  timestamp: new Date('2026-09-24T11:40:00'),
  isCited: true,
  kind: 'building_law',
  lane: 'building_law_oib',
  laneLabel: 'OIB-Richtlinie',
  fileName: number === 3 ? 'oib-rl_4_ausgabe_mai_2023.pdf' : 'oib-rl_2_ausgabe_mai_2023.pdf',
  title: number === 3 ? 'OIB-Richtlinie 4 · Nutzungssicherheit' : 'OIB-Richtlinie 2 · Brandschutz',
  page: number === 1 ? 23 : number === 2 ? 13 : 6,
  number,
}))
