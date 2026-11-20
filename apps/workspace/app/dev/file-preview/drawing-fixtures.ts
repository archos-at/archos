import type { FileItem } from '@/features/documents/components/project-file-workspace'
import { FIXTURE } from './fixtures'

export const DRAWING_FIXTURE: FileItem = {
  ...FIXTURE,
  id: 'dev-doc-drawing',
  filename: 'WBN_Grundriss_1OG_Index_C.pdf',
  contentType: 'application/pdf',
  fileSize: 2_380_000,
  pageCount: 1,
}

export const DEV_STRUCTURED_RAW = {
  schema_version: 4,
  registry: 'architecture+general@850c9b2d770a',
  segment: {
    domain: 'architecture',
    segment_type: 'floor_plan',
    title: 'Regelgeschoss',
    scale: '1:100',
    summary: 'Regelgeschoss mit vier Wohneinheiten um einen zentralen Erschließungskern.',
    entities: [
      { name: 'Wohnen/Essen', category: 'space', role: 'Aufenthalt', measure: '38,4 m²' },
      { name: 'Laubengang', category: 'circulation', role: 'Erschließung', measure: null },
      { name: 'Sicherheitstreppenhaus', category: 'circulation', role: null, measure: null },
      { name: 'Stützenraster 5,40 m', category: 'structure', role: null, measure: null },
      { name: 'Wärmepumpe Sole/Wasser', category: 'services', role: null, measure: null },
      {
        name: 'Schallschutz Wohnungstrennwand',
        category: 'building_physics',
        role: 'R′w 55 dB',
        measure: null,
      },
      { name: 'Brettsperrholz', category: 'material', role: null, measure: null },
    ],
    compositions: [
      {
        component: 'Außenwand',
        layers: [
          { material: 'Lärchenschalung', thickness: '24 mm', function: 'Witterungsschutz' },
          { material: 'Mineralwolle', thickness: '200 mm', function: 'Dämmung' },
          { material: 'Brettsperrholz', thickness: '100 mm', function: 'tragend' },
        ],
      },
    ],
    states: [
      { element: 'Bestandsmauer Hof', state: 'existing' },
      { element: 'Laubengang', state: 'new' },
    ],
    quantities: [
      {
        object: 'Bausubstanz erhalten',
        property: 'Anteil',
        value: '71',
        unit: '%',
        source: 'text',
        confidence: 'high',
      },
      {
        object: 'Wohneinheiten',
        property: 'Anzahl',
        value: '4',
        unit: null,
        source: 'visual',
        confidence: 'high',
      },
    ],
    relations: [
      { subject: 'Laubengang', relation: 'erschließt', object: 'alle vier Wohneinheiten' },
    ],
    annotations: ['5,40', '38,4 m²'],
    source: 'visual',
    confidence: 'medium',
  },
  document: {
    title: 'Wohnbau Nord',
    subtitle: 'Transformation eines Bestandsbaus',
    slogans: ['ABRISS STOPPEN'],
    author: 'Arch. DI Huber',
    institution: 'TU Wien',
    supervision: null,
    location: 'Linz',
    strategies: ['Bestandserhalt', 'Vorfertigung'],
    process_steps: ['Abriss stoppen', 'Bestand transformieren', 'gemeinschaftlich wohnen'],
  },
}
