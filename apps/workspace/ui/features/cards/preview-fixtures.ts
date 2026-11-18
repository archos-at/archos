import { z } from 'zod'
import { answerCardSchema, validateAnswerCards, type AnswerCard } from '@/shared/cards/schemas'

type CardInput = z.input<typeof answerCardSchema>

const OIB2 = { document: 'OIB-Richtlinie 2', section: 'Pkt. 3.1', edition: 'Ausgabe Mai 2023' }
const OIB3 = { document: 'OIB-Richtlinie 3', section: 'Pkt. 9.1.1', edition: 'Ausgabe Mai 2023' }
const OIB4 = { document: 'OIB-Richtlinie 4', section: 'Pkt. 2.2', edition: 'Ausgabe Mai 2023' }

export const PREVIEW_EXCLUDED: Record<string, 'needsModel' | 'needsDocuments'> = {
  ifc_viewer: 'needsModel',
  ifc_compliance: 'needsModel',
  ifc_schedule: 'needsModel',
  ifc_element: 'needsModel',
  ifc_diff: 'needsModel',
  ifc_model_picker: 'needsModel',
  document_grid: 'needsDocuments',
}

const RAW_FIXTURES: CardInput[] = [
  {
    type: 'calculation',
    title: 'Netto-Grundfläche Brandabschnitt BA 2',
    steps: [
      {
        label: 'Netto-Grundfläche',
        operation: 'sum',
        unit: 'm²',
        operands: [
          { label: 'Büros Nord', value: 612.4, unit: 'm²', source: 'Raumbuch 3. OG' },
          { label: 'Büros Süd', value: 588, unit: 'm²', source: 'Raumbuch 3. OG' },
          {
            label: 'Gang und Nebenräume',
            value: 241.6,
            unit: 'm²',
            provenance: 'computed',
            tolerance: 2,
            source: 'Modell, Geschoß 3. OG',
          },
        ],
      },
    ],
    limit: {
      comparator: '<=',
      value: 1600,
      label: 'Büronutzung',
      reference: { document: 'OIB-Richtlinie 2', section: 'Pkt. 3.1.1', edition: 'Ausgabe Mai 2023' },
    },
  },
  {
    type: 'formula',
    title: 'Stiege Haus B',
    formula: {
      name: 'stair_step_rule',
      stair_type: 'main',
      riser: { value: 17.5, min: 10, max: 25, step: 0.5, source: 'Einreichplan, Schnitt B-B' },
      going: { value: null, min: 20, max: 40, step: 0.5 },
    },
  },
  {
    type: 'project_profile_patch',
    title: 'Projektkontext aktualisieren: Fluchtniveau',
    rationale:
      'Sie haben angegeben, dass das oberste Fluchtniveau bei 25 m liegt — damit ist das Gebäude ein Hochhaus (> 22 m) und OIB-Richtlinie 2.3 wird anwendbar.',
    patch: [{ op: 'add', path: '/facts/escape_level', value: '>22m' }],
    preview: [{ label: 'Fluchtniveau', before: '11–22 m', after: '> 22 m' }],
  },
  {
    type: 'memory_proposal',
    title: 'Diese Erkenntnis merken?',
    content: 'Das Büro setzt bei GK 4 durchgängig REI 90 an, auch wo REI 60 genügen würde.',
    kind: 'preference',
    confidence: 'high',
  },
  {
    type: 'document_draft',
    title: 'Aktenvermerk – Abweichung Fluchtweglänge',
    path: '/entwuerfe/aktenvermerk-fluchtweg.md',
    bytes: 4820,
    version: 3,
  },
  {
    type: 'document_draft',
    title: 'Aktenvermerk – Abweichung Fluchtweglänge',
    path: '/entwuerfe/aktenvermerk-fluchtweg.md',
    bytes: 4820,
    version: 3,
    document_id: '00000000-0000-4000-8000-000000000001',
    version_id: '00000000-0000-4000-8000-0000000000a1',
    version_state: 'draft',
  },
  {
    type: 'document_draft',
    title: 'Flächenaufstellung Top 4.xlsx',
    path: '/drafts/Flächenaufstellung Top 4.xlsx',
    bytes: 9412,
    version: 2,
    media_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  {
    type: 'task_created',
    task_id: '00000000-0000-4000-8000-0000000000f1',
    kind: 'submission_check',
    title: 'Einreichcheck: Bauansuchen Haus A',
    goal: 'Mach den Einreichcheck für das Bauansuchen bis Freitag',
    due_at: '2026-09-18T23:59:59.999Z',
    conversation_id: 's_00000000_0000_4000_8000_0000000000f2',
  },
  {
    type: 'file_operation_proposal',
    title: 'Drei Dateien in „Einreichung/Pläne“ verschieben',
    operation: 'move',
    operations: [
      {
        document: 'Grundriss EG.pdf',
        source: 'project',
        current: 'Nachweise',
        target_folder: 'Einreichung/Pläne',
      },
      {
        document: 'Grundriss OG.pdf',
        source: 'project',
        current: '',
        target_folder: 'Einreichung/Pläne',
      },
      {
        document: 'Schnitt A-A.pdf',
        source: 'project',
        current: 'Nachweise',
        target_folder: 'Einreichung/Pläne',
      },
    ],
    note: 'Vorschlag — es wurde noch nichts verschoben.',
  },
  {
    type: 'operation_proposal',
    title: 'Rename a folder (name: Pläne, folderId: f_1)',
    operation: 'folder-rename',
    input: { params: { id: '00000000-0000-4000-8000-0000000000a1', folderId: 'f_1' }, body: { name: 'Pläne' } },
    proposal_id: '00000000-0000-4000-8000-0000000000b1',
  },
  {
    type: 'look',
    document: { id: '00000000-0000-4000-8000-0000000000c1', name: 'Grundriss EG.pdf' },
    items: [
      { page: 2, scope: 'overview' },
      {
        page: 2,
        scope: 'region',
        region: [0.62, 0.04, 0.34, 0.22],
        where: 'oben rechts',
        question: 'Maßstab und Planstand im Plankopf?',
        reading: 'M 1:100, Stand 14.03.2026',
      },
      {
        origin: 'reference',
        page: 2,
        scope: 'region',
        region: [0.58, 0.34, 0.14, 0.22],
        where: 'in der Seitenmitte',
        label: 'Hier: Laufbreite 1,10 m',
      },
    ],
  },
  {
    type: 'revision_compare',
    older_id: '00000000-0000-4000-8000-0000000000d1',
    newer_id: '00000000-0000-4000-8000-0000000000d2',
    page: 2,
    changes: [
      { region: [0.62, 0.04, 0.34, 0.22], label: 'Plankopf: Index B statt A' },
      { region: [0.58, 0.34, 0.14, 0.22], label: 'Laufbreite 1,10 m statt 1,00 m' },
    ],
    summary: ['Plankopf: Index B statt A', 'Treppe: Laufbreite 1,10 m statt 1,00 m'],
  },
  {
    type: 'canvas_activity',
    document: { id: '00000000-0000-4000-8000-0000000000c1', name: 'Grundriss EG.pdf' },
    items: [
      {
        action: 'proposed',
        annotation_id: '00000000-0000-4000-8000-0000000000c2',
        number: 7,
        page: 1,
        shape: 'region',
        x: 0.58,
        y: 0.34,
        w: 0.14,
        h: 0.22,
        kind: 'defect',
        body: 'Laufbreite im Treppenhaus 1,10 m; für GK 4 sind 1,20 m nutzbare Laufbreite gefordert (OIB-Richtlinie 4, Pkt. 2.2).',
      },
      {
        action: 'proposed',
        annotation_id: '00000000-0000-4000-8000-0000000000c3',
        number: 8,
        page: 1,
        shape: 'point',
        x: 0.31,
        y: 0.62,
        kind: 'question',
        body: 'Ist die Tür zum Müllraum als EI2 30-C ausgeführt?',
      },
      {
        action: 'replied',
        annotation_id: '00000000-0000-4000-8000-0000000000c4',
        number: 4,
        excerpt: 'Die Brandschutztür ist im Türenbuch als EI2 30-C geführt, Position T-EG-04.',
      },
    ],
  },
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
  },
  {
    type: 'stair_diagram',
    title: 'Treppenlauf – Steigungsverhältnis',
    riser_count: 17,
    riser_height: {
      label: 'Steigung',
      value: 17.6,
      required: 18,
      unit: 'cm',
      comparator: '<=',
      status: 'pass',
      provenance: 'computed',
      tolerance: 0.5,
    },
    tread_depth: {
      label: 'Auftritt',
      value: 28,
      required: 28,
      unit: 'cm',
      comparator: '>=',
      status: 'warning',
      provenance: 'computed',
      tolerance: 0.5,
    },
    width: { label: 'Nutzbare Laufbreite', value: 110, required: 120, unit: 'cm', comparator: '>=', status: 'fail' },
    comfort_note: 'Schrittmaß 2×17,6 + 28 = 63,2 cm — innerhalb der Komfortregel (59–65 cm).',
    reference: OIB4,
  },
  {
    type: 'dimension_diagram',
    title: 'Rampe – Neigung & Breite',
    shape: 'ramp',
    dimensions: [
      { label: 'Neigung', value: 7.2, required: 6, unit: '%', comparator: '<=', status: 'fail', provenance: 'computed', tolerance: 0.1 },
      { label: 'nutzbare Breite', value: 120, required: 120, unit: 'cm', comparator: '>=', status: 'pass', provenance: 'declared' },
      {
        label: 'Handlauf beidseitig',
        value: null,
        unit: 'cm',
        status: 'needs_input',
        missing: 'Dieser Export enthält kein IfcRailing — Handläufe im CAD als IfcRailing modellieren.',
      },
    ],
    reference: { document: 'ÖNORM B 1600', section: 'Pkt. 5.2' },
  },
  {
    type: 'setback_plan',
    title: 'Abstandsflächen – Lageplan',
    parcel_width_m: 22,
    parcel_depth_m: 30,
    building_width_m: 12,
    building_depth_m: 14,
    sides: [
      { side: 'left', required_m: 3, actual_m: 2.4, status: 'fail' },
      { side: 'right', required_m: 3, actual_m: 4.2, status: 'pass' },
      { side: 'front', required_m: 5, actual_m: 6.0, status: 'pass' },
      { side: 'back', required_m: 3, actual_m: null, status: 'needs_input' },
    ],
    reference: { document: 'NÖ Bauordnung 2014', section: '§ 54' },
  },
  {
    type: 'egress_diagram',
    title: 'Fluchtweg – Gehweglänge',
    segments: [
      { label: 'Raum → Gang', length_m: 12, turn: 'right' },
      { label: 'Gang', length_m: 18, turn: 'left' },
      { label: 'Gang → Treppenhaus', length_m: 8, turn: 'straight' },
    ],
    total_length: {
      label: 'Gehweglänge gesamt',
      value: 38,
      required: 40,
      unit: 'm',
      comparator: '<=',
      status: 'pass',
    },
    reference: OIB2,
  },
  {
    type: 'daylight_incidence',
    title: 'Belichtung – freier Lichteinfall',
    room_floor_area_m2: 22,
    glass_area: {
      label: 'Lichteintrittsfläche',
      value: 2.6,
      required: 2.2,
      unit: 'm²',
      comparator: '>=',
      status: 'pass',
    },
    window_sill_height_m: 1.0,
    window_head_height_m: 2.4,
    obstruction: { distance_m: 6, height_m: 7.5, label: 'Gegenüberliegendes Gebäude' },
    reference: OIB3,
  },
  {
    type: 'guardrail_check',
    title: 'Absturzsicherung Dachterrasse',
    context: 'roof_terrace',
    fall_height: { label: 'Absturzhöhe', value: 13.5, required: 12, unit: 'm', comparator: '<=', status: 'warning' },
    rail_height: { label: 'Geländerhöhe', value: 100, required: 110, unit: 'cm', comparator: '>=', status: 'fail' },
    max_opening: { label: 'max. Öffnungsweite', value: 11, required: 12, unit: 'cm', comparator: '<=', status: 'pass' },
    bottom_gap: { label: 'Bodenspalt', value: 3, required: 12, unit: 'cm', comparator: '<=', status: 'pass' },
    has_horizontal_elements_in_climb_zone: false,
    reference: OIB4,
  },
  {
    type: 'fire_access_plan',
    title: 'Feuerwehrzufahrt & Aufstellfläche',
    parcel_width_m: 28,
    parcel_depth_m: 36,
    building_width_m: 16,
    building_depth_m: 14,
    route_width: { label: 'Zufahrt Breite', value: 3.5, required: 3, unit: 'm', comparator: '>=', status: 'pass' },
    gate_clearance_height: {
      label: 'Durchfahrt lichte Höhe',
      value: 4.0,
      required: 4.0,
      unit: 'm',
      comparator: '>=',
      status: 'pass',
    },
    staging_area: {
      width: { label: 'Breite', value: 5, required: 5, unit: 'm', comparator: '>=', status: 'pass' },
      length: { label: 'Länge', value: 11, required: 10, unit: 'm', comparator: '>=', status: 'pass' },
      distance_to_facade: {
        label: 'Abstand zur Fassade',
        value: 3,
        required: 10,
        unit: 'm',
        comparator: '<=',
        status: 'pass',
      },
    },
    walk_distance_to_entrance: {
      label: 'Weg zum Eingang',
      value: 34,
      required: 80,
      unit: 'm',
      comparator: '<=',
      status: 'pass',
    },
    building_class: 'GK 4',
    reference: { document: 'TRVB F 134', section: 'Pkt. 4' },
  },
  {
    type: 'surface',
    title: 'Zweiter Fluchtweg — zwei Varianten',
    components: [
      {
        id: 'root',
        component: 'Tabs',
        tabs: [
          { title: 'Außentreppe', child: 'aussen' },
          { title: 'Zweites Treppenhaus', child: 'treppenhaus' },
        ],
      },
      {
        id: 'aussen',
        component: 'Text',
        text: [
          '1. **Lage klären**: Abstand zu Fenstern und Öffnungen prüfen.',
          '2. **Brandschutzkonzept ergänzen**: Außentreppe als Fluchtweg nachweisen.',
          '3. **Einreichung** mit dem Bauansuchen.',
        ].join('\n'),
      },
      {
        id: 'treppenhaus',
        component: 'Text',
        text: [
          '1. **Grundriss anpassen**: zweites Treppenhaus im Gebäudekern.',
          '2. **Fluchtweglängen neu messen**: Längen zu beiden Treppenhäusern.',
          '3. **Einreichung** mit dem Bauansuchen.',
        ].join('\n'),
      },
    ],
  },
]

export const CARD_PREVIEW_FIXTURES: Partial<Record<AnswerCard['type'], AnswerCard>> = Object.fromEntries(
  validateAnswerCards(RAW_FIXTURES).flatMap((card) => (card ? [[card.type, card] as const] : []))
)

export function previewFixtureFor(type: string): AnswerCard | undefined {
  return CARD_PREVIEW_FIXTURES[type as AnswerCard['type']]
}
