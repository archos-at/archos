export interface StructuredEntity {
  name: string
  category: string
  role: string | null
  measure: string | null
}

export interface StructuredLayer {
  material: string
  thickness: string | null
  purpose: string | null
}

export interface StructuredComposition {
  component: string
  layers: StructuredLayer[]
}

export interface StructuredState {
  element: string
  state: string
}

export interface StructuredQuantity {
  object: string
  property: string
  value: string
  unit: string | null
  source: string | null
  confidence: string | null
}

export interface StructuredRelation {
  subject: string
  relation: string
  object: string
}

export interface StructuredEntityGroup {
  category: string
  entities: StructuredEntity[]
}

export interface StructuredSegment {
  domain: string
  segmentType: string
  title: string | null
  scale: string | null
  summary: string
  entityGroups: StructuredEntityGroup[]
  compositions: StructuredComposition[]
  states: StructuredState[]
  quantities: StructuredQuantity[]
  relations: StructuredRelation[]
  annotations: string[]
  source: string | null
  confidence: string | null
}

export interface StructuredDocument {
  title: string | null
  subtitle: string | null
  slogans: string[]
  author: string | null
  institution: string | null
  supervision: string | null
  location: string | null
  strategies: string[]
  processSteps: string[]
}

export interface DrawingStructured {
  schemaVersion: number
  registry: string
  segment: StructuredSegment
  document: StructuredDocument
}

type Raw = Record<string, unknown>

const asRecord = (value: unknown): Raw =>
  typeof value === 'object' && value !== null ? (value as Raw) : {}

const asText = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

const asTerm = (value: unknown): string | null => (typeof value === 'string' ? asText(value) : null)

const asTextList = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(asText).filter((entry): entry is string => entry !== null) : []

const asRecordList = (value: unknown): Raw[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is Raw => typeof entry === 'object' && entry !== null)
    : []

export function humanizeTerm(key: string): string {
  const spaced = key.replace(/_/g, ' ').trim()
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : key
}

function groupEntities(value: unknown): StructuredEntityGroup[] {
  const groups = new Map<string, StructuredEntity[]>()
  for (const raw of asRecordList(value)) {
    const name = asText(raw.name)
    if (!name) continue
    const category = asTerm(raw.category) ?? 'other'
    const entity: StructuredEntity = {
      name,
      category,
      role: asText(raw.role),
      measure: asText(raw.measure),
    }
    const existing = groups.get(category)
    if (existing) existing.push(entity)
    else groups.set(category, [entity])
  }
  return [...groups.entries()].map(([category, entities]) => ({ category, entities }))
}

function normalizeSegment(raw: Raw): StructuredSegment {
  return {
    domain: asTerm(raw.domain) ?? 'general',
    segmentType: asTerm(raw.segment_type) ?? 'other',
    title: asText(raw.title),
    scale: asText(raw.scale),
    summary: asText(raw.summary) ?? '',
    entityGroups: groupEntities(raw.entities),
    compositions: asRecordList(raw.compositions)
      .map((composition) => ({
        component: asText(composition.component) ?? '',
        layers: asRecordList(composition.layers)
          .map((layer) => ({
            material: asText(layer.material) ?? '',
            thickness: asText(layer.thickness),
            purpose: asText(layer.function),
          }))
          .filter((layer) => layer.material !== ''),
      }))
      .filter((composition) => composition.component !== '' || composition.layers.length > 0),
    states: asRecordList(raw.states)
      .map((entry) => ({
        element: asText(entry.element) ?? '',
        state: asTerm(entry.state) ?? '',
      }))
      .filter((entry) => entry.element !== '' && entry.state !== ''),
    quantities: asRecordList(raw.quantities)
      .map((quantity) => ({
        object: asText(quantity.object) ?? '',
        property: asText(quantity.property) ?? '',
        value: asText(quantity.value) ?? '',
        unit: asText(quantity.unit),
        source: asTerm(quantity.source),
        confidence: asTerm(quantity.confidence),
      }))
      .filter((quantity) => quantity.object !== '' && quantity.value !== ''),
    relations: asRecordList(raw.relations)
      .map((relation) => ({
        subject: asText(relation.subject) ?? '',
        relation: asText(relation.relation) ?? '',
        object: asText(relation.object) ?? '',
      }))
      .filter((entry) => entry.subject !== '' && entry.relation !== '' && entry.object !== ''),
    annotations: asTextList(raw.annotations),
    source: asTerm(raw.source),
    confidence: asTerm(raw.confidence),
  }
}

function normalizeDocument(raw: Raw): StructuredDocument {
  return {
    title: asText(raw.title),
    subtitle: asText(raw.subtitle),
    slogans: asTextList(raw.slogans),
    author: asText(raw.author),
    institution: asText(raw.institution),
    supervision: asText(raw.supervision),
    location: asText(raw.location),
    strategies: asTextList(raw.strategies),
    processSteps: asTextList(raw.process_steps),
  }
}

export function normalizeDrawingStructured(value: unknown): DrawingStructured | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Raw
  const segmentRaw = asRecord(raw.segment)
  if (Object.keys(segmentRaw).length === 0) return null

  return {
    schemaVersion: typeof raw.schema_version === 'number' ? raw.schema_version : 0,
    registry: asText(raw.registry) ?? '',
    segment: normalizeSegment(segmentRaw),
    document: normalizeDocument(asRecord(raw.document)),
  }
}

export function hasStructuredDetail(structured: DrawingStructured | null): boolean {
  if (!structured) return false
  const { segment, document } = structured
  return (
    segment.entityGroups.length > 0 ||
    segment.compositions.length > 0 ||
    segment.states.length > 0 ||
    segment.quantities.length > 0 ||
    segment.relations.length > 0 ||
    segment.annotations.length > 0 ||
    segment.source !== null ||
    segment.confidence !== null ||
    document.title !== null ||
    document.author !== null ||
    document.institution !== null ||
    document.supervision !== null ||
    document.location !== null ||
    document.strategies.length > 0 ||
    document.processSteps.length > 0 ||
    document.slogans.length > 0
  )
}
