import { healthCaveat } from './validate'
import type { BimElement, BimModelSummary } from './types'

const MAX_TABLE_ROWS = 40

const MAX_PROPERTY_VALUES = 12

const NAMED_INSTANCE_TYPES = ['IfcSpace', 'IfcBuildingStorey']

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

function areaLabel(summary: BimModelSummary): string {
  return summary.units.area?.symbol ?? 'm²'
}

function volumeLabel(summary: BimModelSummary): string {
  return summary.units.volume?.symbol ?? 'm³'
}

function row(cells: Array<string | number>): string {
  const escaped = cells.map((cell) =>
    String(cell)
      .replace(/\\/g, '\\\\')
      .replace(/\|/g, '\\|')
      .replace(/\r?\n/g, ' ')
  )
  return `| ${escaped.join(' | ')} |`
}

function table(headers: string[], rows: Array<Array<string | number>>): string[] {
  if (rows.length === 0) return []
  const kept = rows.slice(0, MAX_TABLE_ROWS)
  const lines = [row(headers), `|${headers.map(() => '---').join('|')}|`, ...kept.map(row)]
  if (rows.length > kept.length) {
    lines.push(row([`… ${rows.length - kept.length} weitere`, ...headers.slice(1).map(() => '')]))
  }
  return lines
}

interface StoreyBreakdown {
  storeyName: string
  elementCount: number
  spaceCount: number
  netFloorArea: number | null
}

export function storeyBreakdownKey(storey: {
  globalId?: string | null
  name?: string | null
  expressId?: number
}): string {
  return storey.globalId ?? storey.name ?? String(storey.expressId ?? '')
}

export function buildStoreyBreakdown(
  summary: BimModelSummary,
  elements: readonly BimElement[]
): Map<string, StoreyBreakdown> {
  const byStorey = new Map<string, StoreyBreakdown>()
  for (const storey of summary.storeys) {
    byStorey.set(storeyBreakdownKey(storey), {
      storeyName: storey.name ?? '(ohne Namen)',
      elementCount: 0,
      spaceCount: 0,
      netFloorArea: null,
    })
  }
  for (const element of elements) {
    const key = element.storeyGlobalId ?? element.storeyName
    if (!key) continue
    const entry = byStorey.get(key)
    if (!entry) continue
    entry.elementCount += 1
    if (element.ifcType === 'IfcSpace') {
      entry.spaceCount += 1
      const area = firstQuantity(element, ['NetFloorArea', 'NetArea'])
      if (area !== null) entry.netFloorArea = (entry.netFloorArea ?? 0) + area
    }
  }
  return new Map(
    [...byStorey].map(([key, entry]) => [
      key,
      {
        ...entry,
        netFloorArea:
          entry.netFloorArea === null ? null : Math.round(entry.netFloorArea * 100) / 100,
      },
    ])
  )
}

function firstQuantity(element: BimElement, keys: readonly string[]): number | null {
  for (const set of Object.values(element.quantities)) {
    for (const key of keys) {
      const value = set[key]
      if (typeof value === 'number' && Number.isFinite(value)) return value
    }
  }
  return null
}

function propertyValueSummary(
  elements: readonly BimElement[]
): Map<string, Map<string, number>> {
  const byProperty = new Map<string, Map<string, number>>()
  for (const element of elements) {
    for (const [setName, properties] of Object.entries(element.properties)) {
      for (const [propertyName, value] of Object.entries(properties)) {
        if (value === null || value === '') continue
        const key = `${setName}.${propertyName}`
        const values = byProperty.get(key) ?? new Map<string, number>()
        const label = String(value)
        values.set(label, (values.get(label) ?? 0) + 1)
        byProperty.set(key, values)
      }
    }
  }
  return byProperty
}

export function buildModelDigest(
  summary: BimModelSummary,
  elements: readonly BimElement[],
  options: { filename: string }
): string {
  const lines: string[] = []
  const area = areaLabel(summary)
  const volume = volumeLabel(summary)

  lines.push(`# BIM-Modell: ${summary.projectName ?? options.filename}`)
  lines.push('')
  lines.push(
    `Dieses Dokument ist die automatisch erzeugte Zusammenfassung des IFC-Modells \`${options.filename}\`. ` +
      'Es beschreibt den Inhalt des Modells (Bauteile, Geschoße, Räume, Kennwerte) und dient als ' +
      'Grundlage für Fragen zum Gebäude.'
  )
  lines.push('')

  lines.push('## Modellangaben')
  lines.push('')
  const facts: Array<[string, string]> = [
    ['Projekt', summary.projectName ?? '—'],
    ['Grundstück / Standort', summary.siteName ?? '—'],
    ['Gebäude', summary.buildingNames.length ? summary.buildingNames.join(', ') : '—'],
    ['IFC-Schema', summary.schema ?? '—'],
    ['Erstellt mit', summary.header.originatingSystem ?? summary.header.preprocessorVersion ?? '—'],
    ['Exportdatum', summary.header.timeStamp ?? '—'],
    ['Verfasser', summary.header.author.join(', ') || '—'],
    ['Organisation', summary.header.organization.join(', ') || '—'],
    ['Längeneinheit', summary.units.length?.symbol ?? '—'],
    ['Bauteile gesamt', String(summary.totals.elements)],
    ['Räume gesamt', String(summary.totals.spaces)],
    ['Geschoße gesamt', String(summary.totals.storeys)],
  ]
  lines.push(...table(['Angabe', 'Wert'], facts.map(([key, value]) => [key, value])))
  lines.push('')

  const totals = summary.quantityTotals
  if (totals.netFloorAreaM2 !== null || totals.grossFloorAreaM2 !== null || totals.netVolumeM3 !== null) {
    lines.push('## Kennwerte')
    lines.push('')
    const rows: Array<Array<string | number>> = []
    if (totals.netFloorAreaM2 !== null)
      rows.push(['Netto-Grundfläche (Summe Räume)', `${formatNumber(totals.netFloorAreaM2)} ${area}`])
    if (totals.grossFloorAreaM2 !== null)
      rows.push(['Brutto-Grundfläche (Summe Räume)', `${formatNumber(totals.grossFloorAreaM2)} ${area}`])
    if (totals.netVolumeM3 !== null)
      rows.push(['Netto-Rauminhalt (Summe Räume)', `${formatNumber(totals.netVolumeM3)} ${volume}`])
    lines.push(...table(['Kennwert', 'Wert'], rows))
    lines.push('')
  }

  lines.push('## Geschoße')
  lines.push('')
  const breakdown = buildStoreyBreakdown(summary, elements)
  const renderedStoreys = new Set<string>()
  const storeyRows = summary.storeys.flatMap((storey) => {
    const key = storeyBreakdownKey(storey)
    if (renderedStoreys.has(key)) return []
    renderedStoreys.add(key)
    const entry = breakdown.get(key)
    return [
      [
        storey.name ?? '(ohne Namen)',
        storey.elevation === null ? '—' : `${formatNumber(storey.elevation)} m`,
        entry?.elementCount ?? 0,
        entry?.spaceCount ?? 0,
        entry?.netFloorArea === null || entry?.netFloorArea === undefined
          ? '—'
          : `${formatNumber(entry.netFloorArea)} ${area}`,
      ],
    ]
  })
  lines.push(...table(['Geschoß', 'Höhenlage', 'Bauteile', 'Räume', 'Netto-Grundfläche'], storeyRows))
  lines.push('')

  lines.push('## Bauteile nach Typ')
  lines.push('')
  lines.push(
    ...table(
      ['IFC-Typ', 'Anzahl'],
      Object.entries(summary.typeCounts).map(([type, count]) => [type, count])
    )
  )
  lines.push('')

  for (const type of NAMED_INSTANCE_TYPES) {
    const named = elements.filter((element) => element.ifcType === type && element.name)
    if (named.length === 0) continue
    lines.push(`## ${type === 'IfcSpace' ? 'Räume' : 'Geschoße (Bauteile)'}`)
    lines.push('')
    lines.push(
      ...table(
        ['Name', 'Geschoß', 'Netto-Grundfläche'],
        named.map((element) => {
          const netArea = firstQuantity(element, ['NetFloorArea', 'NetArea'])
          return [
            element.name ?? '—',
            element.storeyName ?? '—',
            netArea === null ? '—' : `${formatNumber(netArea)} ${area}`,
          ]
        })
      )
    )
    lines.push('')
  }

  if (summary.materialNames.length > 0) {
    lines.push('## Materialien')
    lines.push('')
    lines.push(summary.materialNames.join(', '))
    lines.push('')
  }

  const propertyValues = propertyValueSummary(elements)
  if (propertyValues.size > 0) {
    lines.push('## Eigenschaften im Modell')
    lines.push('')
    lines.push(
      'Vorhandene Merkmale (Property Sets) mit den im Modell tatsächlich belegten Werten:'
    )
    lines.push('')
    const propertyRows = [...propertyValues.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, values]) => {
        const rendered = [...values.entries()]
          .sort(([, aCount], [, bCount]) => bCount - aCount)
          .slice(0, MAX_PROPERTY_VALUES)
          .map(([value, count]) => `${value} (${count}×)`)
          .join('; ')
        return [key, rendered]
      })
    lines.push(...table(['Merkmal', 'Werte'], propertyRows))
    lines.push('')
  }

  const caveat = summary.health ? healthCaveat(summary.health) : null
  if (caveat) {
    lines.push('## Modellqualität')
    lines.push('')
    lines.push(caveat)
    lines.push('')
  }
  if (summary.health && summary.health.issues.length > 0) {
    lines.push(
      ...table(
        ['Prüfung', 'Schwere', 'Betroffen'],
        summary.health.issues.map((issue) => [
          issue.detail ? `${issue.rule} (${issue.detail})` : issue.rule,
          issue.severity,
          issue.total === null ? String(issue.count) : `${issue.count} / ${issue.total}`,
        ])
      )
    )
    lines.push('')
  }

  if (summary.truncatedAt !== null) {
    lines.push(
      `> Hinweis: Das Modell enthält mehr als ${summary.truncatedAt} Bauteile. ` +
        'Die Kennwerte und Flächensummen oben sind vollständig; die Geschoß- und ' +
        'Bauteiltabellen darunter beziehen sich nur auf die gespeicherten Bauteile.'
    )
    lines.push('')
  }

  return lines.join('\n')
}
