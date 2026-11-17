import type { BimElement, BimModelSummary } from './types'

export interface BimRoomRow {
  globalId: string
  name: string
  storeyName: string
  category: string | null
  netFloorArea: number | null
  grossFloorArea: number | null
  netVolume: number | null
  height: number | null
}

export interface BimStoreySchedule {
  storeyName: string
  elevation: number | null
  rooms: BimRoomRow[]
  netFloorArea: number | null
  grossFloorArea: number | null
  netVolume: number | null
  roomsWithoutArea: number
}

export interface BimRoomSchedule {
  storeys: BimStoreySchedule[]
  totals: {
    rooms: number
    roomsWithoutArea: number
    netFloorArea: number | null
    grossFloorArea: number | null
    netVolume: number | null
  }
  units: { area: string; volume: string; length: string }
}

const NET_AREA_KEYS = ['NetFloorArea', 'NetArea']
const GROSS_AREA_KEYS = ['GrossFloorArea', 'GrossArea']
const VOLUME_KEYS = ['NetVolume']
const HEIGHT_KEYS = ['FinishCeilingHeight', 'ClearHeight', 'Height']

function quantity(element: BimElement, keys: readonly string[]): number | null {
  for (const set of Object.values(element.quantities)) {
    for (const key of keys) {
      const value = set[key]
      if (typeof value === 'number' && Number.isFinite(value)) return value
    }
  }
  return null
}

function round(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100
}

function add(total: number | null, value: number | null): number | null {
  return value === null ? total : (total ?? 0) + value
}

export function buildRoomSchedule(
  summary: BimModelSummary,
  elements: readonly BimElement[]
): BimRoomSchedule {
  const spaces = elements.filter((element) => element.ifcType === 'IfcSpace')
  const byStorey = new Map<string, BimRoomRow[]>()
  const exact = new Map<string, { netFloorArea: number | null; grossFloorArea: number | null; netVolume: number | null }>()

  for (const space of spaces) {
    const storeyName = space.storeyName ?? '(ohne Geschoß)'
    const raw = {
      netFloorArea: quantity(space, NET_AREA_KEYS),
      grossFloorArea: quantity(space, GROSS_AREA_KEYS),
      netVolume: quantity(space, VOLUME_KEYS),
    }
    const row: BimRoomRow = {
      globalId: space.globalId,
      name: space.name ?? '(ohne Namen)',
      storeyName,
      category: space.predefinedType,
      netFloorArea: round(raw.netFloorArea),
      grossFloorArea: round(raw.grossFloorArea),
      netVolume: round(raw.netVolume),
      height: round(quantity(space, HEIGHT_KEYS)),
    }
    exact.set(space.globalId, raw)
    const bucket = byStorey.get(storeyName)
    if (bucket) bucket.push(row)
    else byStorey.set(storeyName, [row])
  }

  const ordered: BimStoreySchedule[] = []
  const seen = new Set<string>()
  const summarize = (name: string, elevation: number | null, rooms: BimRoomRow[]) =>
    summarizeStorey(name, elevation, rooms, exact)
  for (const storey of summary.storeys) {
    const name = storey.name ?? '(ohne Namen)'
    if (seen.has(name)) continue
    const rooms = byStorey.get(name)
    if (!rooms) continue
    seen.add(name)
    ordered.push(summarize(name, storey.elevation, rooms))
  }
  for (const [name, rooms] of byStorey) {
    if (seen.has(name)) continue
    ordered.push(summarize(name, null, rooms))
  }

  const totals = ordered.reduce(
    (acc, storey) => ({
      rooms: acc.rooms + storey.rooms.length,
      roomsWithoutArea: acc.roomsWithoutArea + storey.roomsWithoutArea,
      netFloorArea: add(acc.netFloorArea, storey.netFloorArea),
      grossFloorArea: add(acc.grossFloorArea, storey.grossFloorArea),
      netVolume: add(acc.netVolume, storey.netVolume),
    }),
    {
      rooms: 0,
      roomsWithoutArea: 0,
      netFloorArea: null as number | null,
      grossFloorArea: null as number | null,
      netVolume: null as number | null,
    }
  )

  return {
    storeys: ordered,
    totals: {
      ...totals,
      netFloorArea: round(totals.netFloorArea),
      grossFloorArea: round(totals.grossFloorArea),
      netVolume: round(totals.netVolume),
    },
    units: {
      area: summary.units.area?.symbol ?? '',
      volume: summary.units.volume?.symbol ?? '',
      length: summary.units.length?.symbol ?? '',
    },
  }
}

function summarizeStorey(
  storeyName: string,
  elevation: number | null,
  rooms: BimRoomRow[],
  exact: ReadonlyMap<
    string,
    { netFloorArea: number | null; grossFloorArea: number | null; netVolume: number | null }
  >
): BimStoreySchedule {
  const sorted = [...rooms].sort((a, b) => a.name.localeCompare(b.name))
  const total = (pick: (raw: {
    netFloorArea: number | null
    grossFloorArea: number | null
    netVolume: number | null
  }) => number | null): number | null =>
    round(
      sorted.reduce<number | null>((sum, room) => {
        const raw = exact.get(room.globalId)
        return add(sum, raw ? pick(raw) : null)
      }, null)
    )
  return {
    storeyName,
    elevation,
    rooms: sorted,
    netFloorArea: total((raw) => raw.netFloorArea),
    grossFloorArea: total((raw) => raw.grossFloorArea),
    netVolume: total((raw) => raw.netVolume),
    roomsWithoutArea: sorted.filter((room) => room.netFloorArea === null).length,
  }
}

export interface BimQuantityRow {
  group: string
  elements: number
  value: number | null
  missing: number
}

export const BIM_TAKEOFF_DIMENSION: Record<string, 'area' | 'volume' | 'length'> = {
  NetSideArea: 'area',
  GrossSideArea: 'area',
  NetVolume: 'volume',
  GrossVolume: 'volume',
  NetFloorArea: 'area',
  GrossFloorArea: 'area',
  Length: 'length',
  Width: 'length',
  Height: 'length',
}

export const BIM_TAKEOFF_QUANTITIES = [
  'NetSideArea',
  'GrossSideArea',
  'NetVolume',
  'GrossVolume',
  'NetFloorArea',
  'GrossFloorArea',
  'Length',
  'Width',
  'Height',
] as const

export function buildQuantityTakeoff(
  elements: readonly BimElement[],
  options: { quantity: string; byMaterial?: boolean }
): BimQuantityRow[] {
  const groups = new Map<string, { elements: number; value: number | null; missing: number }>()

  for (const element of elements) {
    const material = options.byMaterial ? (element.materials[0] ?? '(ohne Material)') : null
    const key = material ? `${element.ifcType} · ${material}` : element.ifcType
    const entry = groups.get(key) ?? { elements: 0, value: null, missing: 0 }
    entry.elements += 1
    const value = quantity(element, [options.quantity])
    if (value === null) entry.missing += 1
    else entry.value = (entry.value ?? 0) + value
    groups.set(key, entry)
  }

  return [...groups.entries()]
    .map(([group, entry]) => ({ group, ...entry, value: round(entry.value) }))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || a.group.localeCompare(b.group))
}

function withUnit(label: string, unit: string): string {
  return unit ? `${label} (${unit})` : label
}

export function roomScheduleToCsv(
  schedule: BimRoomSchedule,
  options: {
    storeyFilter?: string | null
    truncated?: boolean
  } = {}
): string {
  const header = [
    'Geschoß',
    'Raum',
    'Kategorie',
    withUnit('Netto-Grundfläche', schedule.units.area),
    withUnit('Brutto-Grundfläche', schedule.units.area),
    withUnit('Rauminhalt', schedule.units.volume),
    withUnit('Höhe', schedule.units.length),
    'GlobalId',
  ]
  const escape = (value: string | number | null): string => {
    if (value === null) return ''
    const raw = typeof value === 'number' ? String(value).replace('.', ',') : String(value)
    const text = typeof value === 'string' && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
    return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const lines = [header.join(';')]
  for (const storey of schedule.storeys) {
    for (const room of storey.rooms) {
      lines.push(
        [
          storey.storeyName,
          room.name,
          room.category,
          room.netFloorArea,
          room.grossFloorArea,
          room.netVolume,
          room.height,
          room.globalId,
        ]
          .map(escape)
          .join(';')
      )
    }
    lines.push(
      [
        `${storey.storeyName} — Summe`,
        '',
        '',
        storey.netFloorArea,
        storey.grossFloorArea,
        storey.netVolume,
        '',
        '',
      ]
        .map(escape)
        .join(';')
    )
  }
  const written = schedule.storeys.reduce(
    (acc, storey) => ({
      netFloorArea: add(acc.netFloorArea, storey.netFloorArea),
      grossFloorArea: add(acc.grossFloorArea, storey.grossFloorArea),
      netVolume: add(acc.netVolume, storey.netVolume),
      roomsWithoutArea: acc.roomsWithoutArea + storey.roomsWithoutArea,
    }),
    {
      netFloorArea: null as number | null,
      grossFloorArea: null as number | null,
      netVolume: null as number | null,
      roomsWithoutArea: 0,
    }
  )
  lines.push(
    [
      options.storeyFilter ? `Summe ${options.storeyFilter}` : 'Gesamt',
      '',
      '',
      round(written.netFloorArea),
      round(written.grossFloorArea),
      round(written.netVolume),
      '',
      '',
    ]
      .map(escape)
      .join(';')
  )

  if (options.truncated) {
    lines.push(
      escape(
        'Dieses Modell wurde nur teilweise eingelesen — die Summen oben sind keine Gebäudewerte.'
      ) + ';'.repeat(header.length - 1)
    )
  }
  if (written.roomsWithoutArea > 0) {
    lines.push(
      escape(
        `Räume ohne Flächenangabe: ${written.roomsWithoutArea} — in diesen Summen nicht enthalten.`
      ) + ';'.repeat(header.length - 1)
    )
  }

  return lines.join('\n')
}
