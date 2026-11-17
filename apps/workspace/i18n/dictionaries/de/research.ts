import type { en } from '../en'

export const research: typeof en.research = {
  dismissError: 'Fehler ausblenden',

  detailsHelp:
    'Diese Details erscheinen während einer laufenden Recherche und sind für abgeschlossene Berichte möglicherweise nicht verfügbar.',

  runsList: {
    untitledRun: 'Deep-Research-Durchlauf',
  },

  chatArea: {
    ariaMessages: 'Chat-Nachrichten',
    loading: 'Chat wird geladen',
    scrollToLatest: 'Zum neuesten Beitrag springen',
    connection: {
      lost: 'Verbindung unterbrochen · {productName} macht weiter, sobald sie wieder steht',
      restored: 'Wieder verbunden',
    },
    status: {
      thinking: 'Denkt nach …',
      answerReady: 'Antwort fertig',
      answerReadyWith: 'Antwort fertig: {gist}',
      stopped: 'Gestoppt',
      failed: 'Fehlgeschlagen',
      handedOff: 'Aufgabe angelegt',
      refused: 'Nicht bearbeitet',
    },
    loggedOutTitle: '{productName} wird verfügbar, sobald Ihre Organisation verifiziert ist.',
    loggedOutBody:
      'Melden Sie sich an, um den Projekt-Arbeitsbereich zu öffnen: Unterlagen, Büroablage, Aufgaben und Recherche.',
    signInSso: 'Mit SSO anmelden',
    welcomeTitle: 'Wie kann {productName} bei Ihrem Projekt helfen?',
  },

  chatToolbar: {
    createNewSession: 'Neue Sitzung erstellen',
    signInToCreate: 'Melden Sie sich an, um Sitzungen zu erstellen',
    cannotCreateActive:
      'Es kann keine neue Sitzung erstellt werden, solange die aktuelle Sitzung aktiv ist',
    newChat: 'Neuer Chat',
    toggleSessions: 'Chatverlauf',
    historyDoor: 'Chats',
    signInToView: 'Melden Sie sich an, um Ihren Chatverlauf zu sehen',
    sessions: 'Sitzungen',
    addSources: 'Datenquellen hinzufügen',
    signInToManage: 'Melden Sie sich an, um Datenquellen zu verwalten',
    sources: 'Quellen',
    research: 'Recherche',
    moreActions: 'Weitere Aktionen',
    renameSession: 'Chat umbenennen',
    researching: 'Recherche läuft',
  },

  dataSources: {
    loading: 'Datenquellen werden geladen',
    loadingEllipsis: 'Datenquellen werden geladen...',
    unableToLoad: 'Datenquellen konnten nicht geladen werden',
    retryAria: 'Laden der Datenquellen erneut versuchen',
  },

  sourceBasis: {
    label: 'Datenbasis',
    triggerAria: 'Datenbasis: {summary}. Öffnet die Auswahl.',
    description:
      'Worin {productName} suchen darf. Was tatsächlich verwendet wurde, steht in der Herleitung.',
    allSources: 'Alle Quellen',
    internalOnly: 'Nur Projektwissen',
    overflowAria: '{count, plural, one {# weitere Quellenart} other {# weitere Quellenarten}}',
    alwaysOn: 'Immer dabei',
    alwaysOnChip: 'Immer aktiv',
    external: 'Externe Quellen',
    signInRequired: 'Anmeldung nötig',
    signInReason: 'Melden Sie sich an, um diese Quelle zu nutzen.',
    lockedBusy: 'Während einer laufenden Recherche lässt sich die Datenbasis nicht ändern.',
    noExternalWarning: '{productName} sucht dann nur noch in Ihren Projektunterlagen.',
    presetsLabel: 'Voreinstellungen',
    emptyTitle: 'Keine externen Quellen',
    emptyBody:
      'Für dieses Projekt sind derzeit keine externen Quellen freigeschaltet. {productName} sucht in Ihren Projektunterlagen.',
    toggleAria: '{name} zulassen',
    strata: {
      law: 'Baurecht',
      office: 'Büroablage',
      project: 'Projektwissen',
      auto: 'Web',
    },
    presets: {
      all: 'Alle Quellen',
      law: 'Baurecht & Richtlinien',
      project: 'Projektunterlagen',
      office: 'Büroablage',
    },
    knowledge: {
      projectName: 'Projektwissen',
      projectDescription: 'Ihre Projektunterlagen in diesem Projekt.',
      officeName: 'Büroablage',
      officeDescription: 'Freigegebene Unterlagen Ihres Büros.',
    },
  },

  deleteModals: {
    cannotReverse:
      'Diese Aktion kann nicht rückgängig gemacht werden. Sind Sie sicher, dass Sie dies tun möchten?',
    aboutToDelete: 'Sie sind dabei,',
    lossSuffix:
      ' zu löschen. Dabei gehen sämtliche Fortschritte verloren und alle von Ihnen angehängten Dateien werden entfernt.',
    all: {
      title: 'Alle Chats dieses Projekts löschen?',
      countSessions:
        '{count, plural, one {der eine Chat dieses Projekts} other {alle # Chats dieses Projekts}}',
      allSessions: 'JEDEN Chat dieses Projekts',
      scopeNote:
        'Es werden nur Chats dieses Projekts gelöscht. Ihre Chats in anderen Projekten sind nicht betroffen.',
      confirm: 'Alle Chats löschen',
    },
    file: {
      title: 'Datei löschen',
      thisFile: 'diese Datei',
      suffix: ' zu löschen. Sie wird damit vollständig aus Ihrer Sitzung entfernt.',
      confirm: 'Datei löschen',
    },
    session: {
      title: 'Diesen Chat löschen?',
      thisSession: 'diesen Chat',
      confirm: 'Chat löschen',
    },
  },





  fileCard: {
    lines: '{count, plural, one {# Zeile} other {# Zeilen}}',
    content: 'Inhalt',
  },

  fileSourceCard: {
    statusUploading: 'Wird hochgeladen...',
    statusIngesting: 'Wird gelesen',
    statusAvailable: 'Verfügbar',
    statusError: 'Fehler',
    statusHeld: 'Zurückgehalten',
    statusStored: 'Abgelegt',
    statusDeleting: 'Wird gelöscht...',
    statusCanceled: 'Abgebrochen',
    dismiss: '{title} ausblenden',
    expiryPending: 'Löschung ausstehend – erneut hochladen',
    expiresIn: 'Läuft in {minutes} Min. ab',
    deleteDisabled: '{title} löschen (deaktiviert)',
    delete: '{title} löschen',
    waitUpload: 'Warten Sie, bis der Upload abgeschlossen ist',
    cannotDeleteBusy: 'Dateien können während aktiver Vorgänge nicht gelöscht werden',
    deleteFile: 'Datei löschen',
    open: 'Vorschau öffnen: {title}',
  },

  fileSourcesTab: {
    uploadTo: 'Hochladen nach',
    targetProject: 'Projektwissen',
    targetSession: 'Private Sitzung',
    targetProjectLower: 'das Projektwissen',
    targetSessionLower: 'die private Sitzung',
    availableInProject: 'In diesem Projekt verfügbar.',
    projectFilesManagedInFiles: 'Projektdateien löschen Sie in den Projektdateien.',
    preparingCorpus: 'Projektwissen wird vorbereitet...',
    onlyThisSession: 'Nur in dieser Chat-Sitzung verfügbar.',
    loadingFiles: 'Dateien werden geladen',
    checkingFiles: 'Dateien werden geprüft...',
    setupBackend: 'Dateien stehen erst zur Verfügung, wenn die Verbindung zu {productName} steht.',
    noAttachedFiles: 'Keine angehängten Dateien',
    filesGoTo: 'Hier hochgeladene Dateien gelangen in {target}, sofern nicht entfernt.',
    filesCount: '{target} – Dateien ({count})',
    loadingFilesEllipsis: 'Dateien werden geladen...',
    addFiles: 'Dateien hinzufügen',
    uploadNotAvailable: 'Datei-Upload nicht verfügbar',
    addFile: '+ Datei hinzufügen',
  },

  inputArea: {
    subjectCleared: 'Frage bezieht sich nicht mehr auf diese Datei.',
    subjectClearedUndo: 'Rückgängig',
    aiDisclosure:
      '{productName} ist ein KI-System — Antworten können falsch sein; prüfen Sie sie anhand der zitierten Unterlagen.',
    placeholderDefault: 'Datenquellen prüfen und eine Recherchefrage stellen...',
    signInToStart: 'Melden Sie sich an, um zu beginnen',
    typeResponse: 'Geben Sie Ihre Antwort an {productName} ein...',
    pleaseWait: 'Bitte warten...',
    typeAhead: 'Nächste Frage schon eingeben …',
    typeAheadHint: 'Senden ist möglich, sobald die Antwort fertig ist.',
    steer: '{productName} lenken …',
    steerHint: 'Enter ergänzt die laufende Antwort; {productName} liest es vor dem nächsten Schritt.',
    steerChip: 'lenkt',
    steerSent: 'Ergänzung gesendet',
    messageNotSent: 'Nachricht nicht gesendet',
    messageNotSentDesc:
      'Beim Senden Ihrer Nachricht ist ein Fehler aufgetreten. Bitte versuchen Sie es erneut.',
    unsupportedFileType: 'Nicht unterstützter Dateityp',
    dropToUpload: 'Dateien zum Hochladen ablegen',
    accepts: 'Akzeptiert: {types}',
    openFiles: 'Hochgeladene Dateien öffnen',
    availableFiles: 'Verfügbare Dateien',
    uploadNotAvailable: 'Datei-Upload nicht verfügbar',
    attachFiles: 'Dateien anhängen',
    uploadDisabledBusy: 'Datei-Upload während aktiver Vorgänge deaktiviert',
    dropRefusedReadOnly: 'Sie können diesen Chat lesen, aber keine Dateien hinzufügen.',
    dropRefusedAnswering: '{productName} antwortet gerade. Dateien können Sie anhängen, sobald die Antwort fertig ist.',
    dropRefusedQuestion: 'Beantworten Sie zuerst die Rückfrage von {productName}, dann können Sie Dateien anhängen.',
    dropRefusedUploading: 'Warten Sie, bis der laufende Upload abgeschlossen ist.',
    selectFiles: 'Dateien zum Hochladen auswählen',
    sendResponse: 'Antwort senden',
    sendMessage: 'Nachricht senden',
    sendQuery: 'Anfrage senden',
    responseInput: 'Antworteingabe',
    chatMessageInput: 'Chat-Nachrichteneingabe',
    stopStreaming: 'Antwort stoppen',
    stopStreamingTitle: 'Antwort stoppen (Esc)',
    sendWhilePending: 'Noch sind nicht alle Dateien gelesen. Trotzdem senden?',
    heldForUpload: 'Wird gesendet, sobald die Datei gelesen ist.',
    heldForUploadSendNow: 'Jetzt ohne die Datei fragen',
    removeFile: 'Datei entfernen: {name}',
    retryUpload: 'Upload erneut versuchen',
    manageFiles: 'Dateien verwalten',
    manageFilesCount: 'Angehängte Dateien verwalten ({count})',
    manageFilesMobile: '{count, plural, one {# Datei} other {# Dateien}} verwalten',
    openFile: 'Datei öffnen: {name}',
    fileUploadingStatus: 'Wird hochgeladen',
    fileFailedStatus: 'Upload fehlgeschlagen',
    fileReadyStatus: 'Bereit',
  },





  sessionsPanel: {
    title: 'Chatverlauf',
    close: 'Chatverlauf schließen',
    countLabel: '{count, plural, one {# Chat} other {# Chats}}',
    countLabelOne: '1 Chat',
    syncedNote:
      'Chats werden in Ihrem Workspace gespeichert und sind auf allen Geräten verfügbar. Rechercheberichte können auf dem Server ablaufen.',
    deleteAllDisabled: 'Alle Chats dieses Projekts löschen (deaktiviert)',
    deleteAll: 'Alle Chats dieses Projekts löschen',
    cannotDeleteBusy: 'Löschen nicht möglich, während Vorgänge laufen',
    deleteAllButton: 'Alle Chats löschen',
    stopResearch: 'Recherche stoppen',
    stopResearchTitle: 'Diesen Recherchedurchlauf stoppen',
    stopConfirmTitle: 'Recherche stoppen?',
    stopConfirmBody:
      'Die laufende Recherche wird abgebrochen und kann nicht fortgesetzt werden. Der bisherige Teilfortschritt bleibt im Recherchebereich sichtbar.',
    stopConfirmConfirm: 'Recherche stoppen',
    newSessionDisabled: 'Neuen Chat starten (während aktiver Vorgänge deaktiviert)',
    startNewSession: 'Neuen Chat starten',
    cannotCreateActive:
      'Es kann kein neuer Chat gestartet werden, solange dieser noch antwortet',
    newSessionButton: 'Neuer Chat',
    searchPlaceholder: 'Chats durchsuchen',
    searchAria: 'Chats durchsuchen',
    clearSearch: 'Suche zurücksetzen',
    searchResults: '{count} von {total} Chats',
    noMatching: 'Keine passenden Chats',
    noMatchingDescription: 'Nichts in diesem Projekt passt zu „{query}“.',
    noSessions: 'Noch keine Chats',
    noSessionsDescription: 'Ihre Chats mit {productName} in diesem Projekt erscheinen hier.',
    navigationBlocked:
      '{productName} antwortet noch. Neue Chats und der Wechsel zwischen Chats pausieren bis zum Abschluss.',
    today: 'Heute',
    yesterday: 'Gestern',
    editTitle: 'Chat-Titel bearbeiten',
    untitledSession: 'Chat ohne Titel',
    rowActions: 'Aktionen für „{title}“',
    renameDisabled: 'Chat umbenennen (deaktiviert)',
    rename: 'Chat umbenennen',
    cannotRenameBusy: 'Umbenennen nicht möglich, während Vorgänge laufen',
    deleteDisabled: 'Chat löschen (deaktiviert)',
    deleteSession: 'Chat löschen',
    sessionActive: '{productName} arbeitet an diesem Chat',
    reportCompleted: 'Bericht fertig',
    chatSession: 'Chat',
    sessionLabelBusy: 'Chat: {title} (Verarbeitung läuft)',
    sessionLabel: 'Chat: {title}',
    sessionLabelWithStatus: 'Chat: {title} — {status}',
    temporaryMark: 'Temporärer Chat: Daraus wird nichts gemerkt.',
    sessionLabelTemporary: '{label} (temporärer Chat, daraus wird nichts gemerkt)',
    deepResearchHeading: 'Deep Research',
    deepResearchChip: 'Deep Research',
    deepResearchRunLabel: 'Deep-Research-Durchlauf öffnen: {label} — {status}',
    filterAria: 'Verlauf filtern',
    filterAll: 'Alle',
    filterChats: 'Chats',
    filterResearch: 'Deep Research',
    researchLoadFailed: 'Deep-Research-Durchläufe konnten nicht geladen werden.',
    noRuns: 'Noch keine Deep-Research-Durchläufe',
    noRunsDescription: 'Deep-Research-Durchläufe aus diesem Projekt erscheinen hier.',
    runStatus: {
      running: 'Läuft',
      completed: 'Bericht fertig',
      failed: 'Fehlgeschlagen',
      cancelled: 'Abgebrochen',
    },
  },









}
