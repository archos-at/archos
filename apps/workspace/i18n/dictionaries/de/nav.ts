import type { en } from '../en'

/** Navigation shell: sidebar, org header, and the user menu. */
export const nav: typeof en.nav = {
  projectNavigation: 'Projektnavigation',
  projectSections: 'Projektbereiche',
  allProjects: '{productName} — alle Projekte',
  collapseSidebar: 'Seitenleiste einklappen',
  expandSidebar: 'Seitenleiste ausklappen',
  resizeSidebar: 'Breite der Seitenleiste ändern',
  // Die Leiste neben der Seite (das Postfach): ihre Breite mit den Pfeiltasten oder durch Ziehen.
  resizeDock: 'Breite der Leiste neben der Seite ändern',
  resizeSidebarHint: 'Ziehen zum Ändern der Breite, klicken zum Einklappen',
  expandSidebarHint: 'Ziehen oder klicken zum Ausklappen',
  openNavigation: 'Navigation öffnen',
  closeNavigation: 'Navigation schließen',
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
    search: 'Suche',
    settings: 'Übersicht',
    // Der Intake-Assistent, im Produkt „Einrichtung" (nur ⌘K-Palette).
    intake: 'Einrichtung',
    // Piloti liest die Dokumente des Projekts, die Person prüft (ADR-0111).
    setup: 'Einrichtung',
  },
  sectionGroups: {
    org: 'Organisation',
  },
  sectionSubtitles: {
    files: 'Die Unterlagen dieses Projekts. {productName} liest sie und zitiert daraus.',
    automation:
      'Was {productName} erledigt hat, während Sie weg waren, was als Nächstes ansteht — und die Skills, mit denen es arbeitet.',
    knowledge: 'Was die Wissensbasis derzeit enthält.',
    settings: 'Wo dieses Projekt steht und wie es eingerichtet ist.',
    intake: 'Geführtes Briefing für dieses Projekt.',
    setup: 'Projekt, Ablage, Erfassung, Rückfragen, Steckbrief: {productName} liest, Sie prüfen und bestätigen.',
  },
  /** A page inside a section (Dateien › E-Mail-Eingang): its title and subtitle; the section is the breadcrumb above. */
  subpages: {
    'files/all': {
      title: 'Alle Dateien',
    },
    'files/mail': {
      title: 'E-Mail-Eingang',
      subtitle: 'E-Mails an die E-Mail-Adresse des Projekts warten hier, bis jemand sie ablegt.',
    },
    'files/bin': {
      title: 'Papierkorb',
      subtitle: 'Gelöschte Ordner mit ihren Unterordnern und Dokumenten. Bis zur endgültigen Löschung lassen sie sich mit ihren Zugriffsrechten wiederherstellen.',
    },
    'files/open-points': {
      title: 'Offene Punkte',
      subtitle: 'Was in den Dokumenten dieses Projekts offen ist, über alle Dokumente: die Liste für den Jour fixe.',
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
      places: 'Bereiche',
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
