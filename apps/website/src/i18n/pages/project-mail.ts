/**
 * Copy of /e-mail-eingang/ (/en/project-mail/), the help page for project mail
 * (ADR-0137), both locales. `{name}` is the brand name, filled by `withName`;
 * `{domain}` is the brand domain, filled by the view; project mail is received
 * on its `inbox.` subdomain (ADR-0138). Two readers land here:
 * a member of an office that uses the product, from „Anleitung“ in the address
 * dialog, and somebody whose mail was not taken, from the link in the reply. So
 * it says plainly what happens to a mail sent to a project address.
 *
 * The `dkim` section keeps its id: the address dialog links to `#dkim`
 * (`anchors` in `contracts/public-site.json`, held here by `../public-site.test.ts`).
 */

export interface ProjectMailSection {
  /** The section's anchor, stable: links point at it. */
  id: string;
  heading: string;
  paragraphs: string[];
}

const de = {
  title: 'E-Mails an ein Projekt: der E-Mail-Eingang',
  description:
    'Was mit einer E-Mail an die Adresse eines Projekts geschieht: Wer im Projekt ablegen darf und von der eigenen, bestätigten Adresse sendet, legt direkt ab. Alles andere wartet, bis eine Person es ablegt. Jede E-Mail wird auf Schadsoftware geprüft, keine von einem KI-Modell gelesen.',
  heading: 'E-Mails an ein Projekt',
  lede: 'Für Büros, die die Funktion freigeschaltet haben, hat jedes Projekt in {name} eine eigene E-Mail-Adresse. Was ein Mitglied, das im Projekt ablegen darf, von der eigenen Adresse sendet und dessen Domain bestätigt, wird direkt abgelegt. Alles andere wartet im E-Mail-Eingang des Projekts, bis eine Person es ablegt.',
  sections: [
    {
      id: 'ablauf',
      heading: 'Was mit einer E-Mail geschieht',
      paragraphs: [
        'Eine E-Mail an die Adresse eines Projekts (etwa project+bauplatz-12.k3x7q2m9p4ab@inbox.{domain}) wird auf zwei Wegen Teil des Projekts. Sendet sie ein Mitglied des Büros, das im Projekt ablegen darf, und belegt seine Domain, dass sie von ihm kommt, legt {name} sie direkt in seinem Namen ab (siehe „Direkt abgelegt“). Jede andere E-Mail wartet im E-Mail-Eingang, bis zu 30 Tage, eine E-Mail von außerhalb des Büros 14 Tage. Dort entscheidet eine Person, die Unterlagen in das Projekt ablegen darf, über jeden Teil: den Text der E-Mail und jeden Anhang.',
        'Der Text kommt in den E-Mail-Verlauf des Gesprächs: ein Dokument je Konversation, in dem jede abgelegte E-Mail ein Abschnitt ist. Anhänge kommen in die Ordner des Projekts. Was niemand ablegt, wird verworfen oder läuft ab und wird gelöscht.',
        '{name} verschickt keine Antworten und keine Eingangsbestätigungen.',
      ],
    },
    {
      id: 'zweck',
      heading: 'Wofür die Adresse da ist',
      paragraphs: [
        'Setzen Sie die Adresse des Projekts in Cc, wenn Sie an Behörde, Statik oder Bauherrschaft schreiben: Ihre eigene E-Mail wird direkt abgelegt, die Antworten der anderen landen im E-Mail-Eingang des Projekts. Unterlagen aus Ihrem Mailprogramm können Sie an sie weiterleiten.',
        'Sie finden die Adresse auf der Projektübersicht, unter „Adresse“ im E-Mail-Eingang, unter „Per E-Mail senden …“ beim Hochladen und in den Projekteinstellungen unter Dokumente.',
      ],
    },
    {
      id: 'direkt',
      heading: 'Direkt abgelegt',
      paragraphs: [
        'Direkt abgelegt wird eine E-Mail, wenn alles zusammenkommt: Sie kommt von der Adresse eines Mitglieds, das im Projekt ablegen darf. Die Domain genau dieser Adresse hat sie bestätigt (DKIM, siehe unten). Die Adresse des Projekts steht in An oder Cc. Und sie ist weder automatisch versandt noch ungewöhnlich datiert noch schon bekannt. Dann legt {name} Text und Anhänge in Ihrem Namen ab, wie vorgeschlagen, und sagt es Ihnen im Postfach. Ein Anhang, den jemand ansehen muss oder für den es kein Ziel gibt, wartet im E-Mail-Eingang.',
        'Eine Kopie in Bcc wird nicht direkt abgelegt. Wer Ihre E-Mail bekommen hat, könnte sie unverändert an das Projekt weiterschicken, und das sieht genauso aus wie Ihre Kopie. Bei einer Bcc-Kopie fragt {name} Sie deshalb, ob Sie sie gesendet haben. Dasselbe gilt für automatisch versandte E-Mails, etwa von einem Scanner oder einer Regel.',
      ],
    },
    {
      id: 'gesendet',
      heading: 'Haben Sie diese E-Mail gesendet?',
      paragraphs: [
        'Trägt eine E-Mail die Adresse eines Mitglieds, das im Projekt ablegen darf, belegt aber nichts, dass es sie gesendet hat, fragt {name} dieses Mitglied im Postfach: „Haben Sie diese E-Mail gesendet?“. Das ist der Fall, wenn die Domain sie nicht bestätigt hat, wenn sie in Bcc kam, automatisch versandt oder ungewöhnlich datiert ist. Nur dieses Mitglied kann sie ablegen, mit „Ja, ich habe diese E-Mail gesendet“. Alle anderen im Projekt sehen, auf wen sie wartet, und können sie verwerfen. Wiederherstellen kann sie danach nur das Mitglied selbst.',
        'Haben Sie eine solche E-Mail nicht gesendet, verwerfen Sie sie: Dann verwendet jemand Ihre Adresse, und so beginnen Betrugsversuche mit Kontoänderungen. Gehört ein Mitglied nicht mehr zum Büro, legt niemand seine wartenden E-Mails ab. Gehört eine davon ins Projekt, laden Sie ihr Original herunter und leiten Sie es selbst an das Projekt weiter.',
        'Ein Mitglied, das im Projekt nicht ablegen darf: Seine E-Mail wartet auf die, die es dürfen, und es erfährt das im Postfach. Eine E-Mail von außerhalb des Büros wartet 14 Tage und läuft dann ab. Dem Absender antwortet {name} in keinem Fall.',
      ],
    },
    {
      id: 'bereit',
      heading: 'Bereit und Braucht Sie',
      paragraphs: [
        'Im E-Mail-Eingang stehen die wartenden E-Mails unter zwei Überschriften. „Bereit“ heißt: die Domain des Absenders ist bestätigt, für jeden Teil ist ein Ziel vorgeschlagen, und nichts ist zu prüfen. Ein Klick auf „Wie vorgeschlagen ablegen“ legt eine solche E-Mail ab; „Alle … ablegen“ legt mehrere ab und fragt vorher nach.',
        'Unter „Braucht Sie“ steht bei jeder E-Mail, was noch fehlt: „Haben Sie sie gesendet? Bestätigen Sie es“, „Absender prüfen“, „Anhang prüfen“, „Anhang wird noch geprüft …“, „E-Mail-Verlauf wählen“, „Ordner wählen“ oder „Projekt ist abgeschlossen“. „Nicht von selbst abgelegt“ heißt: Die E-Mail eines Mitglieds hätte direkt abgelegt werden können, doch etwas daran braucht eine Person.',
        'Unter „Wartet auf andere“ stehen E-Mails, die nur das Mitglied ablegen kann, dessen Adresse sie tragen. Sie können sie verwerfen.',
      ],
    },
    {
      id: 'nach-dem-ablegen',
      heading: 'Nach dem Ablegen',
      paragraphs: [
        'Bei jedem abgelegten Teil steht, wo er liegt und welche Fassung er geworden ist, etwa „Abgelegt in Behörde · Fassung 1“ oder „In E-Mail-Verlauf „Stellplatznachweis“ abgelegt · Fassung 4“. „Öffnen“ führt hin. Rückgängig machen lässt sich eine Ablage nicht.',
      ],
    },
    {
      id: 'folgen',
      heading: 'Einem E-Mail-Verlauf folgen',
      paragraphs: [
        'Wer einem E-Mail-Verlauf folgt, lässt den Text späterer Antworten von bestätigten Absendern ohne eigenen Klick anfügen; Anhänge warten weiter auf eine Person. Das Folgen endet nach höchstens 180 Tagen, wenn die Adresse des Projekts ersetzt wird, wenn eine E-Mail aus dem Verlauf herausgelöst wird, und wenn das Projekt abgeschlossen wird. Wird es wieder geöffnet, folgt niemand von selbst wieder.',
      ],
    },
    {
      id: 'sicherheit',
      heading: 'Prüfungen vor der Ablage',
      paragraphs: [
        'Jeder Anhang und jede E-Mail als Ganzes werden auf Schadsoftware geprüft, bevor jemand sie öffnen oder ablegen kann. Jede E-Mail zeigt, ob die Domain des Absenders sie signiert hat („Domain bestätigt“). Das belegt die Domain, nicht die Person.',
        'Solange eine E-Mail wartet, liest kein KI-Modell ihren Text oder ihre Anhänge. Für einen Ablagevorschlag sieht {name} nur Dateinamen, den Betreff und die Domain des Absenders. Das Original der E-Mail (.eml) wird als Nachweis aufbewahrt und von keinem Modell gelesen.',
      ],
    },
    {
      id: 'abgewiesen',
      heading: 'Ihre E-Mail kam zurück',
      paragraphs: [
        'Eine E-Mail wird abgewiesen, wenn die Adresse nicht (mehr) existiert, das Büro die Funktion nicht nutzt oder die E-Mail größer als etwa 25 MB ist. Die Meldung nennt den Grund absichtlich nicht. Fragen Sie im Büro nach der aktuellen Adresse des Projekts; eine Adresse kann ersetzt worden sein.',
      ],
    },
    {
      id: 'dkim',
      heading: 'Domain bestätigt: E-Mails signieren (DKIM)',
      paragraphs: [
        '{name} erkennt eine Domain als bestätigt, wenn sie die E-Mail mit DKIM signiert hat, mit dem Schlüssel genau der Domain der Absenderadresse. Nur dann wird die E-Mail eines Mitglieds direkt abgelegt. Eine E-Mail mit der Adresse einer Kollegin oder eines Kollegen, die Ihre Domain nicht bestätigt, kann nur diese Person selbst ablegen, und {name} schlägt für sie keinen E-Mail-Verlauf vor.',
        'Ob Ihre Domain signiert, sagt Ihnen, wer Ihre E-Mail betreut: Microsoft 365, Google Workspace und die meisten Anbieter bieten DKIM an und brauchen dafür einen Eintrag im DNS Ihrer Domain. Wer das Projekt verwaltet, sieht in den Projekteinstellungen unter Dokumente, wie viele E-Mails Ihres Büros der letzten 30 Tage bestätigt waren.',
      ],
    },
    {
      id: 'tipps',
      heading: 'Tipps',
      paragraphs: [
        'Setzen Sie die Adresse des Projekts in Cc, nicht in Bcc, wenn Sie selbst schreiben: In Cc wird Ihre E-Mail direkt abgelegt, bei einer Bcc-Kopie fragt {name} Sie erst, ob Sie sie gesendet haben.',
        'Senden Sie keine Honorar-, Vertrags- oder Personalfragen an die Adresse des Projekts: Alle, die Unterlagen in das Projekt ablegen dürfen, sehen, was dort wartet.',
        'Ein Bescheid, der per E-Mail kommt, ist eine Kopie, keine Zustellung. Fristen laufen ab der Zustellung.',
      ],
    },
  ] satisfies ProjectMailSection[],
  privacyLink: 'Datenschutzerklärung',
}

const en: typeof de = {
  title: 'Mail to a project: Project mail',
  description:
    'What happens to a mail sent to a project’s address: someone who may file in the project files directly from their own verified address. Everything else waits until a person files it. Every mail is scanned for malware, and none is read by an AI model.',
  heading: 'Mail to a project',
  lede: 'For offices that have switched it on, every project in {name} has its own e-mail address. What a member who may file in the project sends from their own address, verified by their domain, is filed directly. Everything else waits in the project until a person files it.',
  sections: [
    {
      id: 'ablauf',
      heading: 'What happens to a mail',
      paragraphs: [
        'A mail sent to a project’s address (such as project+bauplatz-12.k3x7q2m9p4ab@inbox.{domain}) becomes part of the project in one of two ways. When a member of the office who may file in the project sends it and their domain proves it came from them, {name} files it directly as them (see “Filed directly”). Every other mail waits in Project mail, for up to 30 days, a mail from outside the office for 14 days. There a person who may add documents to the project decides on each part: the mail’s text and each attachment.',
        'The text goes into the conversation’s mail thread: one document per conversation, each filed mail a section of it. Attachments go into the project’s folders. What nobody files is dismissed or expires and is deleted.',
        '{name} sends no replies and no receipts.',
      ],
    },
    {
      id: 'zweck',
      heading: 'What the address is for',
      paragraphs: [
        'Put the project’s address in Cc when you write to the authority, the structural engineer or the client: your own mail is filed directly, and the others’ replies land in the project’s mail. You can forward documents from your mail program to it.',
        'You find the address on the project overview, under “Address” in the project’s mail, under “Send by mail …” when uploading, and in the project settings under Documents.',
      ],
    },
    {
      id: 'direkt',
      heading: 'Filed directly',
      paragraphs: [
        'A mail is filed directly when everything comes together: it comes from the address of a member who may file in the project. The domain of exactly that address verified it (DKIM, see below). The project’s address is in To or Cc. And it was not sent automatically, is not oddly dated and is not already known. Then {name} files its text and attachments as you, as suggested, and tells you in your inbox. An attachment that someone needs to look at, or that has nowhere to go, waits in Project mail.',
        'A copy in Bcc is not filed directly. Whoever received your mail could send it on to the project unchanged, and that looks exactly like your copy. For a Bcc copy {name} therefore asks you whether you sent it. The same holds for mail sent automatically, by a scanner or a rule for instance.',
      ],
    },
    {
      id: 'gesendet',
      heading: 'Did you send this mail?',
      paragraphs: [
        'When a mail carries the address of a member who may file in the project, but nothing proves they sent it, {name} asks that member in their inbox: “Did you send this mail?”. That is the case when the domain did not verify it, when it came in Bcc, was sent automatically or is oddly dated. Only that member can file it, with “Yes, I sent this mail”. Everyone else in the project sees whom it waits for and can dismiss it. Afterwards only the member can restore it.',
        'If you did not send such a mail, dismiss it: someone is using your address, and this is how fraud with changed bank details begins. When a member has left the office, nobody files their waiting mail. If one of them belongs in the project, download its original and forward it to the project yourself.',
        'A member who may not file in the project: their mail waits for those who may, and they are told so in their inbox. A mail from outside the office waits 14 days and then expires. {name} never replies to its sender.',
      ],
    },
    {
      id: 'bereit',
      heading: 'Ready and Needs you',
      paragraphs: [
        'The waiting mails stand under two headings. “Ready” means the sender’s domain is verified, every part has a suggested place, and nothing needs checking. “File as suggested” files such a mail in one press; “File all …” files several and asks first.',
        'Under “Needs you” each mail says what it still needs: confirming you sent it, checking the sender or an attachment, an attachment still being scanned, choosing a mail thread or a folder, or a closed project. “Not filed by itself” means a member’s mail could have been filed directly, but something about it needs a person.',
        'Under “Waiting for others” stand mails only the member whose address they carry can file. You can dismiss them.',
      ],
    },
    {
      id: 'nach-dem-ablegen',
      heading: 'After filing',
      paragraphs: [
        'Each filed part says where it went and which Fassung (version) it became, and “Open” takes you there. A filing cannot be undone.',
      ],
    },
    {
      id: 'folgen',
      heading: 'Following a mail thread',
      paragraphs: [
        'Whoever follows a mail thread lets the text of later replies from verified senders be added without a press of their own; attachments still wait for a person. Following ends after at most 180 days, when the project’s address is replaced, when a mail is detached from the thread, and when the project is closed. Reopening the project starts no follow again.',
      ],
    },
    {
      id: 'sicherheit',
      heading: 'Checks before filing',
      paragraphs: [
        'Every attachment and every mail as a whole is scanned for malware before anyone can open or file it. Each mail shows whether the sender’s domain signed it (“Domain verified”). That proves the domain, not the person.',
        'While a mail waits, no AI model reads its text or its attachments. For a filing suggestion {name} sees only file names, the subject and the sender’s domain. The mail’s original (.eml) is kept as evidence and read by no model.',
      ],
    },
    {
      id: 'abgewiesen',
      heading: 'Your mail came back',
      paragraphs: [
        'A mail is refused when the address does not exist (any more), the office does not use the feature, or the mail is larger than about 25 MB. The message deliberately does not say which. Ask the office for the project’s current address; an address may have been replaced.',
      ],
    },
    {
      id: 'dkim',
      heading: 'Domain verified: signing your mail (DKIM)',
      paragraphs: [
        '{name} treats a domain as verified when it signed the mail with DKIM, with the key of exactly the sender address’s domain. Only then is a member’s mail filed directly. A mail carrying a colleague’s address that your domain does not verify can be filed only by that colleague, and {name} suggests no mail thread for it.',
        'Whoever runs your e-mail can tell you whether your domain signs: Microsoft 365, Google Workspace and most providers offer DKIM and need an entry in your domain’s DNS for it. Whoever manages the project sees in the project settings under Documents how much of your office’s mail of the last 30 days was verified.',
      ],
    },
    {
      id: 'tipps',
      heading: 'Tips',
      paragraphs: [
        'Put the project’s address in Cc, not Bcc, when you write yourself: in Cc your mail is filed directly; for a Bcc copy {name} first asks whether you sent it.',
        'Do not send fee, contract or personnel matters to the project’s address: everyone who may add documents to the project sees what waits there.',
        'A Bescheid that arrives by e-mail is a copy, not its formal delivery (Zustellung). Deadlines run from the Zustellung.',
      ],
    },
  ],
  privacyLink: 'Privacy policy',
}

export default { de, en };
