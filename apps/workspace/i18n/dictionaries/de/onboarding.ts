import type { en } from '../en'

export const onboarding: typeof en.onboarding = {
  validation: {
    nameRequired: 'Der Organisationsname ist erforderlich.',
    nameTooLong: 'Der Organisationsname darf höchstens 100 Zeichen lang sein.',
    homeCountryRequired: 'Wählen Sie das Land Ihres Büros.',
  },
  inviteOnly: {
    eyebrow: 'Einladung erforderlich',
    title: 'Diese Plattform ist nur auf Einladung zugänglich',
    description:
      'Neue Organisationen werden vom Plattform-Team angelegt. Bitten Sie den Administrator Ihrer Organisation um eine Einladung — danach landen Sie direkt im gemeinsamen Arbeitsbereich.',
    wrongAccount:
      'Mit dem falschen Konto angemeldet? Melden Sie sich ab und mit dem Konto an, das die Einladung erhalten hat.',
  },
  account: {
    signedInAs: 'Angemeldet als {email}',
    signedIn: 'Sie sind angemeldet.',
  },
  errors: {
    createFailed: 'Organisation konnte nicht erstellt werden.',
    selfServeDisabled: 'Das Erstellen neuer Organisationen ist auf dieser Plattform deaktiviert. Bitten Sie Ihren Administrator um eine Einladung.',
    generic: 'Etwas ist schiefgelaufen.',
    title: 'Organisationseinrichtung fehlgeschlagen',
  },
  form: {
    eyebrow: 'Neue Organisation',
    title: 'Benennen Sie Ihre Organisation',
    description:
      'Ihre Organisation ist der private Raum für die Bauprojekte, Dokumente und Kolleginnen und Kollegen Ihres Büros. Sie werden ihr Administrator.',
    nameLabel: 'Organisationsname',
    namePlaceholder: 'Musterarchitektur ZT GmbH',
    nameHint: 'Meist der Name Ihres Büros.',
    homeCountryLabel: 'Land Ihres Büros',
    homeCountryPlaceholder: 'Land wählen',
    homeCountryHint: 'Wo Ihr Büro seinen Sitz hat. Welches Baurecht für ein Projekt gilt, entscheidet nicht der Sitz, sondern der Standort.',
    homeCountries: {
      AT: 'Österreich',
      DE: 'Deutschland',
      CH: 'Schweiz',
      LI: 'Liechtenstein',
    },
    submit: 'Organisation erstellen',
    invitedHint:
      'Sie möchten einer bestehenden Organisation beitreten? Bitten Sie deren Administrator um eine Einladung — eingeladene Mitglieder überspringen diesen Schritt.',
  },
  next: {
    heading: 'Wie es weitergeht',
    private: 'Dokumente, Chats und Recherchen bleiben in Ihrer Organisation.',
    admin: 'Als Administrator laden Sie Kolleginnen und Kollegen ein und legen fest, was sie dürfen.',
    tour: 'Eine kurze Tour zeigt Ihnen alles Wichtige.',
  },
  success: {
    title: 'Organisation erstellt',
    description: '{name} ist bereit, und Sie sind ihr Administrator.',
    redirecting: 'Ihr Arbeitsbereich wird geöffnet…',
  },
  tour: {
    progress: '{current} von {total}',
    next: 'Weiter',
    back: 'Zurück',
    done: 'Loslegen',
    close: 'Tour schließen',
    stops: {
      welcome: {
        title: 'Willkommen bei {productName}',
        body: 'Ihre Organisation ist bereit. Ein kurzer Rundgang zeigt, wo was liegt.',
      },
      welcomeJoined: {
        title: 'Willkommen bei {productName}',
        body: 'Hier arbeitet Ihr Büro an seinen Projekten, mit {productName} als Kollegen. Ein kurzer Rundgang zeigt, wo was liegt.',
      },
      sides: {
        title: 'Persönlich oder Projekt',
        body: 'Ein Schalter, zwei Seiten. Persönlich: Ihre eigenen Chats und „Meine Ablage“, nur für Sie. Projekt: alles zu einem Gebäude, mit allen, die daran arbeiten.',
      },
      sidesPhone: {
        title: 'Persönlich oder Projekt',
        body: 'Ein Schalter oben im Chat, zwei Seiten. Persönlich: Ihre eigenen Chats und „Meine Ablage“, nur für Sie. Projekt: alles zu einem Gebäude. Dort öffnet der Projektname daneben Ihre Projekte.',
      },
      projects: {
        title: 'Ihre Projekte',
        body: 'Ein Klick auf {productName} öffnet die Projektübersicht. Dort legen Sie ein Projekt an: ein Gebäude mit seiner Ablage, seinen Beteiligten und seinen Chats.',
      },
      projectsJoined: {
        title: 'Ihre Projekte',
        body: 'Ein Klick auf {productName} öffnet die Projektübersicht. Projekte erscheinen dort, sobald Kolleginnen und Kollegen Sie hinzufügen; ein eigenes legen Sie dort an.',
      },
      morePhone: {
        title: 'Alles Weitere unter „Mehr“',
        body: 'Ihre Projekte und „Neues Projekt“, die Suche, die Bürobibliothek Ihres Büros und Ihr Konto, auch der Wechsel in ein anderes Büro.',
      },
      morePhoneShelfless: {
        title: 'Alles Weitere unter „Mehr“',
        body: 'Ihre Projekte und „Neues Projekt“, die Suche und Ihr Konto, auch der Wechsel in ein anderes Büro.',
      },
      officeShelf: {
        title: 'Bürobibliothek',
        body: 'Die gemeinsamen Unterlagen Ihres Büros: Regeldetails, Leistungsbeschreibungen, Vorlagen. Einmal hier abgelegt, greift jedes Projekt darauf zurück.',
      },
      inbox: {
        title: 'Postfach',
        body: 'Erwähnungen, Anfragen und Neuigkeiten Ihrer Kolleginnen und Kollegen landen hier.',
      },
      search: {
        title: 'Suchen',
        body: 'Die Lupe findet jede Datei, jeden Chat und jedes Projekt im Büro.',
        palette: 'Suchen',
        cheatsheet: 'Alle Tastenkürzel',
      },
      account: {
        title: 'Ihr Konto und Ihr Büro',
        body: 'Profil, Design, Sprache und diese Tour. Unter „Organisation“ laden Sie Kolleginnen und Kollegen ein; gehören Sie mehreren Büros an, wechseln Sie hier.',
      },
      accountMember: {
        title: 'Ihr Konto',
        body: 'Profil, Design, Sprache und diese Tour. Gehören Sie mehreren Büros an, wechseln Sie hier. Mitglieder und Rollen verwalten die Administratoren.',
      },
      projectWelcome: {
        title: 'Ihr Projekt ist eingerichtet',
        body: '{productName} kennt jetzt die Eckdaten dieses Gebäudes. Hier findet die Arbeit statt.',
      },
      projectWelcomeJoined: {
        title: 'In einem Projekt',
        body: 'Jedes Gebäude bekommt einen Raum wie diesen. Hier findet die Arbeit statt.',
      },
      projectChat: {
        title: 'Mit {productName} arbeiten',
        body: 'Fragen Sie {productName} zu diesem Gebäude oder übergeben Sie ihm eine Aufgabe. Ihre bisherigen Chats stehen darunter unter „Letzte Chats“.',
      },
      projectChatPhone: {
        title: 'Mit {productName} arbeiten',
        body: 'Fragen Sie {productName} zu diesem Gebäude oder übergeben Sie ihm eine Aufgabe. „Chat“ bringt Sie zurück zu Ihrem letzten Chat.',
      },
      projectFiles: {
        title: 'Ablage',
        body: 'Zeichnungen, Gutachten und Schriftverkehr zu diesem Gebäude. Sobald eine Datei gelesen ist, zitiert {productName} daraus, nur in diesem Projekt.',
      },
      filesOrOfficeShelf: {
        title: 'Ablage oder Bürobibliothek?',
        body: 'Entscheidend ist, wem die Unterlage gehört.',
        filesTerm: 'Ablage: dieses Gebäude',
        filesDetail: 'Seine Zeichnungen, Gutachten, Schriftverkehr. Zitiert nur in diesem Projekt.',
        officeShelfTerm: 'Bürobibliothek: das Büro',
        officeShelfDetail: 'Regeldetails, Leistungsbeschreibungen, Vorlagen. Zitiert in jedem Projekt.',
      },
      filesOrOfficeShelfPhone: {
        title: 'Ablage oder Bürobibliothek?',
        body: 'Entscheidend ist, wem die Unterlage gehört. Die Bürobibliothek finden Sie unter „Mehr“.',
      },
      projectSources: {
        title: 'Jede Antwort zeigt ihre Quellen',
        body: 'Jede Aussage zeigt, woher sie stammt: Baurecht, Ablage oder Bürobibliothek, und öffnet die Stelle. Hat {productName} keine Quelle, sagt es das.',
      },
      projectSettings: {
        title: 'Projekte wechseln, Projekt einstellen',
        body: 'Der Projektname öffnet die Liste Ihrer Projekte. Das Zahnrad neben einem Projekt führt zu seinen Einstellungen: Beteiligte einladen, Eckdaten anpassen.',
      },
      projectSettingsPhone: {
        title: 'Beteiligte und Eckdaten',
        body: 'Der Tab „Projekt“ zeigt, wo dieses Projekt steht. Dort laden Sie Beteiligte ein und passen die Eckdaten an.',
      },
    },
  },
}
