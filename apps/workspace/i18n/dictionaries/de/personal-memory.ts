import type { en } from '../en'

/** Mein Gedächtnis: die eigenen Notizen einer Person, die sonst niemand liest (`/app/memory`, ADR-0180). */
export const personalMemory: typeof en.personalMemory = {
  title: 'Mein Gedächtnis',
  subtitle: 'Was {productName} sich über Sie und Ihre Arbeitsweise merkt.',
  // Das eine überprüfbare Versprechen der Seite. Es nennt Kolleg:innen und die Administrator:innen des Büros, wie ADR-0180.
  audience: 'Nur Sie sehen diese Notizen, weder Kolleg:innen noch die Administrator:innen Ihres Büros.',
  backToApp: 'Zurück',
  add: 'Notiz hinzufügen',
  addSubmit: 'Hinzufügen',
  save: 'Speichern',
  cancel: 'Abbrechen',
  kindLabel: 'Art der Notiz',
  kinds: {
    preference: 'Arbeitsweise',
    profile: 'Rolle und Themen',
  },
  contentLabel: 'Notiz',
  addPlaceholder: 'Ein Satz über Sie, zum Beispiel: Antworten bitte knapp und mit Fundstelle.',
  editLabel: 'Notiz bearbeiten',
  edit: 'Bearbeiten',
  pinned: 'Angeheftet',
  pin: 'Anheften',
  unpin: 'Lösen',
  pinTitle: 'Anheften: steht in jedem Chat an erster Stelle',
  unpinTitle: 'Lösen: steht nicht mehr an erster Stelle',
  remove: 'Entfernen',
  removeTitle: 'Aus meinem Gedächtnis entfernen',
  removeConfirmTitle: 'Notiz entfernen?',
  removeConfirmDescription: '{productName} berücksichtigt sie dann nicht mehr. Das lässt sich nicht rückgängig machen.',
  provenance: {
    user: 'von Ihnen hinzugefügt',
    agent: 'von {productName} notiert',
    distillation: 'von {productName} nach einer Antwort ergänzt',
  },
  emptyTitle: 'Noch keine Notizen',
  emptyDescription:
    '{productName} merkt sich hier, wie Sie arbeiten möchten und wofür Sie im Büro zuständig sind. Sie können auch selbst eine Notiz hinzufügen.',
  added: 'Notiz hinzugefügt.',
  updated: 'Notiz gespeichert.',
  removed: 'Notiz entfernt.',
  errors: {
    loadTitle: 'Die Notizen konnten nicht geladen werden',
    loadDescription: 'Versuchen Sie es noch einmal.',
    conflict: 'Eine andere Notiz sagt das bereits.',
    saveFailed: 'Die Notiz wurde nicht gespeichert. Versuchen Sie es noch einmal.',
    removeFailed: 'Die Notiz wurde nicht entfernt. Versuchen Sie es noch einmal.',
  },
}
