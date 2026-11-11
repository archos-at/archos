/**
 * Fixtures for `/dev/calibration-proposal`: the agent proposes a calibration
 * (`drawing-calibration-set`, ADR-0183) on the A1 Grundriss (`a1-sheet.ts`,
 * served by the page's fetch shim as the document's `/file`).
 *
 * The sheet is 2384 × 1684 pt with the origin bottom left; its axes start
 * at (200, 260) and one field is 153 pt, 5.40 m at 1:100. The reference span
 * runs along the lower outer wall from axis 1 to axis 3, two fields, 10.80 m.
 * The region is the two dwellings at the lower left, four fields by three.
 * On the wire every place is a share of the page with the origin TOP left.
 */

import type { ListedProposal, ProposedChangeView } from '@/lib/proposals/types'
import type { SetCalibrationRequest } from '@/lib/drawing-calibrations/wire'
import { A1_HEIGHT, A1_WIDTH } from './a1-sheet'
import { DEMO_PROPOSAL_BASE } from './fake-proposals'

/** The stored document the shim answers with the A1 sheet. */
export const CALIBRATION_SHEET_ID = '7d1e2f3a-4b5c-4d6e-8f70-1a2b3c4d5e6f'
/** A document this reader may not open: the shim answers 404, as the file route does. */
export const CALIBRATION_HIDDEN_ID = '8e2f3a4b-5c6d-4e7f-9a81-2b3c4d5e6f70'
const SHEET_NAME = 'WBN_Grundriss_1OG_Index_C.pdf'

const AXES_LEFT = 200
const AXES_BOTTOM = 260
const FIELD = 153
const x = (points: number): number => Number((points / A1_WIDTH).toFixed(4))
const y = (pointsFromBottom: number): number => Number(((A1_HEIGHT - pointsFromBottom) / A1_HEIGHT).toFixed(4))

const MARGIN = 30
const CALIBRATION: SetCalibrationRequest = {
  page: 1,
  region: {
    x: x(AXES_LEFT - MARGIN),
    y: y(AXES_BOTTOM + 3 * FIELD + MARGIN),
    w: x(4 * FIELD + 2 * MARGIN),
    h: Number(((3 * FIELD + 2 * MARGIN) / A1_HEIGHT).toFixed(4)),
  },
  from: { x: x(AXES_LEFT), y: y(AXES_BOTTOM) },
  to: { x: x(AXES_LEFT + 2 * FIELD), y: y(AXES_BOTTOM) },
  lengthM: 10.8,
}

const id = (n: number) => `00000000-0000-4000-8000-0000000003${String(n).padStart(2, '0')}`

export const CALIBRATION_DEMO = {
  /** Open, this reader may decide. */
  open: id(1),
  /** Open, this reader may only read. */
  readOnly: id(2),
  /** Applied by a colleague. */
  applied: id(3),
  /** Open, on a document this reader may not open. */
  hiddenDocument: id(4),
} as const

export const CALIBRATION_TITLE = 'Maßstab der Zeichnung setzen: 10,80 m zwischen Achse 1 und Achse 3'

const proposal = (
  proposalId: string,
  documentId: string,
  patch: Partial<ProposedChangeView> = {}
): ProposedChangeView =>
  ({
    ...DEMO_PROPOSAL_BASE,
    id: proposalId,
    kind: 'operation',
    payload: {
      operation: 'drawing-calibration-set',
      input: { params: { id: documentId }, body: CALIBRATION },
      summary: CALIBRATION_TITLE,
    },
    // The server names a document only for a reader who may read it.
    targets: [{ type: 'document', id: documentId, name: documentId === CALIBRATION_SHEET_ID ? SHEET_NAME : null }],
    ...patch,
  }) as ProposedChangeView

/** The proposals the page hands the faked proposals API (`fake-proposals.ts`). */
export const CALIBRATION_PROPOSALS: readonly ListedProposal[] = [
  proposal(CALIBRATION_DEMO.open, CALIBRATION_SHEET_ID),
  proposal(CALIBRATION_DEMO.readOnly, CALIBRATION_SHEET_ID, { canDecide: false }),
  proposal(CALIBRATION_DEMO.applied, CALIBRATION_SHEET_ID, {
    status: 'applied',
    results: [{ label: CALIBRATION_TITLE, ok: true }],
    decidedBy: 'user_anna',
    decidedByName: 'Anna Berger',
    decidedAt: '2026-11-10T14:02:00.000Z',
    canDecide: false,
  }),
  proposal(CALIBRATION_DEMO.hiddenDocument, CALIBRATION_HIDDEN_ID),
].map((entry) => ({ proposal: entry, documents: [] }))
