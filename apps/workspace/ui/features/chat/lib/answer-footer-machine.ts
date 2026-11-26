import { setup, type SnapshotFrom } from 'xstate'

/** What the footer's one drawer can hold. One at a time: opening another swaps it. */
export const FOOTER_PANELS = ['sources', 'details', 'reasons'] as const
export type FooterPanel = (typeof FOOTER_PANELS)[number]

export type AnswerFooterEvent =
  | { type: 'toggle'; panel: FooterPanel }
  | { type: 'open'; panel: FooterPanel }
  | { type: 'close'; panel: FooterPanel }
  | { type: 'escape' }

const others = (panel: FooterPanel | null) => FOOTER_PANELS.filter((other) => other !== panel)
const when = (panel: FooterPanel) => ({ type: 'isPanel', params: { panel } }) as const
const openOn = (panel: FooterPanel | null) =>
  others(panel).map((other) => ({ guard: when(other), target: other }))

/** One state per panel; from each, a trigger for itself shuts the drawer and another swaps it. */
const panelState = (panel: FooterPanel) => ({
  on: {
    toggle: [{ guard: when(panel), target: 'closed' }, ...openOn(panel)],
    open: openOn(panel),
    close: { guard: when(panel), target: 'closed' },
  },
})

export const answerFooterMachine = setup({
  types: { events: {} as AnswerFooterEvent },
  guards: {
    isPanel: ({ event }, params: { panel: FooterPanel }) =>
      'panel' in event && event.panel === params.panel,
  },
}).createMachine({
  id: 'answerFooter',
  initial: 'closed',
  states: {
    closed: { on: { toggle: openOn(null), open: openOn(null) } },
    sources: panelState('sources'),
    details: panelState('details'),
    reasons: panelState('reasons'),
  },
  on: { escape: { target: '.closed' } },
})

export type AnswerFooterSnapshot = SnapshotFrom<typeof answerFooterMachine>

/** The panel the drawer shows, or null when it is shut. */
export const openPanel = (snapshot: AnswerFooterSnapshot): FooterPanel | null =>
  snapshot.value === 'closed' ? null : (snapshot.value as FooterPanel)
