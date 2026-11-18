import type { TimedStep, WireStepInput } from './work-list-scene-steps'
import { call, retrievalOf, sourcesOf } from './work-list-scene-steps'
import {
  CONCEPT,
  DESCRIPTION,
  OIB_2,
  OIB_2_NOTES,
  PLAN,
  PLAN_ID,
} from './work-list-scene-documents'

const prefetchRound = (): TimedStep[] => [
  retrievalOf(0, 0, undefined, true),
  ...call('call:p0', 10, 400, {
    round: 0,
    verb: 'search',
    mode: 'meaning',
    shelf: 'base',
    query: 'Brandabschnitte Einreichplan OIB-RL 2',
    status: 'ok',
    counts: { hits: 3, documents: 1 },
  }),
  sourcesOf(410, 'call:p0', 0, [{ name: OIB_2, detail: 'Pkt. 3.1.1', kind: 'building_law' }]),
]

const stepOne = (): TimedStep[] => [
  retrievalOf(
    500,
    1,
    'Zuerst die Brandabschnitte in den Projektunterlagen finden, dann die Grenzwerte der OIB-RL 2.'
  ),
  ...call('call:c1', 600, 1800, {
    round: 1,
    verb: 'search',
    mode: 'exact',
    shelf: 'project',
    query: 'Brandabschnitt',
    status: 'ok',
    counts: { hits: 14, documents: 3, searched: 41 },
  }),
  sourcesOf(2400, 'call:c1', 1, [
    { name: CONCEPT, detail: 'S. 7', kind: 'project' },
    { name: DESCRIPTION, detail: 'S. 3', kind: 'project' },
    { name: OIB_2_NOTES, detail: 'S. 12', kind: 'building_law' },
  ]),
  ...call('call:c2', 650, 500, {
    round: 1,
    verb: 'list',
    target: '03 Einreichung/Unterlagen',
    status: 'ok',
    counts: { files: 12, folders: 2 },
  }),
  ...call('call:c3', 700, 2600, {
    round: 1,
    verb: 'search',
    mode: 'meaning',
    shelf: 'base',
    target: 'OIB-RL 2, Ausgabe 2023',
    query: 'Brandabschnitt Tiefgarage',
    status: 'empty',
    counts: { hits: 0 },
  }),
]

const LOOK: WireStepInput = {
  id: 'look:plan',
  kind: 'look',
  round: 2,
  document_name: PLAN,
  document_id: PLAN_ID,
  page: 2,
  region: [0.55, 0.05, 0.4, 0.3],
  where: 'oben rechts',
  reading: 'BA 2: 1.420 m²',
}

const stepTwo = (lookRunning = false): TimedStep[] => [
  retrievalOf(3400, 2),
  ...call('call:c4', 3500, 900, {
    round: 2,
    verb: 'read',
    target: PLAN,
    document_id: PLAN_ID,
    pages: '2-3',
    status: 'ok',
    counts: { hits: 2 },
  }),
  sourcesOf(4400, 'call:c4', 2, [{ name: PLAN, detail: 'S. 2', kind: 'project' }]),
  ...(lookRunning
    ? [
        {
          at: 3600,
          type: 'STEP_STARTED' as const,
          step: {
            id: 'call:c5',
            call_id: 'call:c5',
            kind: 'action',
            status: 'running',
            round: 2,
            verb: 'look',
            target: PLAN,
            document_id: PLAN_ID,
            pages: '2',
          },
        },
      ]
    : [
        ...call('call:c5', 3600, 1500, {
          round: 2,
          verb: 'look',
          target: PLAN,
          document_id: PLAN_ID,
          pages: '2',
          status: 'ok',
        }),
        { at: 5100, type: 'STEP_FINISHED' as const, step: LOOK },
      ]),
]

export const mockupScene = (): TimedStep[] =>
  [...prefetchRound(), ...stepOne(), ...stepTwo()].sort((a, b) => a.at - b.at)

export const mockupLiveScene = (): TimedStep[] =>
  [...prefetchRound(), ...stepOne(), ...stepTwo(true)].sort((a, b) => a.at - b.at)

export const MOCKUP_QUESTION =
  'Welche Brandabschnitte sind im Einreichplan EG eingetragen, und passt das zur OIB-RL 2?'
