import 'server-only'
import { renderComparison } from './compare'
import { renderProfileSuggestions } from './profile'
import { renderBimComplianceDiff, renderBimRules } from './rules'
import type { BimQuery } from './query-schema'
import type { BimQueryResult } from './query-result'
import type { BimUnits } from './types'

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100)
}

function quantityUnit(
  request: BimQuery,
  units: BimUnits | undefined
): string {
  if (request.op !== 'aggregate' || request.metric === 'count' || !request.quantity) return ''
  if (!units) return ''
  const name = request.quantity.toLowerCase()
  const unit = name.includes('area')
    ? units.area
    : name.includes('volume')
      ? units.volume
      : /length|width|height|perimeter|depth|thickness/.test(name)
        ? units.length
        : null
  return unit?.symbol ? ` ${unit.symbol}` : ''
}

export function renderSummary(request: BimQuery, result: Omit<BimQueryResult, 'summary'>): string {
  switch (request.op) {
    case 'overview': {
      const overview = result.overview
      if (!overview) return 'Keine Modellzusammenfassung vorhanden.'
      const parts = [
        `Modell „${overview.projectName ?? result.model.filename}“ (${overview.schema ?? 'IFC'})`,
        `${overview.totals.elements} Bauteile`,
        `${overview.totals.storeys} Geschoße`,
        `${overview.totals.spaces} Räume`,
      ]
      if (overview.quantityTotals.netFloorAreaM2 !== null) {
        parts.push(
          `Netto-Grundfläche ${formatNumber(overview.quantityTotals.netFloorAreaM2)} ${overview.units.area?.symbol ?? 'm²'}`
        )
      }
      return `${parts.join(', ')}.`
    }
    case 'health': {
      const health = result.health
      if (!health) return 'Für dieses Modell liegt keine Prüfung vor.'
      if (health.issues.length === 0) return 'Modellprüfung: keine Auffälligkeiten.'
      const rendered = health.issues
        .map((issue) => {
          const scope = issue.total === null ? `${issue.count}` : `${issue.count}/${issue.total}`
          const detail = issue.detail ? ` ${issue.detail}` : ''
          return `${issue.rule}${detail} (${issue.severity}, ${scope})`
        })
        .join('; ')
      return `Modellprüfung ${health.score}/100 — ${rendered}.`
    }
    case 'schedule': {
      const schedule = result.schedule
      if (!schedule) return 'Für dieses Modell liegt kein Raumbuch vor.'
      const missing =
        schedule.totals.roomsWithoutArea > 0
          ? ` ${schedule.totals.roomsWithoutArea} Räume ohne Flächenangabe sind darin NICHT enthalten.`
          : ''
      return (
        `Raumbuch: ${schedule.totals.rooms} Räume in ${schedule.storeys.length} Geschoßen, ` +
        `Netto-Grundfläche ${schedule.totals.netFloorArea ?? '—'} ${schedule.units.area}.${missing}`
      )
    }
    case 'takeoff': {
      const rows = result.takeoff ?? []
      if (rows.length === 0) return 'Keine Bauteile für diese Massenermittlung.'
      return `Massenermittlung (${request.quantity}): ${rows
        .slice(0, 20)
        .map(
          (row) =>
            `${row.group}: ${row.value ?? '—'} (${row.elements} Bauteile${row.missing > 0 ? `, ${row.missing} ohne Wert` : ''})`
        )
        .join('; ')}.`
    }
    case 'compliance':
      return renderBimRules(result.compliance ?? [])
    case 'compliance-diff':
      return (
        `Statusänderungen gegenüber ${result.comparedWith ?? 'dem Vorstand'}:\n` +
        renderBimComplianceDiff(result.complianceChanges ?? [])
      )
    case 'profile':
      return renderProfileSuggestions(result.profileSuggestions ?? [])
    case 'compare':
      return result.comparison
        ? renderComparison(result.comparison)
        : 'Der Vergleich konnte nicht durchgeführt werden.'
    case 'types': {
      const types = result.types ?? []
      if (types.length === 0) return 'Das Modell enthält keine Bauteile.'
      return `Bauteiltypen: ${types.map((type) => `${type.ifcType} (${type.elements})`).join(', ')}.`
    }
    case 'elements': {
      const total = result.total ?? 0
      const shown = result.elements?.length ?? 0
      if (total === 0) return 'Kein Bauteil erfüllt die Abfrage.'
      const listed = shown < total ? `, davon ${shown} aufgelistet` : ''
      return result.totalIsLowerBound
        ? `Mindestens ${total} Bauteile erfüllen die Abfrage${listed}. Die Gesamtzahl wurde nicht zu Ende gezählt.`
        : total === 1
          ? `1 Bauteil erfüllt die Abfrage${listed}.`
          : `${total} Bauteile erfüllen die Abfrage${listed}.`
    }
    case 'element':
      return result.element
        ? `Bauteil ${result.element.ifcType} „${result.element.name ?? result.element.globalId}“.`
        : 'Kein Bauteil mit dieser GlobalId im Modell.'
    case 'properties': {
      const properties = result.properties ?? []
      if (properties.length === 0) return 'Das Modell enthält keine Property Sets.'
      const scan = result.propertyScan
      return scan && !scan.complete
        ? `${properties.length} Merkmale, ermittelt aus einer Stichprobe von ${scan.scanned} der ` +
            `${scan.total} Bauteile (je Bauteiltyp). Die Merkmals- und Wertnamen sind vollständig ` +
            `belastbar, die Anzahlen beziehen sich NUR auf die Stichprobe.`
        : `${properties.length} Merkmale im Modell.`
    }
    case 'aggregate': {
      const groups = result.groups ?? []
      if (groups.length === 0) return 'Kein Bauteil erfüllt die Abfrage.'
      const unit = quantityUnit(request, result.units)
      const over = (group: { elements: number; measured: number }): string =>
        group.measured === group.elements
          ? `${group.elements} Bauteile`
          : `${group.measured} von ${group.elements} Bauteilen ` +
            `(${group.elements - group.measured} ohne Wert)`

      if (!request.groupBy) {
        const only = groups[0]
        return request.metric === 'count'
          ? `${only.elements} Bauteil${only.elements === 1 ? '' : 'e'}.`
          : `${request.metric}(${request.quantity}) = ${only.metric === null ? '—' : formatNumber(only.metric)}${unit} über ${over(only)}.`
      }
      const rendered = groups
        .map((group) => {
          const label = group.key ?? '(ohne Angabe)'
          if (request.metric === 'count') return `${label}: ${group.elements}`
          const measured =
            group.measured === group.elements
              ? `${group.elements}`
              : `${group.measured}/${group.elements}`
          return `${label}: ${group.metric === null ? '—' : formatNumber(group.metric)}${unit} (${measured})`
        })
        .join(', ')
      return `${rendered}.`
    }
  }
}
