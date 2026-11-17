/**
 * memoryNotes namespace: the words every memory surface shares (ADR-0180). A
 * note's kind is named here once; the chip under an answer, the proposal card,
 * a project's memory page and a person's own all read it through
 * `ui/components/memory/memory-kinds.ts`, so a kind cannot be called two things.
 */
export const memoryNotes = {
  // One note of the kind: a row's meta line, the add form's choice, a card's badge.
  kinds: {
    decision: 'Decision',
    constraint: 'Constraint',
    open_question: 'Open question',
    derived_fact: 'Fact',
    preference: 'Preference',
    // A personal note about who the person is in the office.
    profile: 'Role and topics',
  },
  // The heading over the notes of one kind on a memory page.
  kindGroups: {
    decision: 'Decisions',
    constraint: 'Constraints',
    open_question: 'Open questions',
    derived_fact: 'Facts',
    preference: 'Preferences',
    profile: 'Role and topics',
  },
}
