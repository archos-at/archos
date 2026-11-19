# Project mail: the E-Mail-Eingang and the E-Mail-Verläufe

Every project can have its own e-mail address. Put it in Cc when you write to
the Behörde, the Statik or the Bauherrschaft, or forward a mail to it. A mail
you send yourself, from your own office address, is **filed directly** when
your domain confirms it and you may file in the project. Every other mail lands
in the project's **E-Mail-Eingang** in Dateien and waits until someone files
it: its text into the conversation's **E-Mail-Verlauf**, its attachments into
the project's folders, each as a new document or the next Fassung of one.

**Nothing from anyone else is filed without a person**, except the text of an
E-Mail-Verlauf you chose to follow. ARCHOS reads a mail only once it is filed.

Project mail is switched on per office. If you do not see „E-Mail-Eingang“ in
Dateien, your office does not have it yet.

---

## The project's address

The address looks like `project+bauplatz-12.k3x7q2m9p4ab@inbox.example.org`: the
project's name and a random part behind the `+`. **What it is for:** put it in Cc when you write to the
Behörde, the Statik or the Bauherrschaft, and their replies land in the
E-Mail-Eingang; forward documents from your mail program to it. Your own mail
is filed directly (below); everything else waits for a person.

Find it on the project overview (the tile „E-Mail-Adresse des Projekts“, for
whoever may decide the project's mail), under **Adresse** in the
E-Mail-Eingang, in Dateien under the upload menu (**Per E-Mail senden …**) and
under **Einstellungen › Dokumente**, each with **Kopieren** and **Als Kontakt
sichern** (a contact card for your mail program).

- Whoever manages the project creates the address, in the dialog or under
  **Einstellungen › Dokumente**. Until then the dialog says the project has
  none.
- Anyone who knows the address can send mail to it. That is the point: when
  the project is in Cc, the Statik's reply-all arrives too. It is also why
  only a member's own, confirmed mail is filed directly.
- A leaked address is replaced with **Neue Adresse erzeugen …**. The old
  address stops working at once (mail to it bounces), and everyone who follows
  an E-Mail-Verlauf of the project stops following it. Give the new address to
  everyone who sends documents to the project.
- **Ausschalten …** switches the address off. Mail already waiting stays.
- **Your office already has a project address** (projekt-x@ihr-buero.at, used
  for all project mail or put in Cc)? Keep it. Redirect it to the project's
  address with an Outlook rule („an eine Person oder öffentliche Gruppe
  umleiten“, not „weiterleiten“: a forwarded mail comes from the mailbox, not
  from its sender), and enter it under **Einstellungen › Dokumente ›
  Bestehende E-Mail-Adressen für das Projekt** (whoever manages the project; at most ten). Mail
  to it then counts as sent to the project, so your own mail is filed directly.
  The card shows both setups, Cc and redirect, in a line each to copy.

Do not send fee, contract or personnel mail to the project's address: everyone
who may add documents to the project sees what waits there.

## Who sees the E-Mail-Eingang

Everyone who may add documents to the project sees the E-Mail-Eingang and may
file or dismiss what waits there. Where a file goes still depends on the
folder: you can only file into folders you may write in. Suggestions never name
a folder you cannot see.

You are told in the **Postfach** when mail waits: „2 E-Mails an „Bauplatz 12“
warten auf Ablage“. The notice never shows a sender, a subject or a file name.
When you sent the mail yourself, from your office address, and may file in the
project, the notice and the outcome come to you; otherwise the notice goes to
everyone who may add documents to the project, and you hear why your mail
waits.

## What a mail shows

Each mail opens with one verdict on its sender, in three levels; „Details“
names the domain and what its signature said („Domain bestätigt:
statik-weber.at hat die E-Mail signiert (DKIM)“):

| Verdict | Meaning |
|---|---|
| **Echte Adresse** | The sender's domain signed the mail (DKIM). This proves the domain, not the person who wrote it |
| **Absender nicht überprüfbar** | The domain did not sign it. Common for small offices and no alarm: ARCHOS suggests nothing and pre-selects no E-Mail-Verlauf |
| **Adresse von {Name}, nicht überprüfbar** / **Ihre Adresse, nicht überprüfbar** | The address is a member's (or yours), but the domain did not sign it. You file it once you checked it is from them, or, if it is yours, once you confirm you sent it |
| **Ihre eigene E-Mail (Bcc)** | A copy of a mail you sent to others, with the project in Bcc |
| **Vorsicht: mögliche Fälschung** | The domain rejected the mail, or a member's name appears on an address that is not theirs. Only this level is red |

**A mail that poses as someone is a stop.** It opens behind a warning, „Verwerfen“
is the first button, nothing is pre-selected, ARCHOS suggests nothing, and it
can never be filed together with other mails. This is how payment-change fraud
starts: check any change of bank details by phone, never by replying.

Other lines you may see: „An andere Empfänger adressiert“ (the project was not
among the signed recipients), „Datum liegt mehr als 7 Tage vor dem Eingang“,
„Liegt schon in einem E-Mail-Verlauf“ (this mail's text is filed already), and
„Von … · Domain nicht bestätigt · weitergeleitet von …“ for a forwarded mail:
who wrote it is read from the forwarded text and checked by nobody, since the
domain confirms only the forward.

The mail's text is shown as plain text: links are not opened, and nothing from
outside is loaded. Long text folds; „Zitierten Text anzeigen“ shows what the
sender quoted.

## Filed directly

A mail is **filed directly**, as you and without a click, when all of this
holds: it comes from your own address, you may file in the project, your
domain signed it (DKIM, below; a subdomain's or the organizational domain's
signature counts, as DMARC counts it), the project's address or one of your
office's registered project addresses is in To or Cc, and it is
neither sent automatically nor oddly dated nor already known. Its text and
attachments go where they would be suggested, and the Postfach tells you („Ihre
E-Mail an „…“ wurde direkt abgelegt“). A part that needs a look, or has no
place, waits in the E-Mail-Eingang.

A Bcc copy is not filed directly: whoever received your mail could send it on
to the project unchanged, and that looks the same. Such a mail, and one your
domain did not confirm, waits for you alone, and the Postfach asks you
whether you sent it („Haben Sie eine E-Mail an das Projekt „…“ gesendet?
Sonst verwerfen“). Only you can file it (tick „Ja, ich habe diese E-Mail
gesendet“, then „Ablegen“) or restore it; the others in the project see whom it waits for and
can only dismiss it. If you did not send it, dismiss it: someone is using your
address.

## Bereit and Braucht Sie

The waiting mails stand under up to three headings. **Bereit** means the sender's
domain is confirmed, every part has a suggested place, and nothing needs
checking. „Wie vorgeschlagen ablegen“ on such a row files it in one press,
without a confirmation; the mail is read again first, and if it changed
meanwhile („Anhang wird noch geprüft …“) nothing is filed and you are told
why. With two or more ready mails, „Alle {n} wie vorgeschlagen ablegen“ files
them after a confirmation grouped by destination (at most 20 at a time).

Under **Braucht Sie** each mail says what it needs: „Haben Sie sie gesendet?
Bestätigen Sie es“ (your own mail your domain did not confirm), „Absender
prüfen“, „Anhang prüfen“, „Anhang wird noch geprüft …“, „E-Mail-Verlauf
wählen“, „Ordner wählen“ or „Projekt ist abgeschlossen“. „Nicht direkt
abgelegt“ marks a member's confirmed mail that direct filing left for a
person. A colleague's mail their domain did not confirm says „Absender
prüfen“: check it is from them, then file it („Ich habe geprüft, dass diese
E-Mail von {Name} ist“). Under **Wartet auf andere** stand mails posing as
another member that only that member can file („Wartet auf {Name}“): you can
dismiss them, and then only they can restore them. A mail that poses as someone never gets
the button. Mail from an unconfirmed domain and automatic mail sit below, in a
folded group. „Bearbeitet“ lists what was filed, dismissed or expired, each row
saying which. The Postfach's „E-Mails warten“ opens the list at „Bereit“.

## Filing a mail

Open a mail: it shows the mail and nothing to fill in. Under the subject one
line names the sender („{Name} ‹{Adresse}›“), the verdict on the sender, and
when it arrived; „Details“ shows the domain and its signature, the recipients,
the dates, how long it still waits, and the original. A mail from outside the
office says until when it waits and that ARCHOS reminds you five days before;
in its last week the date moves up into the header. Then the text, and the
attachments with one quiet line each saying what ARCHOS proposes for it:
„Kommt nach Behörde/Bescheide · Bescheid“, „Wird Fassung 4 von S-101_C.pdf“,
„Bleibt weg – liegt schon im Projekt“, or „Offen: Ordner wählen“ where there
is something to decide.

At the foot stand two buttons. **Verwerfen** says no to the whole mail; the
line beside it says it acts only in ARCHOS, never in your mail program, and
can be undone for seven days, except for a sender that cannot be verified,
whose mail is deleted at once. **Einordnen …** opens the filing, filled in
with ARCHOS's proposal. It asks only what needs you, one question per screen
(„Schritt 2 von 3“ when there is more than one):

1. **Absender**, only when the sender needs your confirmation: „Ich kenne den
   Absender und vertraue dieser E-Mail“, „Ja, ich habe diese E-Mail gesendet“
   for your own address, „Ich habe geprüft, dass diese E-Mail von {Name} ist“
   for a colleague's.
2. **E-Mail-Text**, only when its E-Mail-Verlauf is not certain (none
   pre-selected, or a match ARCHOS is unsure of) or the content check found
   something in it: „An E-Mail-Verlauf „Stellplatznachweis“ anfügen“ or „Als
   neuen E-Mail-Verlauf ablegen“ with a name you confirm.
3. **Anhänge**, only for the attachments that need you: one without a folder,
   one ARCHOS is still reading, a plan only its name ties to an earlier one,
   one the defaults left out. An attachment without a folder gets the
   project's folders right in the step, with the folders this mail's other
   attachments go to on top; with several, „Alle 3 in diesen Ordner“ sends
   them all with one choice. The attachments with a sure proposal are folded
   into „4 weitere wie vorgeschlagen · Ändern“.
4. **Übersicht**, always: one sentence per part. „E-Mail-Text → an
   E-Mail-Verlauf „Stellplatznachweis“ anfügen“, „Bescheid_MA37.pdf →
   Behörde/Bescheide · Bescheid“, „Bescheid_alt.pdf bleibt weg – liegt schon
   im Projekt“. Under it: what „bleibt weg“ is dismissed when you file, and
   for how long it can be restored. When the text goes into an
   E-Mail-Verlauf: „Weitere Antworten in diesem E-Mail-Verlauf legt ARCHOS
   ohne Klick ab.“ Then **Ablegen**.

A mail with nothing to decide opens straight on „Übersicht“: „Einordnen“, then
„Ablegen“. „Zurück“ goes back a step, „E-Mail-Text ändern“ and „Anhänge
ändern“ in „Übersicht“ reach a step that was not asked, and Escape closes the
dialog without filing anything: what you chose stays while the mail is open.
On a phone the dialog takes the whole screen.

Filing is an ordinary upload in your name: the office's name check, content
check, accepted file types, storage quota and folder rights apply. It is
quiet: no upload summary and no „Neue Fassung“ notice per reply. A filed
document is published with you as the person who approved it, like any upload;
its preview says which mail it came with.

**When something needs your confirmation.** A mail from an unconfirmed domain,
a mail not addressed to the project, an old date, a file
with macros or a name that does not match its content, and a thread match the
sender's signature does not cover each need a tick before filing. These mails
are filed one at a time, never in a group.

**When the content check finds something in the text** (an IBAN, a social
security number, one of your office's terms), the „E-Mail-Text“ step asks one more
thing: „Unkenntlich machen“ (the default: the findings are masked in the
E-Mail-Verlauf, the original stays unchanged) or „Ungekürzt ablegen“, which
holds the E-Mail-Verlauf it goes into until someone checks it. To keep an
existing Verlauf free, file the full text „Als neuen E-Mail-Verlauf“.

**When the name check stops a file name**, the attachment is unchecked with
„Namensprüfung: „…““ in the „Anhänge“ step, and you may file it anyway with
„Trotzdem ablegen“. The override is recorded.

**A mail that poses as someone** keeps „Verwerfen“ as its first button.
„Einordnen …“ appears only after „Trotzdem ablegen …“, and its first step asks
„Haben Sie telefonisch geprüft, dass die E-Mail echt ist?“; its last button
reads „Als echt ablegen“.

**Keyboard:** E opens „Einordnen“, and in „Übersicht“ E files.

**Several mails at once.** Select mails (or press X) and use „Wie vorgeschlagen
ablegen“: it files every selected mail as its defaults and ARCHOS's suggestions
say, after a confirmation grouped by destination. It is offered only when every
selected mail is complete: nothing to confirm, a folder for every attachment.
Ready replies of one conversation are one group under „Bereit“: „Diese 4 wie
vorgeschlagen ablegen“. Its replies that need a look are a group under
„Braucht Sie“ with „Der Reihe nach ansehen“.

**After filing** each part says where it went: „Abgelegt in
Behörde/Bescheide · Fassung 1 · Öffnen“, „In E-Mail-Verlauf
„Stellplatznachweis“ abgelegt · Öffnen“. Where you may not read
the folder it says only „In Dateien abgelegt“. A toast lists every part. A
filing has no undo; „Öffnen“ takes you to the document.

## Dismissing, expiring, restoring

- „Verwerfen“ dismisses a mail. It can be restored for **7 days** under
  „Bearbeitet“, then it is deleted. A dismissed mail from outside the office
  whose domain is not confirmed is deleted at once.
- A mail nobody decides **expires after 30 days**, a mail from outside the
  office after **14 days**. You are told five days before. An expired mail of a
  member can still be restored for 7 days; an expired mail from outside the
  office is gone.
- A closed project still receives mail and shows „Projekt ist abgeschlossen –
  wieder öffnen, um abzulegen“. Dismissing is possible; reopen the project to
  file.

## Malware checks

Every attachment, and every mail as a whole, is checked for malware on
ARCHOS's own servers before anyone can file or open it; while it runs the
attachment says „Wird auf Schadsoftware geprüft …“, and a clean one says
nothing. An infected attachment („Schadsoftware gefunden“) cannot be filed;
the mail can only be dismissed. A check that failed is repeated by itself.
Previews before filing are drawn for images and PDFs only; other files show
their icon until filed.

## Files the office does not accept

A file type your office does not file (a DWG, a ZIP archive, an Outlook
attachment) is listed as „… · Dateityp wird in diesem Büro nicht abgelegt · im
Original enthalten“. It cannot be filed, but it stays inside the mail's
original when you file the text.

## ARCHOS's suggestion

For each mail, ARCHOS suggests a folder and a Dokumentart
for each attachment („Vorschlag von ARCHOS“), and a folder for a new
E-Mail-Verlauf. It reads only the file names, the subject (masked by your
office's content check) and the sender's domain, never the text or the files.
There is no suggestion for automatic mail or a mail posing as someone. A
suggestion only pre-fills: you still file the mail.

## The E-Mail-Verlauf

A filed conversation is one document of Dokumentart *Korrespondenz*. Each
filed e-mail is a section headed with its time, its sender and the confirmed
domain („14.10.2026 09:12 · Mag. Huber (ma37.wien.gv.at)“), or „Domain nicht
bestätigt“ when it was not confirmed. Each section says when it arrived
(„eingegangen …“). Each later e-mail adds a Fassung, and the newest Fassung
holds the whole conversation. ARCHOS answers from it and cites one e-mail:
„laut E-Mail von … vom …“.

A Bescheid that arrived by e-mail is a **copy** („Kopie per E-Mail“), not its
Zustellung. Fristen run from the Zustellung.

Open the Verlauf in Dateien and choose the **E-Mails** tab in its preview:

- one row per e-mail, newest first, with „ab Fassung N“, when it arrived, the
  domain label and how it was filed;
- its attachments, each linked to the document it became, or „nicht abgelegt“
  with the reason;
- **Original (.eml)**: the mail exactly as it arrived (below);
- **Vergleichen**: this e-mail's Fassung against the one before;
- **Herauslösen …**: move an e-mail filed into the wrong conversation into
  another Verlauf or a new one. The Verlauf gets a new Fassung without it; its
  earlier Fassungen keep it.

A file that came by e-mail shows under its preview header which e-mail it
came with, and „Im E-Mail-Verlauf ansehen“ leads there.

## The original (.eml)

ARCHOS keeps every filed e-mail exactly as it arrived, beside its section, as
evidence: the signature can be checked again on these bytes, and pictures in
the text and files that could not be filed are in it. Whoever may read the
E-Mail-Verlauf may download it. It is checked for malware again on every
download, and refused if it is not clean. It opens in your mail program, which
may load pictures from outside. No AI model ever reads it. It is kept as long
as the E-Mail-Verlauf.

## Following an E-Mail-Verlauf

After filing, or in the E-Mails tab, „Diesem E-Mail-Verlauf folgen“ makes
later replies' **text** join the Verlauf without a click, in your name. It
applies only to replies from confirmed domains that already write in the
conversation, whose reference to it is signed, with nobody new in it, and with
nothing the name or content check would stop. Everything else waits as usual.
**Attachments always wait** in the E-Mail-Eingang.

- A follow runs 60 days; „Verlängern“ extends it, up to 180 days from its
  start. You are told five days before it ends.
- „Nicht mehr folgen“ ends it. Whoever manages the project can end anyone's
  follow („Beenden“ under „Wer folgt“).
- It also ends when you lose access to the project or the Verlauf's folder,
  when the project's address is replaced, when an e-mail is herausgelöst from
  that Verlauf, when the Verlauf is deleted, or when the project is closed
  („Das Projekt wurde abgeschlossen“). Reopening the project starts no follow
  again: following is your own act.
- The Postfach tells you, once a day per Verlauf, when replies were added („Eine Antwort wurde einem E-Mail-Verlauf in … angefügt“).

## Tips

- **Cc the project on your own mail, not Bcc.** In Cc your mail is filed
  directly; a Bcc copy („Ihre eigene E-Mail (Bcc)“) waits until you confirm
  you sent it.
- **Let your domain sign its mail.** Whoever manages the project sees under
  **Einstellungen › Dokumente** how much of your office's own mail was „Domain
  bestätigt“ in the last 30 days. A member's mail their domain does not sign is
  never filed directly and waits for that member each time; ask whoever runs
  your mail to enable DKIM (the „so richten Sie es ein“ link on that card).
- Large sets of documents do not fit: a mail may be at most 25 MB, with about
  18 MB of attachments. Upload larger files directly.

## Outlook archives

An Outlook archive you import (Dateien › Outlook-Archiv importieren) files its
e-mails' text into the same E-Mail-Verläufe, and skips any e-mail the project
already has. Importing is your decision, so an archive does not wait in the
E-Mail-Eingang. Its sections say „aus dem Outlook-Archiv“, its rows in the
E-Mails tab „Aus dem Outlook-Archiv · nicht geprüft“, and they have no
original.

## For agents

Everything here is also an operation of ARCHOS's MCP server, in the `mail`
domain: an outside agent acting for you can list and read waiting mail and
file it, but only on your own yes, and it never gets an original. ARCHOS
proposes a filing as a card you confirm. See
[Connect your agent](connect-your-agent.md).
