import {
  IfcParser,
  extractAllEntityAttributes,
  extractClassificationsOnDemand,
  extractMaterialsOnDemand,
  extractProjectUnits,
  extractPropertiesOnDemand,
  extractQuantitiesOnDemand,
  extractRootAttributesFromEntity,
  extractTypePropertiesOnDemand,
  extractTypeQuantitiesOnDemand,
  getInheritanceChainAcrossSchemas,
  mergeInheritedPropertySets,
  normalizeIfcTypeName,
  unwrapIfcZip,
  type IfcDataStore,
  type MaterialInfo,
} from '@ifc-lite/parser'
import type { SpatialNode } from '@ifc-lite/data'
import { validateModel } from './validate'
import type {
  BimClassification,
  BimContainerKind,
  BimElement,
  BimHeader,
  BimModelIndex,
  BimPropertySets,
  BimPropertyValue,
  BimQuantitySets,
  BimSpatialNode,
  BimStorey,
  BimUnit,
} from './types'

export const DEFAULT_ELEMENT_LIMIT = 200_000

const SPATIAL_ELEMENT_TYPES = new Set(['IfcSpace', 'IfcSpatialZone'])

const EXCLUDED_SUPERTYPE = 'IfcFeatureElement'

const CONTAINER_KIND_BY_TYPE: Record<string, BimContainerKind> = {
  IfcProject: 'project',
  IfcSite: 'site',
  IfcBuilding: 'building',
  IfcBuildingStorey: 'storey',
  IfcSpace: 'space',
  IfcSpatialZone: 'space',
}

const SPATIAL_NODE_TYPE_NAMES: Record<number, string> = {
  1: 'IfcProject',
  2: 'IfcSite',
  3: 'IfcBuilding',
  4: 'IfcBuildingStorey',
  5: 'IfcSpace',
  6: 'IfcSpatialZone',
}

export interface ExtractIfcOptions {
  elementLimit?: number
  onProgress?: (progress: { phase: string; percent: number }) => void
}

export class IfcExtractionError extends Error {
  readonly code: 'not-ifc' | 'parse-failed'

  constructor(code: 'not-ifc' | 'parse-failed', message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'IfcExtractionError'
    this.code = code
  }
}

const STEP_MAGIC = 'ISO-10303-21'

export function looksLikeStepIfc(buffer: ArrayBuffer): boolean {
  const head = new Uint8Array(buffer, 0, Math.min(64, buffer.byteLength))
  const text = new TextDecoder('utf-8').decode(head)
  return text.trimStart().startsWith(STEP_MAGIC)
}

function toStorableValue(value: unknown, values: readonly string[] | undefined): BimPropertyValue {
  if (values && values.length > 0) return values.join(', ')
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  return String(value)
}

function toPropertySets(
  sets: ReadonlyArray<{
    name: string
    properties: ReadonlyArray<{ name: string; value: unknown; values?: string[] }>
  }>
): BimPropertySets {
  const out: BimPropertySets = {}
  for (const set of sets) {
    if (!set.name) continue
    const bucket = (out[set.name] ??= {})
    for (const property of set.properties) {
      if (!property.name) continue
      bucket[property.name] = toStorableValue(property.value, property.values)
    }
  }
  return out
}

const ZERO_MEANS_ABSENT =
  /^[A-Za-z]*(FloorArea|SideArea|Area|Volume|Height|Width|Length|Perimeter|Depth|Thickness|Diameter|Radius)$/

function toQuantitySets(
  sets: ReadonlyArray<{ name: string; quantities: ReadonlyArray<{ name: string; value: number }> }>
): BimQuantitySets {
  const out: BimQuantitySets = {}
  for (const set of sets) {
    if (!set.name) continue
    const bucket = (out[set.name] ??= {})
    for (const quantity of set.quantities) {
      if (!quantity.name || !Number.isFinite(quantity.value)) continue
      if (quantity.value === 0 && ZERO_MEANS_ABSENT.test(quantity.name)) continue
      bucket[quantity.name] = quantity.value
    }
  }
  return out
}

function toMaterialNames(info: MaterialInfo | null): string[] {
  if (!info) return []
  const names: string[] = []
  const push = (name: string | undefined) => {
    if (name && !names.includes(name)) names.push(name)
  }
  for (const layer of info.layers ?? []) push(layer.materialName)
  for (const profile of info.profiles ?? []) push(profile.materialName)
  for (const constituent of info.constituents ?? []) push(constituent.materialName)
  for (const material of info.materials ?? []) push(material.name)
  if (names.length === 0) push(info.name)
  return names
}

function toClassifications(
  infos: ReadonlyArray<{ system?: string; identification?: string; name?: string }>
): BimClassification[] {
  return infos.map((info) => ({
    system: info.system ?? null,
    identification: info.identification ?? null,
    name: info.name ?? null,
  }))
}

function blankToNull(value: string | undefined | null): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed === '' ? null : trimmed
}

interface ContainerInfo {
  kind: BimContainerKind
  globalId: string | null
  name: string | null
  storeyGlobalId: string | null
  storeyName: string | null
}

function walkSpatial(
  store: IfcDataStore,
  root: SpatialNode | null | undefined
): { tree: BimSpatialNode | null; storeys: BimStorey[]; containers: Map<number, ContainerInfo> } {
  const storeys: BimStorey[] = []
  const containers = new Map<number, ContainerInfo>()
  if (!root) return { tree: null, storeys, containers }

  const visit = (
    node: SpatialNode,
    inheritedStorey: { globalId: string | null; name: string | null } | null
  ): BimSpatialNode => {
    const ifcType = SPATIAL_NODE_TYPE_NAMES[node.type] ?? 'IfcSpatialElement'
    const entity = store.getEntity(node.expressId)
    const attrs = entity ? extractRootAttributesFromEntity(entity) : null
    const globalId = blankToNull(attrs?.globalId)
    const name = blankToNull(node.name) ?? blankToNull(attrs?.name)
    const kind = CONTAINER_KIND_BY_TYPE[ifcType] ?? null

    const storey =
      ifcType === 'IfcBuildingStorey' ? { globalId, name } : inheritedStorey

    const elements = node.elements ?? []
    if (kind) {
      for (const elementId of elements) {
        containers.set(elementId, {
          kind,
          globalId,
          name,
          storeyGlobalId: storey?.globalId ?? null,
          storeyName: storey?.name ?? null,
        })
      }
    }

    if (ifcType === 'IfcBuildingStorey') {
      storeys.push({
        globalId,
        expressId: node.expressId,
        name,
        elevation: typeof node.elevation === 'number' ? node.elevation : null,
        elementCount: elements.length,
      })
    }

    const children = (node.children ?? []).map((child) => visit(child, storey))

    if (SPATIAL_ELEMENT_TYPES.has(ifcType) && inheritedStorey) {
      containers.set(node.expressId, {
        kind: 'storey',
        globalId: inheritedStorey.globalId,
        name: inheritedStorey.name,
        storeyGlobalId: inheritedStorey.globalId,
        storeyName: inheritedStorey.name,
      })
    }

    return {
      globalId,
      expressId: node.expressId,
      ifcType,
      name,
      elevation: typeof node.elevation === 'number' ? node.elevation : null,
      elementCount: elements.length,
      children,
    }
  }

  return { tree: visit(root, null), storeys, containers }
}

function selectElementTypes(store: IfcDataStore): string[] {
  const selected: string[] = []
  for (const rawType of store.entityIndex.byType.keys()) {
    const canonical = normalizeIfcTypeName(rawType)
    const chain = getInheritanceChainAcrossSchemas(rawType)
    if (chain.includes(EXCLUDED_SUPERTYPE)) continue
    if (chain.includes('IfcElement') || SPATIAL_ELEMENT_TYPES.has(canonical)) selected.push(rawType)
  }
  return selected.sort()
}

function toUnit(resolved: { symbol: string; siScale: number } | undefined): BimUnit | null {
  return resolved ? { symbol: resolved.symbol, siScale: resolved.siScale } : null
}

function toHeader(header: IfcDataStore['sourceHeader']): BimHeader {
  return {
    name: blankToNull(header?.name),
    timeStamp: blankToNull(header?.timeStamp),
    author: (header?.author ?? []).filter((value): value is string => Boolean(value)),
    organization: (header?.organization ?? []).filter((value): value is string => Boolean(value)),
    preprocessorVersion: blankToNull(header?.preprocessorVersion),
    originatingSystem: blankToNull(header?.originatingSystem),
    description: (header?.description ?? []).filter((value): value is string => Boolean(value)),
  }
}

const NET_FLOOR_AREA_KEYS = ['NetFloorArea', 'NetArea']
const GROSS_FLOOR_AREA_KEYS = ['GrossFloorArea', 'GrossArea']
const NET_VOLUME_KEYS = ['NetVolume']

function roundMeasure(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10_000) / 10_000
}

function sumQuantity(element: BimElement, keys: readonly string[]): number | null {
  return sumQuantitySets(element.quantities, keys)
}

function mergedQuantitySets(
  store: Parameters<typeof extractQuantitiesOnDemand>[0],
  expressId: number
): ReturnType<typeof extractQuantitiesOnDemand> {
  const own = extractQuantitiesOnDemand(store, expressId)
  const inherited = extractTypeQuantitiesOnDemand(store, expressId)
  if (!inherited) return own
  return mergeInheritedPropertySets(
    own.map((set) => ({ name: set.name, properties: set.quantities })),
    inherited.quantities.map((set) => ({ name: set.name, properties: set.quantities }))
  ).map((set) => ({ name: set.name, quantities: set.properties }))
}

function sumQuantitySets(
  quantities: BimElement['quantities'],
  keys: readonly string[]
): number | null {
  for (const set of Object.values(quantities)) {
    for (const key of keys) {
      const value = set[key]
      if (typeof value === 'number' && Number.isFinite(value)) return value
    }
  }
  return null
}

export async function extractIfcModel(
  buffer: ArrayBuffer,
  filename: string,
  options: ExtractIfcOptions = {}
): Promise<BimModelIndex> {
  const limit = Math.max(1, Math.trunc(options.elementLimit ?? DEFAULT_ELEMENT_LIMIT))

  let source: ArrayBuffer
  try {
    source = await unwrapIfcZip(buffer)
  } catch (error) {
    throw new IfcExtractionError('not-ifc', 'The archive could not be opened', { cause: error })
  }
  if (!looksLikeStepIfc(source)) {
    throw new IfcExtractionError('not-ifc', 'File does not start with an ISO-10303-21 header')
  }

  const startedAt = Date.now()
  let store: IfcDataStore
  try {
    store = await new IfcParser().parseColumnar(source, { onProgress: options.onProgress })
  } catch (error) {
    throw new IfcExtractionError('parse-failed', 'IFC parsing failed', { cause: error })
  }
  const parseMs = Date.now() - startedAt

  const { tree, storeys, containers } = walkSpatial(store, store.spatialHierarchy?.project)
  const units = extractProjectUnits(store.source, store.entityIndex)

  const elements: BimElement[] = []
  const typeCounts: Record<string, number> = {}
  const propertySetNames = new Set<string>()
  const quantitySetNames = new Set<string>()
  const materialNames = new Set<string>()
  let elementTotal = 0
  let spaceTotal = 0
  let truncated = false
  let unreadable = 0

  let netFloorArea: number | null = null
  let grossFloorArea: number | null = null
  let netVolume: number | null = null
  const addTotal = (current: number | null, value: number | null): number | null =>
    value === null ? current : (current ?? 0) + value

  const elementTypes = selectElementTypes(store)
  for (const rawType of elementTypes) {
    const canonical = normalizeIfcTypeName(rawType)
    const expressIds = store.entityIndex.byType.get(rawType) ?? []
    typeCounts[canonical] = (typeCounts[canonical] ?? 0) + expressIds.length
    elementTotal += expressIds.length
    if (canonical === 'IfcSpace') spaceTotal += expressIds.length

    const feedsTotals = canonical === 'IfcSpace'

    for (const expressId of expressIds) {
      const capped = elements.length >= limit
      if (capped) {
        truncated = true
        if (!feedsTotals) continue
      }
      const entity = store.getEntity(expressId)
      if (!entity) {
        typeCounts[canonical] -= 1
        elementTotal -= 1
        if (canonical === 'IfcSpace') spaceTotal -= 1
        unreadable += 1
        continue
      }

      if (capped) {
        const quantities = toQuantitySets(mergedQuantitySets(store, expressId))
        netFloorArea = addTotal(netFloorArea, sumQuantitySets(quantities, NET_FLOOR_AREA_KEYS))
        grossFloorArea = addTotal(grossFloorArea, sumQuantitySets(quantities, GROSS_FLOOR_AREA_KEYS))
        netVolume = addTotal(netVolume, sumQuantitySets(quantities, NET_VOLUME_KEYS))
        continue
      }

      const root = extractRootAttributesFromEntity(entity)
      const named = extractAllEntityAttributes(store, expressId)
      const predefinedType = named.find((attribute) => attribute.name === 'PredefinedType')

      const ownSets = extractPropertiesOnDemand(store, expressId)
      const typeInfo = extractTypePropertiesOnDemand(store, expressId)
      const mergedSets = typeInfo ? mergeInheritedPropertySets(ownSets, typeInfo.properties) : ownSets

      const mergedQuantities = mergedQuantitySets(store, expressId)

      const materials = toMaterialNames(extractMaterialsOnDemand(store, expressId))
      const container = containers.get(expressId) ?? null

      const element: BimElement = {
        globalId: root.globalId || `express:${expressId}`,
        expressId,
        ifcType: canonical,
        name: blankToNull(root.name),
        description: blankToNull(root.description),
        predefinedType:
          typeof predefinedType?.value === 'string' ? blankToNull(predefinedType.value) : null,
        objectType: blankToNull(root.objectType),
        tag: blankToNull(root.tag),
        typeName: blankToNull(typeInfo?.typeName),
        containerKind: container?.kind ?? null,
        containerGlobalId: container?.globalId ?? null,
        containerName: container?.name ?? null,
        storeyGlobalId: container?.storeyGlobalId ?? null,
        storeyName: container?.storeyName ?? null,
        materials,
        classifications: toClassifications(extractClassificationsOnDemand(store, expressId)),
        properties: toPropertySets(mergedSets),
        quantities: toQuantitySets(mergedQuantities),
      }

      for (const name of Object.keys(element.properties)) propertySetNames.add(name)
      for (const name of Object.keys(element.quantities)) quantitySetNames.add(name)
      for (const name of materials) materialNames.add(name)

      if (canonical === 'IfcSpace') {
        netFloorArea = addTotal(netFloorArea, sumQuantity(element, NET_FLOOR_AREA_KEYS))
        grossFloorArea = addTotal(grossFloorArea, sumQuantity(element, GROSS_FLOOR_AREA_KEYS))
        netVolume = addTotal(netVolume, sumQuantity(element, NET_VOLUME_KEYS))
      }

      elements.push(element)
    }
  }

  const orderedTypeCounts = Object.fromEntries(
    Object.entries(typeCounts).sort(([aName, aCount], [bName, bCount]) =>
      bCount === aCount ? aName.localeCompare(bName) : bCount - aCount
    )
  )

  const buildingNames = collectNames(tree, 'IfcBuilding')

  const index: BimModelIndex = {
    schema: blankToNull(store.schemaVersion),
    header: toHeader(store.sourceHeader),
    units: {
      length: toUnit(units.resolvedForUnitType('LENGTHUNIT')),
      area: toUnit(units.resolvedForUnitType('AREAUNIT')),
      volume: toUnit(units.resolvedForUnitType('VOLUMEUNIT')),
    },
    projectName: tree?.ifcType === 'IfcProject' ? tree.name : null,
    siteName: collectNames(tree, 'IfcSite')[0] ?? null,
    buildingNames,
    storeys: storeys.sort(sortStoreys),
    spatial: tree,
    typeCounts: orderedTypeCounts,
    propertySetNames: [...propertySetNames].sort(),
    quantitySetNames: [...quantitySetNames].sort(),
    materialNames: [...materialNames].sort(),
    totals: {
      entities: store.entityCount ?? 0,
      elements: elementTotal,
      spaces: spaceTotal,
      storeys: storeys.length,
    },
    quantityTotals: {
      netFloorAreaM2: roundMeasure(netFloorArea),
      grossFloorAreaM2: roundMeasure(grossFloorArea),
      netVolumeM3: roundMeasure(netVolume),
    },
    health: null,
    unreadableEntities: unreadable,
    parseMs,
    fileSizeBytes: buffer.byteLength,
    truncatedAt: truncated ? limit : null,
    elements,
  }

  index.health = validateModel(index)
  return index
}

function collectNames(node: BimSpatialNode | null, ifcType: string): string[] {
  if (!node) return []
  const found: string[] = []
  const visit = (current: BimSpatialNode) => {
    if (current.ifcType === ifcType && current.name) found.push(current.name)
    for (const child of current.children) visit(child)
  }
  visit(node)
  return found
}

function sortStoreys(a: BimStorey, b: BimStorey): number {
  if (a.elevation === null && b.elevation === null) return (a.name ?? '').localeCompare(b.name ?? '')
  if (a.elevation === null) return 1
  if (b.elevation === null) return -1
  return a.elevation - b.elevation
}
