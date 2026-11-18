import { AnswerCards } from '@/features/cards/components/AnswerCards'
import { DEMO, DEMO_PROJECT_ID } from '../_fixtures/fake-proposals'
import type { AnswerCard } from '@/shared/cards/schemas'
import { Section } from './gallery-section'

export function AnswerCardSections({ proposalsReady }: { proposalsReady: boolean }) {
  return (
    <>
      {/* A SYSTEM card, and the fourth INTERACTIVE one: the working directory's
          write_file/edit_file pushes it, so it reports a draft that exists
          rather than one the model described, and `file_draft` pushes it again
          once that draft has become a project document.

          Drawn UNFILED here, which is the state a reader meets first. „Ins
          Projekt übernehmen" writes nothing: it puts the request in the
          composer, because the draft's bytes live in the agent's working
          directory and the browser has neither them nor a route to file them
          (see the component's header). The FILED states — „Im Projekt öffnen"
          and „Zur Freigabe einreichen" — are judged on
          `/dev/document-draft-card`, which draws all three. */}
      <Section id="document_draft">
        <AnswerCards
          cards={[
            {
              type: 'document_draft',
              title: 'Aktenvermerk – Abweichung Fluchtweglänge',
              path: '/entwuerfe/aktenvermerk-fluchtweg.md',
              bytes: 4820,
              version: 3,
            },
          ] as AnswerCard[]}
          projectId={null}
        />
      </Section>

      {/* Delegation: work the agent took on, with the deadline the person named
          and a link to the thread the run writes into. Presentational on
          purpose — the row exists by the time the card renders, so there is
          nothing to accept (see `TaskCreatedCard`'s header). */}
      <Section id="task_created">
        <AnswerCards
          cards={[
            {
              type: 'task_created',
              task_id: '00000000-0000-4000-8000-0000000000f1',
              kind: 'submission_check',
              title: 'Einreichcheck: Bauansuchen Haus A',
              goal: 'Mach den Einreichcheck für das Bauansuchen bis Freitag',
              due_at: '2026-09-18T23:59:59.999Z',
              conversation_id: 's_00000000_0000_4000_8000_0000000000f2',
            },
          ] as AnswerCard[]}
          projectId={null}
        />
      </Section>

      {/* The three proposal cards go through the AnswerCards dispatcher rather
          than being rendered directly, so the gallery exercises the same
          wiring the chat uses. Each carries a `proposal_id` and is a receipt of
          a proposal the faked API holds: clickable here, and it moves the
          proposal as the server would. */}
      <Section id="project_profile_patch">
        {proposalsReady && (
          <AnswerCards
            cards={[
              {
                type: 'project_profile_patch',
                proposal_id: DEMO.profileOpen,
                title: 'Projektkontext aktualisieren: Wärmeversorgung und Fluchtniveau',
                rationale: 'Sie haben im Gespräch eine Wärmepumpe und ein oberstes Fluchtniveau von 25 m genannt.',
                patch: [
                  { op: 'add', path: '/facts/heat_supply', value: 'waermepumpe' },
                  { op: 'add', path: '/facts/escape_level_m', value: 25 },
                ],
              },
            ] as AnswerCard[]}
            projectId={DEMO_PROJECT_ID}
          />
        )}
      </Section>

      <Section id="memory_proposal">
        {proposalsReady && (
          <AnswerCards
            cards={[
              {
                type: 'memory_proposal',
                proposal_id: DEMO.memoryOpen,
                title: 'Neue Erkenntnis merken',
                content: 'Das Büro setzt bei GK 4 durchgängig REI 90 an, auch wo REI 60 genügen würde.',
                kind: 'preference',
                confidence: 'high',
              },
            ] as AnswerCard[]}
            projectId={DEMO_PROJECT_ID}
          />
        )}
      </Section>

      {/* A SYSTEM card: the five write-side workspace tools push it and the
          model cannot author one. Several operations of one kind land on ONE
          card, which is the shape a tidying turn produces — so what this
          section shows is the list under one question. */}
      <Section id="file_operation_proposal">
        {proposalsReady && (
          <AnswerCards
            cards={[
              {
                type: 'file_operation_proposal',
                proposal_id: DEMO.filesOpen,
                title: 'Drei Dateien nach „Einreichung/Pläne“ verschieben',
                operation: 'move',
                operations: [
                  {
                    document: 'Grundriss EG.pdf',
                    source: 'project',
                    current: 'Nachweise',
                    target_folder: 'Einreichung/Pläne',
                  },
                  {
                    document: 'Grundriss OG.pdf',
                    source: 'project',
                    current: '',
                    target_folder: 'Einreichung/Pläne',
                  },
                  {
                    document: 'Schnitt A-A – Bestand und Neubau (Revision 3).pdf',
                    source: 'project',
                    current: 'Nachweise',
                    target_folder: 'Einreichung/Pläne',
                  },
                ],
                note: 'Vorschlag — es wurde noch nichts verschoben.',
              },
            ] as AnswerCard[]}
            projectId={DEMO_PROJECT_ID}
          />
        )}
      </Section>

      {/* A system card the annotations tool pushes: what the agent did on a
          document. Two proposed marks (a box, a point) to take over or discard
          one by one, and an answer in an existing thread; then what the agent did
          at the person's request: a mark set open, two changes with their
          notes and an undo, and a deletion. The gallery's
          document does not exist, so the live read fails soft: the marks stay
          „proposed" and page 1 is drawn as a plain sheet. */}
      <Section id="canvas_activity">
        <AnswerCards
          cards={[
            {
              type: 'canvas_activity',
              document: { id: '00000000-0000-4000-8000-0000000000c1', name: 'Grundriss EG.pdf' },
              items: [
                {
                  action: 'proposed',
                  annotation_id: '00000000-0000-4000-8000-0000000000c2',
                  number: 7,
                  page: 1,
                  shape: 'region',
                  x: 0.58,
                  y: 0.34,
                  w: 0.14,
                  h: 0.22,
                  kind: 'defect',
                  body: 'Laufbreite im Treppenhaus 1,10 m; für GK 4 sind 1,20 m nutzbare Laufbreite gefordert (OIB-Richtlinie 4, Pkt. 2.2).',
                },
                {
                  action: 'proposed',
                  annotation_id: '00000000-0000-4000-8000-0000000000c3',
                  number: 8,
                  page: 2,
                  shape: 'point',
                  x: 0.31,
                  y: 0.62,
                  kind: 'question',
                  body: 'Ist die Tür zum Müllraum als EI2 30-C ausgeführt?',
                },
                {
                  action: 'replied',
                  annotation_id: '00000000-0000-4000-8000-0000000000c4',
                  number: 4,
                  excerpt: 'Die Brandschutztür ist im Türenbuch als EI2 30-C geführt, Position T-EG-04.',
                },
              ],
            },
            {
              type: 'canvas_activity',
              document: { id: '00000000-0000-4000-8000-0000000000c1', name: 'Grundriss EG.pdf' },
              items: [
                {
                  action: 'created',
                  annotation_id: '00000000-0000-4000-8000-0000000000c5',
                  number: 9,
                  page: 1,
                  shape: 'region',
                  x: 0.2,
                  y: 0.5,
                  w: 0.12,
                  h: 0.1,
                  kind: 'question',
                  body: 'Brüstungshöhe im Stiegenhaus mit dem Statiker klären.',
                },
                {
                  action: 'changed',
                  annotation_id: '00000000-0000-4000-8000-0000000000c4',
                  number: 4,
                  status: 'resolved',
                  changes: [{ field: 'status', before: 'open', after: 'resolved' }],
                  note: 'Erledigt: Die lichte Breite ist im Schnitt B-B mit 1,25 m kotiert.',
                },
                {
                  action: 'changed',
                  annotation_id: '00000000-0000-4000-8000-0000000000c6',
                  number: 5,
                  status: 'open',
                  changes: [
                    { field: 'assignee', after: 'user_anna', after_label: 'Anna Berger' },
                    { field: 'due_on', after: '2026-10-20' },
                  ],
                  note: 'Anna prüft die Fluchtweglängen bis Montag.',
                },
                { action: 'deleted', number: 6, body: 'Doppelt gesetzt, siehe Nr. 4.' },
              ],
            },
          ] as AnswerCard[]}
          projectId={null}
        />
      </Section>
    </>
  )
}
