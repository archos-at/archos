import type { Translator } from '@/i18n/translate'
import { answerExport as canonicalDictionary } from '@/i18n/dictionaries/en/answer-export'
import type { AnswerCard } from '@/shared/cards/schemas'
import { compact, type DocBlock, type DocRun, type HeadingLevel } from './blocks'
import { markdownToBlocks, type MarkdownToBlocksOptions } from './markdown'

type CardRecord = Record<string, unknown>

const isRecord = (value: unknown): value is CardRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const flattenKeys = (node: unknown, prefix: string, into: Set<string>): Set<string> => {
  if (typeof node === 'string') {
    into.add(prefix)
    return into
  }
  if (isRecord(node)) {
    for (const [key, child] of Object.entries(node)) {
      flattenKeys(child, prefix ? `${prefix}.${key}` : key, into)
    }
  }
  return into
}

const OVERRIDDEN_PATHS = flattenKeys(canonicalDictionary.fieldsByPath, '', new Set<string>())

const VOCABULARIES = new Map<string, Set<string>>(
  Object.entries(canonicalDictionary.values).map(([field, members]) => [
    field,
    new Set(Object.keys(members)),
  ])
)

type ExportKind = 'content' | 'live' | 'chrome' | 'composite'

export const CARD_EXPORT: Record<AnswerCard['type'], ExportKind> = {
  ifc_model_picker: 'chrome',
  task_created: 'chrome',
  memory_proposal: 'chrome',
  project_profile_patch: 'chrome',
  document_draft: 'chrome',
  file_operation_proposal: 'chrome',
  operation_proposal: 'chrome',
  canvas_activity: 'chrome',
  look: 'chrome',
  revision_compare: 'chrome',

  ifc_viewer: 'live',
  ifc_compliance: 'live',
  ifc_schedule: 'live',
  ifc_element: 'live',
  ifc_diff: 'live',

  calculation: 'content',
  formula: 'content',
  building_section: 'content',
  stair_diagram: 'content',
  dimension_diagram: 'content',
  setback_plan: 'content',
  egress_diagram: 'content',
  daylight_incidence: 'content',
  guardrail_check: 'content',
  fire_access_plan: 'content',
  document_grid: 'content',
  surface: 'composite',
}

export const exportKindOf = (type: string): ExportKind =>
  CARD_EXPORT[type as AnswerCard['type']] ?? 'content'

export const SKIPPED_FIELDS = new Set([
  'type',
  'title',
  'preview',
  'search',
  'site_binding',
])

const FIELD_ORDER: Record<string, string[]> = {
  project_profile_patch: ['rationale', 'patch'],
  memory_proposal: ['kind', 'confidence', 'content'],
  building_section: ['storeys', 'markers', 'reference', 'note'],
  stair_diagram: ['riser_count', 'riser_height', 'tread_depth', 'width', 'comfort_note', 'reference'],
  dimension_diagram: ['shape', 'dimensions', 'reference', 'note'],
  setback_plan: [
    'parcel_width_m',
    'parcel_depth_m',
    'building_width_m',
    'building_depth_m',
    'sides',
    'reference',
  ],
  egress_diagram: ['start_label', 'exit_label', 'segments', 'total_length', 'reference'],
  daylight_incidence: [
    'room_floor_area_m2',
    'window_sill_height_m',
    'window_head_height_m',
    'glass_area',
    'obstruction',
    'reference',
    'note',
  ],
  guardrail_check: [
    'context',
    'fall_height',
    'rail_height',
    'max_opening',
    'bottom_gap',
    'has_horizontal_elements_in_climb_zone',
    'reference',
    'note',
  ],
  fire_access_plan: [
    'building_class',
    'parcel_width_m',
    'parcel_depth_m',
    'building_width_m',
    'building_depth_m',
    'route_width',
    'gate_clearance_height',
    'staging_area',
    'walk_distance_to_entrance',
    'reference',
    'note',
  ],
  document_grid: ['query', 'documents'],
}

const PROSE_LENGTH = 90

export const isCheck = (value: unknown): value is CardRecord =>
  isRecord(value) &&
  typeof value.status === 'string' &&
  ('value' in value || 'required' in value || 'unit' in value)

const isReference = (value: unknown): value is CardRecord =>
  isRecord(value) && typeof value.document === 'string' && !('status' in value)

const flatLabel = (name: string, t: Translator): string => {
  const label = t(`fields.${name}`)
  return label.startsWith('answerExport.fields.') ? humanize(name) : label
}

const overrideKey = (path: string, siblings: CardRecord | undefined): string | null => {
  if (siblings) {
    for (const [name, value] of Object.entries(siblings)) {
      if (typeof value !== 'string') continue
      const variant = `${path}?${name}=${value}`
      if (OVERRIDDEN_PATHS.has(variant)) return variant
    }
  }
  return OVERRIDDEN_PATHS.has(path) ? path : null
}

const fieldLabel = (
  path: string,
  name: string,
  t: Translator,
  siblings?: CardRecord
): string => {
  const key = overrideKey(path, siblings)
  return key ? t(`fieldsByPath.${key}`) : flatLabel(name, t)
}

const humanize = (name: string): string =>
  name.replace(/_/g, ' ').replace(/^./, (character) => character.toUpperCase())

const valueText = (name: string, value: string, t: Translator): string =>
  VOCABULARIES.get(name)?.has(value) ? t(`values.${name}.${value}`) : value

const scalarText = (name: string, value: unknown, t: Translator): string => {
  if (typeof value === 'boolean') return t(value ? 'boolean.true' : 'boolean.false')
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return valueText(name, value, t)
  return ''
}

const isScalar = (value: unknown): value is string | number | boolean =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'

const statusText = (value: unknown, t: Translator): string =>
  typeof value === 'string' ? valueText('status', value, t) : ''

const measure = (value: unknown, unit: unknown): string => {
  if (typeof value !== 'number') return ''
  const suffix = typeof unit === 'string' && unit ? ` ${unit}` : ''
  return `${value}${suffix}`
}

const referenceText = (reference: CardRecord): string =>
  [reference.document, reference.section, reference.edition]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(', ')

const checkRow = (
  path: string,
  name: string,
  check: CardRecord,
  t: Translator
): DocRun[][] => {
  const provenance =
    typeof check.provenance === 'string' ? valueText('provenance', check.provenance, t) : ''
  const qualifier = provenance && provenance !== check.provenance ? ` (${provenance})` : ''
  const unit = typeof check.unit === 'string' && check.unit ? ` ${check.unit}` : ''
  const tolerance = typeof check.tolerance === 'number' ? ` ±${check.tolerance}` : ''
  const actual =
    typeof check.value === 'number' ? `${check.value}${tolerance}${unit}` : ''
  const required = measure(check.required, check.unit)
  const comparator = typeof check.comparator === 'string' ? `${check.comparator} ` : ''
  const missing = typeof check.missing === 'string' && check.missing ? `\n${check.missing}` : ''

  return [
    [{ text: (typeof check.label === 'string' && check.label) || fieldLabel(path, name, t) }],
    [{ text: actual ? `${actual}${qualifier}` : '' }],
    [{ text: required ? `${comparator}${required}` : '' }],
    [{ text: `${statusText(check.status, t)}${missing}` }],
  ]
}

export const skippedNested = (path: string, key: string): boolean =>
  key === 'type' || (key === 'step' && path.startsWith('formula.'))

const nestedText = (path: string, name: string, value: unknown, t: Translator): string => {
  if (isScalar(value)) return scalarText(name, value, t)
  if (Array.isArray(value)) {
    return value
      .map((entry) => nestedText(path, name, entry, t))
      .filter(Boolean)
      .join('; ')
  }
  if (isCheck(value)) {
    const actual = measure(value.value, value.unit)
    const required = measure(value.required, value.unit)
    const comparator = typeof value.comparator === 'string' ? `${value.comparator} ` : ''
    return [actual, required ? `(${comparator}${required})` : '', statusText(value.status, t)]
      .filter(Boolean)
      .join(' ')
  }
  if (isReference(value)) return referenceText(value)
  if (isRecord(value)) {
    return Object.entries(value)
      .filter(([key]) => !skippedNested(path, key))
      .map(
        ([key, entry]) =>
          `${fieldLabel(`${path}.${key}`, key, t, value)}: ${nestedText(`${path}.${key}`, key, entry, t)}`
      )
      .filter((part) => !part.endsWith(': '))
      .join('; ')
  }
  return ''
}

const objectTable = (path: string, rows: CardRecord[], t: Translator): DocBlock => {
  const keys: string[] = []
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!skippedNested(path, key) && !keys.includes(key)) keys.push(key)
    }
  }
  return {
    kind: 'table',
    head: keys.map((key) => fieldLabel(`${path}.${key}`, key, t)),
    rows: rows.map((row) =>
      keys.map((key) => [{ text: nestedText(`${path}.${key}`, key, row[key], t) }])
    ),
  }
}

const matrixTable = (matrix: unknown[][], head: string[] | undefined, t: Translator): DocBlock => ({
  kind: 'table',
  head,
  rows: matrix.map((row) => row.map((value) => [{ text: nestedText('', '', value, t) }])),
})

const isMatrix = (value: unknown): value is unknown[][] =>
  Array.isArray(value) && value.length > 0 && value.every((row) => Array.isArray(row))

const headerFieldFor = (card: CardRecord, matrix: unknown[][]): string | null => {
  const width = Math.max(...matrix.map((row) => row.length))
  for (const [name, value] of Object.entries(card)) {
    if (SKIPPED_FIELDS.has(name) || value === matrix) continue
    if (!Array.isArray(value) || value.length !== width) continue
    const labels = value.every(
      (entry) => isRecord(entry) && typeof entry.label === 'string' && entry.label.trim()
    )
    if (labels) return name
  }
  return null
}

class CardBody {
  readonly blocks: DocBlock[] = []
  private scalars: DocRun[][][] = []
  private checks: DocRun[][][] = []

  constructor(private readonly t: Translator) {}

  scalar(path: string, name: string, value: unknown, siblings: CardRecord): void {
    this.flushChecks()
    this.scalars.push([
      [{ text: fieldLabel(path, name, this.t, siblings) }],
      [{ text: scalarText(name, value, this.t) }],
    ])
  }

  check(path: string, name: string, value: CardRecord): void {
    this.flushScalars()
    this.checks.push(checkRow(path, name, value, this.t))
  }

  block(block: DocBlock): void {
    this.flush()
    this.blocks.push(block)
  }

  labelled(label: string, text: string, style?: 'body' | 'quote'): void {
    this.flush()
    this.blocks.push({ kind: 'paragraph', runs: [{ text: label, bold: true }] })
    this.blocks.push({ kind: 'paragraph', runs: [{ text }], style: style ?? 'body' })
  }

  flush(): void {
    this.flushScalars()
    this.flushChecks()
  }

  private flushScalars(): void {
    if (this.scalars.length === 0) return
    this.blocks.push({ kind: 'table', rows: this.scalars })
    this.scalars = []
  }

  private flushChecks(): void {
    if (this.checks.length === 0) return
    this.blocks.push({
      kind: 'table',
      head: [
        flatLabel('label', this.t),
        flatLabel('value', this.t),
        flatLabel('required', this.t),
        flatLabel('status', this.t),
      ],
      rows: this.checks,
    })
    this.checks = []
  }
}

const orderedFields = (card: CardRecord, type: string): string[] => {
  const declared = FIELD_ORDER[type] ?? []
  const present = Object.keys(card).filter((key) => !SKIPPED_FIELDS.has(key))
  const ordered = declared.filter((key) => present.includes(key))
  return [...ordered, ...present.filter((key) => !ordered.includes(key))]
}

const cardHeading = (card: CardRecord, type: string, t: Translator): string => {
  const title = typeof card.title === 'string' ? card.title.trim() : ''
  if (title) return title
  const name = t(`cardTypes.${type}`)
  return name.startsWith('answerExport.cardTypes.') ? humanize(type) : name
}

export interface CardBlocksOptions extends MarkdownToBlocksOptions {
  headingLevel?: HeadingLevel
}

export function cardBlocks(value: unknown, t: Translator, options: CardBlocksOptions = {}): DocBlock[] {
  if (!isRecord(value)) return []
  const card = value
  const type = card.type
  if (typeof type !== 'string') return []

  const kind = exportKindOf(type)
  if (kind === 'chrome') return []
  if (kind === 'composite') return surfaceBlocks(card, t, options)

  const heading: DocBlock = { kind: 'heading', level: options.headingLevel ?? 3, text: cardHeading(card, type, t) }

  if (kind === 'live') {
    const note = typeof card.note === 'string' ? card.note.trim() : ''
    return compact([
      heading,
      note ? { kind: 'paragraph', runs: [{ text: note }] } : null,
      { kind: 'paragraph', runs: [{ text: t('liveCard') }], style: 'meta' },
    ])
  }

  const body = new CardBody(t)
  const fields = orderedFields(card, type)

  const headerFields = new Map<string, string>()
  const consumed = new Set<string>()
  for (const name of fields) {
    const field = card[name]
    if (!isMatrix(field)) continue
    const header = headerFieldFor(card, field)
    if (header && !consumed.has(header)) {
      headerFields.set(name, header)
      consumed.add(header)
    }
  }

  for (const name of fields) {
    const field = card[name]
    if (field === null || field === undefined) continue
    if (consumed.has(name)) continue
    const path = `${type}.${name}`

    if (isCheck(field)) {
      body.check(path, name, field)
      continue
    }

    if (isReference(field)) {
      const text = referenceText(field)
      if (text) body.labelled(fieldLabel(path, name, t, card), text)
      const excerpt = typeof field.excerpt === 'string' ? field.excerpt.trim() : ''
      if (excerpt) body.block({ kind: 'paragraph', runs: [{ text: `„${excerpt}“` }], style: 'quote' })
      continue
    }

    if (Array.isArray(field)) {
      if (field.length === 0) continue
      const label = fieldLabel(path, name, t, card)
      if (isMatrix(field)) {
        const header = headerFields.get(name)
        const head = header
          ? (card[header] as CardRecord[]).map((column) => String(column.label))
          : undefined
        body.flush()
        if (!head) body.block({ kind: 'paragraph', runs: [{ text: label, bold: true }] })
        body.block(matrixTable(field, head, t))
        continue
      }
      if (field.every((entry) => isScalar(entry))) {
        body.flush()
        body.block({ kind: 'paragraph', runs: [{ text: label, bold: true }] })
        body.block({
          kind: 'bullets',
          items: field.map((entry) => [{ text: scalarText(name, entry, t) }]),
        })
        continue
      }
      const rows = field.filter(isRecord)
      if (rows.length > 0) {
        body.flush()
        body.block({ kind: 'paragraph', runs: [{ text: label, bold: true }] })
        body.block(objectTable(path, rows, t))
      }
      continue
    }

    if (isRecord(field)) {
      const text = nestedText(path, name, field, t)
      if (text) body.labelled(fieldLabel(path, name, t, card), text)
      continue
    }

    if (isScalar(field)) {
      const text = scalarText(name, field, t)
      if (!text.trim()) continue
      if (text.length > PROSE_LENGTH || text.includes('\n')) {
        body.labelled(fieldLabel(path, name, t, card), text)
      } else {
        body.scalar(path, name, field, card)
      }
    }
  }

  body.flush()
  return compact([heading, ...body.blocks])
}

function surfaceBlocks(card: Record<string, unknown>, t: Translator, options: CardBlocksOptions): DocBlock[] {
  const components = Array.isArray(card.components) ? card.components.filter(isRecord) : []
  const byId = new Map(components.map((component) => [String(component.id), component]))
  const title = typeof card.title === 'string' && card.title.trim() ? card.title.trim() : null
  const blocks: DocBlock[] = title ? [{ kind: 'heading', level: 3, text: title }] : []
  const { headingLevel: _headingLevel, ...markdownOptions } = options
  const seen = new Set<string>()
  const walk = (id: string, level: HeadingLevel) => {
    const component = byId.get(id)
    if (!component || seen.has(id)) return
    seen.add(id)
    const name = String(component.component)
    if (name === 'Row' || name === 'Column') {
      for (const child of Array.isArray(component.children) ? component.children : []) walk(String(child), level)
      return
    }
    if (name === 'Tabs') {
      for (const tab of Array.isArray(component.tabs) ? component.tabs.filter(isRecord) : []) {
        const tabTitle = typeof tab.title === 'string' ? tab.title.trim() : ''
        if (tabTitle) blocks.push({ kind: 'heading', level, text: tabTitle })
        walk(String(tab.child), tabTitle ? deeper(level) : level)
      }
      return
    }
    if (name === 'Text') {
      if (typeof component.text === 'string') {
        blocks.push(...markdownToBlocks(component.text, { ...markdownOptions, headingFloor: level }))
      }
      return
    }
    const { id: _id, component: _component, ...props } = component
    blocks.push(...cardBlocks({ ...props, type: name }, t, { ...options, headingLevel: level }))
  }
  walk('root', title ? 4 : 3)
  return blocks
}

const deeper = (level: HeadingLevel): HeadingLevel => Math.min(5, level + 1) as HeadingLevel

export function cardsBlocks(cards: unknown, t: Translator, options: CardBlocksOptions = {}): DocBlock[] {
  if (!Array.isArray(cards)) return []
  return cards.flatMap((card) => cardBlocks(card, t, options))
}
