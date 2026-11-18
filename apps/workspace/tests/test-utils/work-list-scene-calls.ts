import type { TimedStep } from './work-list-scene-steps'
import { call, retrievalOf, sourcesOf } from './work-list-scene-steps'
import { CONCEPT, DESCRIPTION } from './work-list-scene-documents'

export const failedCallScene = (): TimedStep[] =>
  [
    retrievalOf(0, 1, 'Die Garagenvorschrift im RIS und die Stellplätze im Projekt nachsehen.'),
    ...call('call:f1', 100, 3000, {
      round: 1,
      verb: 'law',
      query: 'Wiener Garagengesetz 2008',
      status: 'error',
    }),
    ...call('call:f2', 120, 900, {
      round: 1,
      verb: 'search',
      mode: 'meaning',
      shelf: 'project',
      query: 'Stellplätze Tiefgarage',
      status: 'ok',
      counts: { hits: 4, documents: 2 },
    }),
    sourcesOf(1100, 'call:f2', 1, [
      { name: CONCEPT, detail: 'S. 9', kind: 'project' },
      { name: DESCRIPTION, detail: 'S. 4', kind: 'project' },
    ]),
  ].sort((a, b) => a.at - b.at)

export const singleReadScene = (): TimedStep[] => [
  retrievalOf(0, 1),
  ...call('call:s1', 100, 700, {
    round: 1,
    verb: 'read',
    target: CONCEPT,
    pages: '7',
    status: 'ok',
    counts: { hits: 1 },
  }),
  sourcesOf(800, 'call:s1', 1, [{ name: CONCEPT, detail: 'S. 7', kind: 'project' }]),
]

export const manyCallsScene = (): TimedStep[] => {
  const reads = Array.from({ length: 7 }, (_, i) =>
    call(`call:r${i}`, 200 + i * 10, 600, {
      round: 1,
      verb: 'read',
      target: `Plan ${i + 1}.pdf`,
      pages: String(i + 1),
      status: 'ok',
      counts: { hits: i % 3 === 0 ? 3 : 2 },
    })
  ).flat()
  return [
    retrievalOf(0, 1),
    ...reads,
    ...call('call:m1', 100, 1200, {
      round: 1,
      verb: 'search',
      mode: 'meaning',
      shelf: 'base',
      target: 'OIB-RL 4, Ausgabe 2023',
      query: 'Fluchtweglänge Garage',
      status: 'empty',
      counts: { hits: 0 },
    }),
    ...call('call:m2', 110, 900, {
      round: 1,
      verb: 'search',
      mode: 'exact',
      shelf: 'project',
      query: 'EI 90',
      status: 'ok',
      counts: { hits: 5, documents: 2 },
    }),
    ...call('call:m3', 120, 400, {
      round: 1,
      verb: 'list',
      target: '04 Ausführung/Brandschutz',
      status: 'ok',
      counts: { files: 9, folders: 1 },
    }),
    ...call('call:m4', 130, 2200, {
      round: 1,
      verb: 'web',
      query: 'ÖNORM B 3806 Brandabschnitt',
      status: 'ok',
      counts: { hits: 6 },
    }),
    ...call('call:m5', 140, 1500, {
      round: 1,
      verb: 'lookup',
      query: 'Tiefgarage Brandabschnitt Referenzprojekt',
      status: 'ok',
      counts: { hits: 2, documents: 1 },
    }),
    ...call('call:m6', 150, 1700, {
      round: 1,
      verb: 'model',
      query: 'Fläche je Brandabschnitt',
      status: 'ok',
    }),
  ].sort((a, b) => a.at - b.at)
}
