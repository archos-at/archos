import type { SettleProposalsBody } from '@/lib/base-knowledge/wire'
import { placeProjectNorms, type NormsFetch } from '@/lib/office-shelf/project-norms/client'
import type { NormDestination, PlaceProjectNormsBody, PlaceProjectNormsResponse } from '@/lib/office-shelf/project-norms/wire'

export type NormDialogRow = SettleProposalsBody['rows'][number]
type PlacedDocument = PlaceProjectNormsBody['documents'][number]

export interface NormPlacing {
  destination: NormDestination
  norms: number
  notNorm: number
  refused: string | null
  noDecider: PlaceProjectNormsResponse['noDecider']
}

export class EditionMissingError extends Error {
  constructor() {
    super('A norm goes into the office shelf confirmed, so it needs its edition.')
    this.name = 'EditionMissingError'
  }
}

function placedDocument(row: NormDialogRow, withValues: boolean): PlacedDocument {
  if (!withValues) return { documentId: row.entryId }
  const editionLabel = row.editionLabel?.trim()
  return {
    documentId: row.entryId,
    values: {
      ...(row.kind ? { kind: row.kind } : {}),
      ...(row.designation !== undefined ? { designation: row.designation } : {}),
      ...(editionLabel ? { editionLabel } : {}),
    },
  }
}

export async function placeNormRows(
  projectId: string,
  destination: NormDestination,
  rows: readonly NormDialogRow[],
  run?: NormsFetch
): Promise<NormPlacing> {
  const notNorm = rows.filter((row) => row.notNorm)
  const norms = rows.filter((row) => !row.notNorm)
  if (destination === 'office_shelf' && norms.some((row) => !row.editionLabel?.trim())) throw new EditionMissingError()
  const kept = destination === 'project' ? rows : notNorm
  const answers: PlaceProjectNormsResponse[] = []
  if (kept.length > 0) {
    answers.push(await placeProjectNorms(projectId, { destination: 'project', documents: kept.map((row) => placedDocument(row, false)) }, run))
  }
  if (destination !== 'project' && norms.length > 0) {
    answers.push(
      await placeProjectNorms(
        projectId,
        {
          destination,
          documents: norms.map((row) => placedDocument(row, true)),
          visibility: 'office',
          ...(destination === 'office_shelf' ? { confirm: true } : {}),
        },
        run
      )
    )
  }
  const placements = answers.flatMap((answer) => answer.placements)
  return {
    destination,
    norms: destination === 'project' ? 0 : norms.length,
    notNorm: notNorm.length,
    refused: placements.find((placement) => placement.reason)?.reason ?? null,
    noDecider: answers.find((answer) => answer.noDecider)?.noDecider ?? null,
  }
}
