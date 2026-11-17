import type { en } from '../en'

export const tasks: typeof en.tasks = {
  cadence: {
    once: 'Einmalig',
  },
  create: {
    delegate: 'Delegieren',
    delegateHint: 'Übergeben wird im Chat: Bitten Sie {productName}, etwas zu übernehmen.',
    task: 'Neue Aufgabe',
  },
  view: {
    label: 'Ansicht',
    list: 'Liste',
    timetable: 'Zeitplan',
  },
  standing: {
    heading: 'Stehende Aufgaben',
    emptyTitle: 'Noch keine stehenden Aufgaben',
    emptyDescription:
      'Legen Sie eine Aufgabe an — mit Rhythmus läuft sie von allein, ohne wartet sie auf Sie.',
  },
  filters: {
    label: 'Aufgaben filtern',
    all: 'Alle',
    active: 'Läuft',
    unreviewed: 'Ungeprüft',
    failed: 'Fehlgeschlagen',
    showAll: 'Alle Aufgaben zeigen',
  },
  buckets: {
    today: 'Heute',
    yesterday: 'Gestern',
    week: 'Diese Woche',
    earlier: 'Früher',
  },
  card: {
    openAria: '„{title}“ öffnen',
    unreviewed: 'Noch nicht geprüft',
    toReview: 'Zu prüfen',
  },
  result: {
    document: 'Dokument öffnen',
    conversation: 'Im Chat fortsetzen',
  },
  detail: {
    close: 'Details schließen',
    edit: 'Bearbeiten',
    result: 'Ergebnis',
    request: 'Aufgabe',
    schedule: 'Zeitplan',
    prompt: 'Prompt',
    runs: 'Läufe',
    promote: 'Als stehende Aufgabe speichern',
    promoteHint: 'Öffnet den Aufgaben-Assistenten mit dieser Aufgabe. Gespeichert wird erst im letzten Schritt, dieser Lauf bleibt unverändert.',
    gone: 'Das gibt es nicht mehr — möglicherweise wurde es gelöscht.',
    goneUnresolved:
      'Das wurde hier nicht gefunden. Der Link zeigt möglicherweise auf ein anderes Projekt, oder der Eintrag wurde gelöscht.',
    goneTitle: 'Nicht gefunden',
    loadingTitle: 'Wird geladen',
    runLoading: 'Der Ablauf wird geladen …',
    runUnavailable: 'Der vollständige Ablauf dieses Laufs konnte nicht geladen werden.',
    openThread: 'Im Verlauf öffnen',
  },
  list: {
    emptyTitle: 'Noch nichts übergeben',
    emptyDescription:
      'Bitten Sie {productName} im Chat, etwas zu übernehmen, oder schicken Sie einen Entwurf zur Überarbeitung zurück — dann steht es hier.',
    emptyFiltered: {
      active: 'Gerade läuft nichts',
      unreviewed: 'Alles Fertige ist geprüft',
      failed: 'Nichts ist fehlgeschlagen',
    },
    errorTitle: 'Die Aufgaben konnten nicht geladen werden',
    errorDescription: 'Der Rest des Projekts ist davon nicht betroffen. Versuchen Sie es gleich noch einmal.',
    retry: 'Erneut versuchen',
  },
  kind: {
    'deep-research': 'Recherche',
    chat: 'Chat',
    compliance_check: 'Normprüfung',
    submission_check: 'Einreichcheck',
    document: 'Dokument',
    revision: 'Überarbeitung',
  },
  status: {
    queued: 'Eingereiht',
    running: 'Läuft',
    succeeded: 'Fertig',
    failed: 'Fehlgeschlagen',
    interrupted: 'Angehalten',
    skipped: 'Übersprungen',
    error: 'Übermittlung fehlgeschlagen',
  },
  review: {
    accepted: 'Angenommen',
    rejected: 'Zurückgeschickt',
  },
  meta: {
    byOn: '{name} · {when}',
    on: '{when}',
  },
}
