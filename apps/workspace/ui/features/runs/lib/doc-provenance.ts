import { asShelf, kindForLane, KIND_TO_SIGNAL, type SourceKind, type SourceTint } from '@/lib/source-kinds'
import type { RunLedgerDoc } from '@/lib/runs/run-ledger-types'

export interface DocProvenance {
  kind: SourceKind
  tint: SourceTint
  authority: string | null
}

const OIB_RE = /\bOIB\b/i
const ONORM_RE = /ÖNORM|\bONORM\b/i
const RIS_RE = /Bauordnung|\bBO\s|Gesetz|Verordnung|§/i

function laneForShelf(shelf: string | undefined): string | undefined {
  switch (asShelf(shelf)) {
    case 'base':
      return 'building_law'
    case 'office_shelf':
      return 'office'
    case 'project':
    case 'session':
      return 'project'
    default:
      return undefined
  }
}

export function docProvenance(doc: Pick<RunLedgerDoc, 'name' | 'title' | 'shelf'>): DocProvenance {
  const label = `${doc.title ?? ''} ${doc.name}`
  const isOib = OIB_RE.test(label)
  const isOnorm = ONORM_RE.test(label)
  const shelfLane = laneForShelf(doc.shelf)
  const kind: SourceKind = isOib || isOnorm ? 'building_law' : kindForLane(shelfLane)
  const authority =
    kind !== 'building_law'
      ? null
      : isOib
        ? 'OIB'
        : isOnorm
          ? 'ÖNORM'
          : RIS_RE.test(label)
            ? 'RIS'
            : null
  const tint: SourceTint = isOib ? 'oib' : KIND_TO_SIGNAL[kind]
  return { kind, tint, authority }
}
