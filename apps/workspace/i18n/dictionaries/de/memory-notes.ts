import type { en } from '../en'

/**
 * Die Wörter, die jede Gedächtnis-Ansicht teilt (ADR-0180). Die Art einer Notiz
 * heißt hier ein Mal; der Chip unter einer Antwort, die Vorschlagskarte, das
 * Projektgedächtnis und „Mein Gedächtnis“ lesen sie über
 * `ui/components/memory/memory-kinds.ts`.
 */
export const memoryNotes: typeof en.memoryNotes = {
  // Eine Notiz dieser Art: die Metazeile einer Zeile, die Auswahl im Formular, das Etikett einer Karte.
  kinds: {
    decision: 'Entscheidung',
    constraint: 'Vorgabe',
    open_question: 'Offene Frage',
    derived_fact: 'Fakt',
    preference: 'Präferenz',
    // Eine persönliche Notiz darüber, wer die Person im Büro ist.
    profile: 'Rolle und Themen',
  },
  // Die Überschrift über den Notizen einer Art auf einer Gedächtnis-Seite.
  kindGroups: {
    decision: 'Entscheidungen',
    constraint: 'Vorgaben',
    open_question: 'Offene Fragen',
    derived_fact: 'Fakten',
    preference: 'Präferenzen',
    profile: 'Rolle und Themen',
  },
}
