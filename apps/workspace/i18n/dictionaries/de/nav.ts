import type { en } from '../en'

/** Navigation shell: sidebar, org header, and the user menu. */
export const nav: typeof en.nav = {
  projectNavigation: 'Projektnavigation',
  projectSections: 'Projektbereiche',
  /** The project's last chats under „Chat“ in the rail, and the way to all of them. */
  recentChats: 'Letzte Chats',
  allChats: 'Alle Chats',
  // Ein temporärer Chat in der Liste der Leiste: das Zeichen, in Worten für Screenreader und Zeiger.
  temporaryChat: '(temporärer Chat)',
  temporaryChatTitle: '{title} (temporärer Chat: daraus wird nichts gemerkt)',
  allProjects: '{productName} — alle Projekte',
  collapseSidebar: 'Seitenleiste einklappen',
  expandSidebar: 'Seitenleiste ausklappen',
  resizeSidebar: 'Breite der Seitenleiste ändern',
  // Die Leiste neben der Seite (das Postfach): ihre Breite mit den Pfeiltasten oder durch Ziehen.
  resizeDock: 'Breite der Leiste neben der Seite ändern',
  resizeSidebarHint: 'Ziehen zum Ändern der Breite, klicken zum Einklappen',
  expandSidebarHint: 'Ziehen oder klicken zum Ausklappen',
  openNavigation: 'Navigation öffnen',
  sections: {
    chat: 'Chat',
    files: 'Dateien',
    knowledge: 'Wissen',
    research: 'Recherche',
    /** Automatisierung — Aufgaben und Skills als Tabs in einem Bereich. */
    automation: 'Automatisierung',
    // Ähnliche abgeschlossene Projekte, für dieses gelesen (ADR-0094).
    referenzen: 'Ähnliche Projekte',
    skills: 'Skills',
    jobs: 'Jobs',
    // Der führende Tab: an Piloti übergebene Arbeit, eine Karte je Aufgabe (ADR-0051).
    tasks: 'Aufgaben',
    officeShelf: 'Büroablage',
    // Die Normen, Kommentare und Weisungen des Büros, ein Bereich mit Ordnern (ADR-0163).
    baseKnowledge: 'Grundlagen',
    search: 'Suche',
    settings: 'Übersicht',
    // Der Intake-Assistent, im Produkt „Einrichtung" (nur ⌘K-Palette).
    intake: 'Einrichtung',
    // Piloti liest die Dokumente des Projekts, die Person prüft (ADR-0111).
    setup: 'Einrichtung',
  },
  sectionGroups: {
    // Alles, was in einem Projekt geschieht; die Leiste zeigt es ohne Überschrift.
    work: 'Dieses Projekt',
    org: 'Organisation',
  },
  sectionSubtitles: {
    automation:
      'Was {productName} erledigt hat, während Sie weg waren, was als Nächstes ansteht — und die Skills, mit denen es arbeitet.',
    knowledge: 'Was die Wissensbasis derzeit enthält.',
    settings: 'Wo dieses Projekt steht und wie es eingerichtet ist.',
    intake: 'Geführtes Briefing für dieses Projekt.',
    setup: 'Projekt, Ablage, Erfassung, Rückfragen, Steckbrief: {productName} liest, Sie prüfen und bestätigen.',
  },
  /** A page inside a section (Dateien › E-Mail-Eingang): its title, under the crumb „Projekt › Dateien“. */
  subpages: {
    'files/all': {
      title: 'Dateien',
      /** The tab: true at every depth of the tree, where „Alle Dateien“ over a subfolder was not. */
      tab: 'Ordner',
    },
    'files/mail': {
      title: 'E-Mail-Eingang',
    },
    'files/bin': {
      title: 'Papierkorb',
    },
    'files/open-points': {
      title: 'Offene Punkte',
    },
  },
  filesPlaces: 'Orte der Dateien',
  backTo: 'Zurück zu {label}',
  returnTargets: {
    project: 'zum Projekt',
    members: 'zum Projektteam',
    model: 'zum Modell',
    organization: 'zur Organisation',
    platform: 'zur Plattform',
    profile: 'zum Profil',
  },
  tabTitle: {
    intake: 'Einrichtung',
    setup: 'Einrichtung',
    researchProgress: '{percent}% · {label} — {productName}',
    researchActive: '⏳ {label} — {productName}',
  },
  projectSwitcher: {
    select: 'Projekt auswählen',
    switchCurrent: 'Projekt wechseln (aktuell: {name})',
    switchHeading: 'Projekt wechseln',
    projectSettings: 'Einstellungen für {name}',
    projects: 'Projekte',
    allProjects: 'Alle Projekte',
    viewAllProjects: 'Alle Projekte ansehen',
    newProject: 'Neues Projekt',
  },
  /** Die untere Tab-Leiste am Telefon (`components/shell/phone-tab-bar.tsx`). */
  inboundMailWaiting: '{count, plural, one {# E-Mail wartet auf Ablage} other {# E-Mails warten auf Ablage}}',
  tabBar: {
    label: 'Hauptnavigation',
    /** Öffnet das Blatt mit den Zielen, die die Leiste nicht trägt. */
    more: 'Mehr',
    /** Das Blatt hinter „Mehr“ (`components/shell/phone-more-sheet.tsx`). */
    moreSheet: {
      title: 'Mehr',
      description: 'Weitere Bereiche und das Konto.',
      close: 'Schließen',
      project: 'Projekt',
      account: 'Konto',
    },
  },
  search: {
    /** Der Weg zur Befehlspalette per Finger, in beiden Kopfzeilen. */
    open: 'Suchen und springen',
  },
  /** Der Projektwechsel als Blatt von unten am Telefon. */
  projectSheet: {
    description: 'Zuletzt geöffnete Projekte zuerst, danach alle laufenden.',
    close: 'Schließen',
    searchLabel: 'Projekt suchen',
    searchPlaceholder: 'Projekt suchen',
    clearSearch: 'Suche leeren',
    recent: 'Zuletzt geöffnet',
    others: 'Weitere Projekte',
    matches: 'Passende Projekte',
    noMatch: 'Kein laufendes Projekt heißt so.',
  },
  userMenu: {
    label: 'Benutzermenü für {name}',
    defaultUser: 'Standardbenutzer',
    authNotConfigured: 'Authentifizierung nicht konfiguriert',
    profile: 'Profil',
    memory: 'Mein Gedächtnis',
    organization: 'Organisation',
    platform: 'Plattform',
    switchOrganization: 'Organisation wechseln',
    currentOrganization: 'Aktuelle Organisation',
    switchingOrganization: 'Wechselt…',
    switchOrganizationFailed: 'Wechsel fehlgeschlagen. Bitte erneut versuchen.',
    settings: 'Einstellungen',
    whatsNew: 'Neuerungen',
    productTour: 'Produkttour',
  },
}
