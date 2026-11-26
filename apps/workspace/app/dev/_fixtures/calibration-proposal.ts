import { AGENT_KIND } from '@/lib/agent-kind'
import type { SetCalibrationRequest } from '@/lib/drawing-calibrations/wire'
import type { ListedProposal, ProposedChangeView } from '@/lib/proposals/types'
import { A1_HEIGHT, A1_WIDTH } from './a1-sheet'

export const CALIBRATION_SHEET_ID = '7d1e2f3a-4b5c-4d6e-8f70-1a2b3c4d5e6f'
export const CALIBRATION_HIDDEN_ID = '8e2f3a4b-5c6d-4e7f-9a81-2b3c4d5e6f70'
const SHEET_NAME = 'WBN_Grundriss_1OG_Index_C.pdf'

const AXES_LEFT = 200
const AXES_BOTTOM = 260
const FIELD = 153
const CHAIN = AXES_BOTTOM - 40
const x = (points: number): number => Number((points / A1_WIDTH).toFixed(4))
const y = (pointsFromBottom: number): number =>
  Number(((A1_HEIGHT - pointsFromBottom) / A1_HEIGHT).toFixed(4))

// The first field of the sheet's dimension chain, axis 1 to axis 2, printed „5,40“.
export const CALIBRATION_INPUT: { params: { id: string }; body: SetCalibrationRequest } = {
  params: { id: CALIBRATION_SHEET_ID },
  body: {
    page: 1,
    region: {
      x: x(AXES_LEFT - 120),
      y: y(AXES_BOTTOM + 3 * FIELD + 160),
      w: x(11 * FIELD + 240),
      h: Number(((3 * FIELD + 320) / A1_HEIGHT).toFixed(4)),
    },
    from: { x: x(AXES_LEFT), y: y(CHAIN) },
    to: { x: x(AXES_LEFT + FIELD), y: y(CHAIN) },
    lengthM: 5.4,
  },
}

const id = (n: number) => `00000000-0000-4000-8000-0000000003${String(n).padStart(2, '0')}`

export const CALIBRATION_DEMO = {
  pending: id(1),
  readOnly: id(2),
  confirmed: id(3),
  declined: id(4),
  refusedNoClip: id(5),
  refusedIncomplete: id(6),
} as const

const SUMMARY = 'Maßstab der Zeichnung setzen: 5,40 m zwischen Achse 1 und Achse 2'

const BASE = {
  projectId: 'proj-demo',
  status: 'proposed' as const,
  proposedByKind: AGENT_KIND,
  onBehalfOf: 'user_me',
  onBehalfOfName: 'Mia Huber',
  originConversationId: null,
  originMessageId: null,
  createdAt: '2026-11-24T08:00:00.000Z',
  decidedBy: null,
  decidedByName: null,
  decidedAt: null,
  results: null,
  canDecide: true,
}

const byAnna = (status: 'applied' | 'dismissed') => ({
  status,
  results: status === 'applied' ? [{ label: SUMMARY, ok: true }] : null,
  decidedBy: 'user_anna',
  decidedByName: 'Anna Berger',
  decidedAt: '2026-11-24T09:12:00.000Z',
  canDecide: false,
})

const proposal = (
  proposalId: string,
  input: Record<string, unknown>,
  patch: Partial<ProposedChangeView> = {}
): ProposedChangeView => {
  const documentId = (input.params as { id: string }).id
  return {
    ...BASE,
    id: proposalId,
    kind: 'operation',
    payload: { operation: 'drawing-calibration-set', input, summary: SUMMARY },
    targets: [
      {
        type: 'document',
        id: documentId,
        name: documentId === CALIBRATION_SHEET_ID ? SHEET_NAME : null,
      },
    ],
    ...patch,
  } as ProposedChangeView
}

const hidden = { ...CALIBRATION_INPUT, params: { id: CALIBRATION_HIDDEN_ID } }
const { lengthM: _unsaid, ...withoutLength } = CALIBRATION_INPUT.body

export const CALIBRATION_PROPOSALS: readonly ListedProposal[] = [
  proposal(CALIBRATION_DEMO.pending, CALIBRATION_INPUT),
  proposal(CALIBRATION_DEMO.readOnly, CALIBRATION_INPUT, { canDecide: false }),
  proposal(CALIBRATION_DEMO.confirmed, CALIBRATION_INPUT, byAnna('applied')),
  proposal(CALIBRATION_DEMO.declined, CALIBRATION_INPUT, byAnna('dismissed')),
  proposal(CALIBRATION_DEMO.refusedNoClip, hidden),
  proposal(CALIBRATION_DEMO.refusedIncomplete, { ...CALIBRATION_INPUT, body: withoutLength }),
].map((entry) => ({ proposal: entry, documents: [] }))
