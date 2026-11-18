import type { TimedStep, WireStepInput } from './work-list-scene-steps'
import { call } from './work-list-scene-steps'
import { DOCUMENT_ID } from './work-list-scene-documents'

const round1 = (): TimedStep[] => [
  ...call('action:1', 0, 1800, {
    round: 1,
    verb: 'search',
    mode: 'exact',
    shelf: 'project',
    query: 'Brandabschnitt',
    status: 'ok',
    counts: { hits: 14, documents: 3, searched: 212 },
  }),
  ...call('action:2', 100, 600, {
    round: 1,
    verb: 'list',
    target: '03 Einreichung/Pläne',
    status: 'ok',
    counts: { files: 12, folders: 2 },
  }),
  ...call('action:3', 150, 2250, {
    round: 1,
    verb: 'search',
    mode: 'meaning',
    shelf: 'base',
    query: 'Brandabschnitte Fläche',
    status: 'ok',
    counts: { hits: 6, documents: 2 },
  }),
]

const round2 = (at: number, running = false): TimedStep[] => [
  ...(running
    ? [
        {
          at,
          type: 'STEP_STARTED' as const,
          step: {
            id: 'action:4',
            call_id: 'action:4',
            kind: 'action',
            status: 'running',
            round: 2,
            verb: 'read',
            target: 'Einreichplan EG.pdf',
            document_id: DOCUMENT_ID,
            pages: '2-3',
          },
        },
        {
          at: at + 120,
          type: 'STEP_STARTED' as const,
          step: {
            id: 'action:5',
            call_id: 'action:5',
            kind: 'action',
            status: 'running',
            round: 2,
            verb: 'look',
            target: 'Einreichplan EG.pdf',
            document_id: DOCUMENT_ID,
            pages: '2',
          },
        },
      ]
    : [
        ...call('action:4', at, 900, {
          round: 2,
          verb: 'read',
          target: 'Einreichplan EG.pdf',
          document_id: DOCUMENT_ID,
          pages: '2-3',
          status: 'ok',
        }),
        ...call('action:5', at + 120, 1500, {
          round: 2,
          verb: 'look',
          target: 'Einreichplan EG.pdf',
          document_id: DOCUMENT_ID,
          pages: '2',
          status: 'ok',
        }),
      ]),
]

export const NORTH_STAR_LOOK: WireStepInput = {
  id: 'look:1',
  kind: 'look',
  round: 2,
  document_name: 'Einreichplan EG.pdf',
  document_id: DOCUMENT_ID,
  page: 2,
  region: [0.62, 0.04, 0.34, 0.22],
  where: 'oben rechts',
}

export const northStarScene = (): TimedStep[] =>
  [
    ...round1(),
    ...round2(2600),
    { at: 4220, type: 'STEP_FINISHED' as const, step: NORTH_STAR_LOOK },
  ].sort((a, b) => a.at - b.at)

export const northStarLiveScene = (): TimedStep[] =>
  [...round1(), ...round2(2600, true)].sort((a, b) => a.at - b.at)
