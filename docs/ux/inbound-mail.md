# Project mail: the E-Mail-Eingang, the E-Mails tab and provenance

**Date:** 2026-10-27, the detail and the E-Mails tab reworked 2026-11-19; the decision on one mail said in plain words, and the address, the list and the E-Mails tab again after a cold read, 2026-11-19 (round 2); the mail read in the pane and filed through „Einordnen“ 2026-11-19 (round 3); the list says where each ready mail goes and how mail gets here; filed mail in Dateien, the Verlauf's record, the tab's row and the Postfach's words after an end-to-end walk, 2026-11-19 (round 4); a plan's next index filed as its next Fassung by default, filing replies without a click as one switch in both places, the dialog naming its mail, and every dismissal restorable for 7 days, 2026-11-19 (round 5); a plan's earlier index found on the server and said by its index, the fraud report as the stop's primary, filing replies without a click as one quiet line in „Übersicht“, and why a followed Verlauf's mail still waits, 2026-11-19 (round 6)
**Status:** Implemented, the W1 rework included
**Surfaces:** Dateien › E-Mail-Eingang (`/app/projects/[id]/files/mail`, `…/mail/[mailId]`), the address dialog and the settings card, a Verlauf in a folder's listing, the „E-Mails“ tab of a Verlauf's preview, the provenance row of a document that came by mail, the Postfach rows
**Preview:** `/dev/inbound-mail?variant=…`, `/dev/inbound-mail-detail?variant=…`, `/dev/inbound-mail-address?variant=…[&dialog=1]`, `/dev/mail-thread?variant=…` (the rail beside its Verlauf on a wide screen, alone on a phone, as the preview draws it), `/dev/files-page?project=real&folder=r-korr[&view=list]` (two Verläufe and an attachment in a folder), `/dev/file-preview?variant=mail-thread|mail-attachment` (the preview on the server's own rendition, `renderMailThread`), `/dev/inbox?variant=mail`; each with `&locale=en`, and `&chrome=0` hides the variant strip and the framework's dev indicator (`HiddenDevChrome`; the files page too). The previews share one project („Bauplatz 12 – Wohnbau Seestadt“), one office (Huber Architektur ZT GmbH, the reader Anna Berger, her colleague Miriam Huber; the authority's officer is Mag. Karin Schober), and a clean PDF attachment's bytes are a sample drawn in the browser: a plan sheet for a name with a plan number, else a letter (`useSampleAttachmentUrls`). The variant lists are in each page's header.
**Why:** [ADR-0137](../adr/0137-mail-sent-to-a-project-waits-until-a-person-files-it.md); the flow: [`inbound-mail.md`](../architecture/inbound-mail.md); the words: [`CONTEXT.md`](../../CONTEXT.md#project-mail).

## The rule

> **The server says what a mail asks of a person; the UI shows it.**

Completeness, the defaults (`preselected`), the sender's risk, thread groups
and the forwarded-from line are computed on the server
(`lib/inbound-mail/{sender-risk,review-defaults,thread-groups,forwarded}.ts`)
and carried on the views. The UI never derives them, so the app, an outside
agent and the agent's card see the same mail the same way.

One word per concept (DECISION §3, the i18n file headers say it again):
„E-Mail-Eingang“ is the place, „ablegen“ puts a part into the project,
„verwerfen“ says no to the whole mail, „wiederherstellen“ undoes either for
seven days, the „E-Mail-Verlauf“ is the conversation's document, and a mail's
text is *angefügt* to it („An E-Mail-Verlauf „…“ anfügen“). „Fassung“ is said
only of a document's next state (an attachment's „wird Fassung 4 von
S-101_C.pdf“), never of a text joining its Verlauf: a reader took „wird
Fassung 4“ for a plan's (round 2). The sender line names a domain, never a person. Never
„Projektadresse“, „Nachricht“ for an e-mail, or „Abgelegt“ as a mail's state.
English copy calls the place „Project mail“.

## Where it is entered

- Dateien's places, as tabs in the section header (`ProjectSectionFrame`,
  the shared `SectionNav`): Ordner · E-Mail-Eingang with a **muted**
  count · Offene Punkte · Papierkorb. The E-Mail-Eingang tab only for whoever
  may decide the project's mail (`requireMailReviewer`, asked once by the
  project layout); its count is the rail's own (`useInboundMailWaitingShown`).
  Every count (the rail, the phone tab bar, the greeting's line, the shelf's
  line, the list's own pill) is what the list shows as rows: waiting mail
  without the automatic group (`waitingShownCount`, `lib/list-sections.ts`).
  A read that stopped at its page says so on every one, the section tab
  included (`SectionNavItem.countMore`; it once said „9“ beside the list's
  „9+“): „50+“ and „Mehr als 50 E-Mails warten auf Ablage“; the list primes the count only from a page it read whole.
  On a phone the tabs are a scrolling strip, hidden on an opened mail.
- The chat's start: under the greeting, the same quiet line as in Dateien,
  while something waits (the UI revision's „what happened since your last
  visit“, its first line).
- A quiet line above the shelf root: „2 E-Mails warten auf Ablage · Ansehen“.
- A muted count on Dateien in the rail and the phone tab bar, its words on
  hover. The Postfach keeps the only ink pill.
- `ProjectMailWaiting` on the project card (`waitingMailCounts`).
- The project overview (Einstellungen › Übersicht): a full-width tile
  „E-Mail-Adresse des Projekts“, „In Cc gesetzt, bringt sie die Antworten von
  Behörde, Statik und Bauherrschaft in den E-Mail-Eingang des Projekts.“, the address (a press copies it), „Als Kontakt sichern“ and the footer
  link „Zum E-Mail-Eingang“. Only for whoever may decide the project's mail and
  only while an address is active; creating one stays in Einstellungen ›
  Dokumente.
- The upload menu „Per E-Mail senden …“ opens the address dialog.
- Settings › Dokumente: the address card (below), with the folded „Für die IT:
  Einrichtung“ holding the redirect and „Bestehende E-Mail-Adressen für das
  Projekt“ (managers add and remove, members read;
  `/dev/inbound-mail-address?variant=forwards`), and at its foot „Adresse
  verwalten“ (managers only): „Neue Adresse erzeugen …“ and „Ausschalten …“.
- The Postfach rows of the seven notices (`/dev/inbox?variant=mail`).
  „E-Mails warten“ opens the list at „Ablagebereit“ (`/files/mail#ready`,
  `lib/inbox/targets.ts`).

## The address dialog

Every door to the address hands it out in one order
(`features/inbound-mail/components/inbound-mail-address.tsx`,
`InboundMailAddressBlock`), because a cold read (2026-11-19: a Projektleiterin
who lives in Outlook, twelve screenshots, no explanation) found the old card a
wall of statistics and setup with the address somewhere inside:

1. One sentence, the card's or dialog's description or the empty page's lead:
   „Setzen Sie diese Adresse in Cc, wenn Sie zum Projekt schreiben. Die
   Antworten landen dann im E-Mail-Eingang unter Dateien.“
2. The address (`EmailAddress` marks where it may wrap: after the `+`, before
   the token's dot and before the `@`, so a phone never splits the domain) and
   „Kopieren“, the primary, „Kopiert“ announced.
3. The other ways to hand it on, each a press with a line under it saying where
   it goes: „Als Kontakt sichern“ („Lädt eine Kontaktkarte (.vcf) für Outlook
   oder Ihr Telefon“) and „Per E-Mail weitergeben …“ („Öffnet eine neue E-Mail
   mit der Adresse, etwa an Ihr Team“: a `mailto:` with the address and the
   sentence, no recipient).
4. The size: „Bis 25 MB pro E-Mail, Anhänge zusammen etwa 18 MB. Eine größere
   E-Mail geht als unzustellbar an den Absender zurück.“ with „Größere Dateien
   direkt hochladen“ (to Dateien; it closes the dialog). True to the receive
   path: Cloudflare and the webhook refuse a larger mail with the reject
   verdict, so its sender's server bounces it
   ([`inbound-mail.md`](../architecture/inbound-mail.md#receiving-the-webhook)).
   Then when mail last arrived and how many automatic replies were dropped in
   30 days.
5. In the dialog only, who is filed directly: „Ihre eigenen E-Mails an diese
   Adresse legt {productName} direkt ab, wenn Ihre Domain sie bestätigt und Sie
   im Projekt ablegen dürfen. Alles andere wartet im E-Mail-Eingang, bis jemand
   es ablegt, E-Mails von außerhalb des Büros 14 Tage lang.“
6. In the dialog and on the never-used page, where the two places first meet:
   „Der E-Mail-Eingang sammelt E-Mails an das Projekt. Das Postfach zeigt
   Hinweise an Sie.“ (the one mail string allowed to name the Postfach,
   `NAMES_THE_POSTFACH` in `i18n/forbidden-file-words.spec.ts`).
7. „Für die IT: Einrichtung · Umleitung aus Outlook“, folded (a muted
   disclosure, chevron turning): the redirect for an existing project address,
   one line with „Anleitung kopieren“ („… leiten Sie sie mit einer
   Outlook-Regel an {Adresse} um. Wählen Sie „umleiten“, nicht „weiterleiten“,
   sonst kommt jede E-Mail mit der bestehenden Adresse als Absender an …“). On
   the settings card it also holds „Bestehende E-Mail-Adressen für das
   Projekt“ and, for a manager, the office's DKIM line („{n} % der E-Mails
   Ihres Büros der letzten 30 Tage waren von Ihrer Domain bestätigt“, or „Ihre
   Domain signiert ihre E-Mails nicht – so richten Sie es ein“ linking to the
   help page's `#dkim`; derived from rows, never a DNS probe), and its summary
   names all three.
8. „Anleitung“ (the help page, `/e-mail-eingang/`, `/en/project-mail/`).

Every number of days or bytes in this copy is a placeholder filled from
`inbound-mail-vocabulary.ts` (`INBOUND_MAIL_RESTORE_DAYS`,
`INBOUND_MAIL_EXTERNAL_WAIT_DAYS`, `INBOUND_MAIL_ADDRESS_STATS_DAYS`,
`INBOUND_MAIL_MAX_MESSAGE_BYTES`, `INBOUND_MAIL_MAX_ATTACHMENT_BYTES`), so the
words cannot drift from the rule.

The dialog (from Dateien › Hochladen › „Per E-Mail senden …“ and „Mehr zur
Adresse“) is titled „E-Mail-Adresse des Projekts“. The settings card has the
same title and no eyebrow over the address; a member without the right to
manage sees „Bitten Sie jemanden, der das Projekt verwaltet, sie in den
Projekteinstellungen zu erzeugen.“

**Replacing and switching off are a manager's rare step**, behind „Adresse
verwalten“ at the card's foot (a header action stood between the sentence and
„Kopieren“ on a phone). Each menu entry says what it does: „Neue Adresse
erzeugen …“ · „Die bisherige hört sofort auf zu funktionieren.“, „Ausschalten
…“ · „Neue E-Mails an das Projekt kommen nicht mehr an.“ Each confirmation
says what happens to the old address and to held mail, as
`address-service.ts` does it: the old address is revoked at once and mail to
it is refused with the reject verdict (its sender gets it back as
undeliverable); held mail is the project's, not the address's, and stays and
can be filed; every running follow of the project ends (`endProjectFollows`,
reason `address_rotated`, for a switch-off too); a rotation carries the
registered existing addresses over, so the confirmation asks to update the
Outlook rules; a switched-off address never comes back, a new one is created
instead.

The E-Mail-Eingang's header shows „Adresse kopieren“ and „Mehr zur Adresse“
(the dialog); a manager without an address reads „Adresse erzeugen“ there, a
member nothing.

Never used, the page is about the address: the list takes the whole width,
says „Noch keine E-Mails an dieses Projekt“ with the sentence under it, and
holds one sheet with the eyebrow, the address a size up, „Kopieren“ and the
two hand-on presses; the size, the Postfach line and the folded setup follow
under the sheet. The header's address and the Wartet/Bearbeitet switch stand
down. Once mail has come, the list says how it gets there at its top, under
the search, until the project received five mails (`receivedCount` on the
address view, `START_HINT_UNTIL_RECEIVED` in `lib/inbox-start.ts`) or the
reader hides it (×, kept per project in the browser's storage): one muted line
„Setzen Sie die Adresse des Projekts in Cc oder leiten Sie E-Mails an sie
weiter – sie landen hier.“ with the inline press „Adresse kopieren“
(`InboundMailStartHint`). It names the address rather than printing it: the
68-character address in a 26rem column was three lines of monospace, the
loudest thing in the list. Without an address: „Dieses Projekt hat noch keine E-Mail-Adresse …“
with „Adresse erzeugen“ for a manager, or whom to ask for a member. An empty
list never shows the „Wählen Sie …“ pane. Previews:
`/dev/inbound-mail?variant=empty&rail=1`,
`/dev/inbound-mail-address?variant=manager` (its „Vorschau: Dialog …“ link is
preview chrome, gone with `&chrome=0`).
## The E-Mail-Eingang

**Layout by container, not viewport** (`inbound-mail-workspace.tsx`): a 22rem
list and the detail while the component's own box is wider than 48rem
(`@3xl`); below, list → detail with a back link. The filter lives on the URL
(`?status=handled`, replaced; the route and `inbound-mail-list` still take
`?outcome=`); an opened mail is pushed.

**The list** („Wartet auf Ablage · Bearbeitet“; `lib/list-sections.ts`,
`lib/completeness.ts`, `inbound-mail-list.tsx`, `inbound-mail-row.tsx`).
„Wartet auf Ablage“ has up to three headings, each with its count as the tabs'
muted pill: „Ablagebereit“ first (ready to file in one press and not yet filed;
„Bereit“ alone read as done), „Braucht Sie“ second, „Wartet auf andere“ third (mail only another member may
file, `onlySenderReleases`, never an impersonation: dismissing a forgery is the
reader's to do), then the group „Automatisch“ with the same pill (absence notes,
newsletters, notifications). Mail from an unconfirmed domain is a row like any
other, with its trust glyph: for a small office it is most of the real mail,
and folded away it was never seen. The automatic group is folded while
anything else waits and opens by itself when nothing does; a press on it holds
until the next visit. J and K walk every row on show, the open group's
included. Within each heading, mail with fewer than five days left comes
first (soonest first, the rest in the server's order) and says so on a line
of its own, with a muted hourglass and its day: „Bleibt bis 03.12. im
E-Mail-Eingang“, the same for every sender, since every expiry stays
restorable for seven days (ADR-0137, amendment of 2026-11-19). It is a
deadline, not a threat: „Wird am 03.12. entfernt, wenn niemand sie ablegt“,
said of an outsider's mail while its expiry erased it, read as one, and „Läuft
in 2 Tagen ab“ in ochre after the reason read as an alarm and said nothing of
what happens. Such a row
offers „Einordnen …“ at rest, which opens the mail and its filing dialog
(rows differ in what they offer, so the press is shown, design principle 6);
not for a mail only a colleague may file.
„Ablagebereit“ means the server's `incompleteReason` is null and the mail does not
read as an impersonation (the client refuses an impersonation on its own side
too, `fileableReason`). „Bearbeitet“ is one list: each row says its outcome,
and a mail a person filed says where it went, „Abgelegt → „Stellplatznachweis““
(`filedTo` on the summary: the Verlauf its text joined, else its first filed
file, as the reader may see it). A mail filed without a click (by a follow, or its sender's own filing) adds a
line with the mail glyph, „Ohne Klick abgelegt → {Name}“ naming the
E-Mail-Verlauf its text went into (else its first file), or „Ohne Klick
abgelegt“ where the reader may not open it (`filedWithoutClick` on the
summary; i18n group `inboundMail.autoFiled`).

A row: the sender's domain, the subject without `AW:`/`WG:`, the time, „· 3
Anhänge“; suggestion chips; a trust or risk glyph. Over the rows a field
„Absender oder Betreff“ filters the loaded mail by sender and subject, every
word, without case or accents (`matchesQuery`, `lib/inbox-triage.ts`); the
count of matches is said once by a status, Escape clears it, and a search that
finds nothing says „Keine E-Mail passt zu „…““ with „Suche leeren“. The list's
rhythm is one: 32px between sections, 12px between a heading, a thread and a
run of rows inside one. „Ablagebereit“ says on hover „Jede Zeile sagt,
wohin ihr Text und ihre Anhänge kommen. Ein Klick legt sie so ab.“ and, with two or more
ready mails, „Alle {n} ablagebereiten E-Mails ablegen“ (bulk, confirmed and
grouped by destination; more than 20: „Die ersten 20 ablagebereiten E-Mails
ablegen“, since one request decides at most 20). It names its scope, the
section, so it never reads as the thread group's „Diese {n} wie vorgeschlagen
ablegen“ beside it (round 7: „Alle 5 …“ and „Diese 3 …“ read as two answers to
one question); where the section is one thread group, only the group's press
stands. Every ready row says in one muted line, with
a folder glyph, where that press files it, so the bulk press is never blind:
„E-Mail-Text an „Verfahren MA 37“ · Anhang nach Behörde/Bescheide“, „3
Anhänge in 2 Ordner“, „E-Mail-Text als neuer E-Mail-Verlauf“, the top level
„Dateien (oberste Ebene)“. The server says it (`suggestedPlaces` on the
summary, `bff/inbound-mail/suggested-places.ts`: the preselected text's
Verlauf and the distinct folders of the preselected attachments, a revision's
folder for a next Fassung), the row only words it; inside a thread group the
text's clause is left out, since the group's line names the Verlauf. The line
replaces the row's „An E-Mail-Verlauf …“ and wraps to two lines at most. A
ready row outside a thread group carries
„Wie vorgeschlagen ablegen“, shown where the reader is (the open row, under the
pointer or the keyboard, always under a finger): one press, no confirmation,
the same request as bulk and never an acknowledgement. Under a finger it
stands only on the open row: shown on every row, one stray tap filed a mail.
After „Alle …“ or a group's press the toast waits until every part landed
(`useBulkLandingReport`, `landedPlaces` in `lib/inbox-landing.ts`) and says
„3 E-Mails abgelegt“ with a line per destination („2 E-Mail-Texte →
„Stellplatznachweis““, „1 Datei → Behörde/Bescheide“) and „Ansehen“: the one
document they went into, else „Bearbeitet“, whose rows name where each mail
went; a mail with a failed part makes it „1 E-Mail ließ sich nicht ganz
ablegen und wartet wieder hier.“ A row whose parts are
all on their way reads „Wird abgelegt …“ and offers no press. The open row is
a fill, not a drawn box; a sender's disc is neutral (a sender is not a member,
an identity hue would mean nothing). The mail is read again first; if it changed
(„Anhang wird noch geprüft …“), nothing is filed and a toast says why. After
the press: „1 E-Mail wird wie vorgeschlagen abgelegt“ with the destinations
(„In E-Mail-Verlauf „Verfahren MA 37“: 1 · In „Behörde“: 1“), a toast that
holds until the parts land (`awaitLanding`, `lib/inbox-landing.ts`) and then
says what landed where („1 Datei und der E-Mail-Text abgelegt“, a line per
part, „Ansehen“) or what failed (the detail's partial-failure and full-store
words). A row under
„Braucht Sie“ says what it needs: „Absender prüfen“, „Anhang prüfen“, „Anhang
wird noch geprüft …“, „E-Mail-Verlauf wählen“, „Ordner wählen“, „Projekt ist
abgeschlossen“. A mail that names a member whose domain did not confirm it is
phrased for its reader (`mailClaimOf`, `lib/sender.ts`): the member reads
„Haben Sie sie gesendet? Bestätigen Sie es“, a colleague „Wartet auf {Name}“
under „Wartet auf andere“. A verified writer's mail direct filing left
(`waitReason: 'not_filed'`) reads „Nicht direkt abgelegt · {what it needs}“.

Thread groups are split by readiness: a conversation's ready replies are one
group under „Ablagebereit“ with „Diese {n} wie vorgeschlagen ablegen“ (or
„Die ersten 20 wie vorgeschlagen ablegen“; no Fassung range, which made a
mail's text read as a plan's next Fassung); its replies that need a look are a group under „Braucht
Sie“ with „Ansehen“ (opens the first, with no Fassung range, which would depend
on what is filed first). The group line (the thread's glyph and „{name}“; „E-Mail-Verlauf“ and the
count in its title and the section's label) and its press share one row. The rows do
not repeat the thread: each subject drops the thread's name in front
(`subjectWithinThread`), so three replies read „Nachreichung Statik“, „Index C“
rather than three cut-off „Stellplatznachweis – …“. The group's rows hang
from its line: indented 22px, under the thread glyph, on a hairline down their
left edge (`thread-group-rows`), so the press's count is the rows inside the
line and the next loose row stands back on the column's edge. Round 3's
reader saw „Diese 2 …“ over three flush rows and could not tell which two. A
row whose text a follow already appended shows no thread line; what still waits are the attachments the follow could not place
in an existing folder.

**Impersonation is a stop** (`riskLevel === 'impersonation'`). In the list the
row reads „Gibt sich als {Name} aus · nicht ablegen“ (a red glyph, the words
in ink) and has neither
the one-press button nor a checkbox: it can never join a bulk decision, nor by
the keyboard's X. The
detail opens with a full-width warning above the header („Vorsicht: Diese
E-Mail gibt sich als {Name} aus. …“ or „Vorsicht: Der Name {Name} gehört einem
Mitglied, die Adresse {Adresse} nicht.“, then „So beginnen Betrugsversuche mit
Kontoänderungen. …“). „Melden und verwerfen …“ in the warning is the primary
(ink) button and „Verwerfen“ in the bar the secondary one (round 6: the press
that also warns the office was the quiet one); the filing controls fold behind „Trotzdem ablegen …“ („Nur wenn Sie telefonisch geprüft haben, dass
die E-Mail echt ist.“), and filing still needs „Ich habe telefonisch geprüft,
dass die E-Mail echt ist“, after which the primary reads „Als echt ablegen“:
the high-risk yes has its own words and its own verb, never the „Ablegen“ of
every other mail. Once opened the fold's button reads „Ablage schließen“.

**„Melden und verwerfen …“ warns the office** (`fraud-report.tsx`, inside the
warning, under its text, with „Warnt Ihr Büro, damit niemand zahlt, und
verwirft die E-Mail.“ beside it; „Melden …“ alone hid that it also
dismisses, round 4). Dismissing
only ends the mail here, and the same mail may sit in accounting's mail
program. The press opens a small confirmation, „Betrugsversuch melden?“, that
says who is warned („{Produkt} warnt, wer dieses Projekt verwaltet, die
Administratoren Ihres Büros und {Name}.“; the member reading their own forged
address is not named to themself) and what then happens („Die Warnung nennt
Absender und Betreff und sagt: „Bitte nicht zahlen und nicht antworten. Prüfen
Sie Ihr Mailprogramm auf dieselbe E-Mail.“ Danach ist die E-Mail in {Produkt}
verworfen; im Mailprogramm löschen Sie sie selbst.“). „Melden und verwerfen“
is one press: reported and dismissed together, the toast saying how many were
warned („Gemeldet und verworfen. 3 Personen sind gewarnt.“), or, when nobody
else manages the project, „Verworfen. Niemand sonst verwaltet dieses Projekt:
Warnen Sie Ihr Büro selbst.“. No „Rückgängig“: the warning is already out.
„Melden und verwerfen …“ is the primary, beside the reason to use it, offered
to every reader who may dismiss (the colleague under `ClaimedMailBar` too)
while the mail waits; „Verwerfen“ in the bar, and `ClaimedMailBar`'s
„Verwerfen …“, stand beside it as secondary presses (`DecisionBar`
`reportOffered`).

One voice per reader. The member a rejected mail claims (`mailClaimOf` is
`own`) never reads a fraud warning about themself: the warning says „Diese
E-Mail trägt Ihre Adresse, aber Ihre Domain hat sie abgelehnt.“ and to dismiss
it unless they sent it, the trust reads „Ihre Adresse · von Ihrer Domain
abgelehnt“, the row „Mit Ihrer Adresse, von Ihrer Domain abgelehnt · prüfen“,
the fold's hint „Nur wenn Sie diese E-Mail selbst gesendet haben.“ and the yes
„Ja, ich habe diese E-Mail gesendet. Ablegen“. No wait line stands under an
impersonation's warning: the warning says why and what to do.

**A mail only another member may file** (`onlySenderReleases`: it poses as a
colleague, whose domain rejected its signature; the reader is someone else) is
shown, never decided. A colleague's mail their domain merely did not confirm is
decided like any held mail, its acknowledgement reading „Ich habe geprüft, dass
diese E-Mail von {Name} ist. Ablegen“ (`claimedWriter` in `draft.ts`), its
wait line „Legen Sie sie ab, wenn Sie geprüft haben, dass sie von {Name} ist“.
The impersonation: its parts carry no checkbox, no target and
no „Ändern“, the text has no filing row, and „Trotzdem ablegen …“ is not
offered. The bar is `ClaimedMailBar`: „Nur {Name} kann diese E-Mail ablegen
oder wiederherstellen. Sie können sie verwerfen.“ and „Verwerfen …“, whose
confirmation names the member and their address and says only they can restore
it (the server refuses a colleague's filing and restore alike, `sender_only`).
The dismissed toast carries no „Rückgängig“ for them. ⌫ opens the confirmation.

**The detail** opens on the mail (`mail-header.tsx`), top to bottom:
1. The header: the subject, then „{Name} ‹{Adresse}›“ (name and address
   always together), then one line: the verdict on the sender, the received
   time and „Details ▾“ (on a phone the time starts its own line, no dot left
   at the end of the verdict's). **One verdict in three levels**
   (`senderTone`, `useTrustLabel` in `sender-trust.tsx`), in ink with its ⓘ
   toggletip, never folded: „Adresse überprüft“ (a confirmed domain; „Echte
   Adresse“ read oddly to the owner in round 3; its own
   Bcc copy „Ihre eigene E-Mail (Bcc)“), „Absender nicht überprüfbar“
   („Adresse von {Name}, nicht überprüfbar“ for a member's address, „Ihre
   Adresse, nicht überprüfbar“ for the reader's own), „Vorsicht: mögliche
   Fälschung“ (the reader's own: „Ihre Adresse, von Ihrer Domain abgelehnt“).
   Colour is the verdict's: only the forgery's glyph is red; an address nobody
   can vouch for is the normal case of a small office and wears a grey glyph,
   because an ochre one on every outsider's mail was read past (round 2). The
   technical reason stands under „Details“ as „Absender“: „Domain bestätigt:
   {domain} hat die E-Mail signiert (DKIM).“, „… nicht signiert (DKIM)“, „Die
   Signatur … fehlt, ist ungültig oder passt nicht zur Adresse (DKIM)“, „… hat
   die E-Mail abgelehnt (DKIM oder DMARC)“ (`trustTechnical`, `lib/sender.ts`).
   The sender's flags („An andere Empfänger adressiert“, …), why it waits
   (`SenderWaitLine`) and, for a forward, „Von {Autor} · nicht überprüfbar ·
   weitergeleitet von {Name}“ (the Verlauf's and the provenance line's words)
   stay visible under it. **The wait line stands only where it tells the
   reader to do something or the mail will be gone** (`SAID_IN_THE_PANE`):
   `signature`, `replay`, `automatic` and `sender_unchecked` ask a check and
   wear an ochre clock („Wartet auf Sie: …“ for the member's own, „Wartet auf
   Ablage: …“; for a colleague of a claimed mail they name only whom it waits
   for and why, because `ClaimedMailBar` right below already says „Sie können
   sie verwerfen.“, design principle 9). `no_write_rights`, `paused` and
   `not_filed` say nothing in the pane: the mail is the reader's to file
   either way, and „Miriam Huber darf … nicht selbst ablegen, Sie schon“ was
   noise to the owner (round 3). An outsider's mail says, muted, when it goes
   and that a reminder comes: „Wird am {Datum} aus dem E-Mail-Eingang
   entfernt, wenn niemand sie ablegt. {productName} erinnert 5 Tage vorher.“
   (`inbound_mail.expiring`, `INBOUND_MAIL_EXPIRING_NOTICE_DAYS`, to whoever
   may file; „… danach wird sie gelöscht“ frightened her twice).
   „Details“ opens the sender's check, Gesendet, Eingegangen, every recipient
   (An, Cc, Antwort an), „Wartet bis {Datum}, danach läuft sie ab“ and
   „Original (.eml) herunterladen“ with „Öffnet sich im Mailprogramm; Bilder
   von außen werden dort geladen.“, or the original's infected or scanning
   line. In its last week the expiry comes forward into the header: „Bleibt
   bis {Datum} im E-Mail-Eingang“, as on the row, for every sender, and the
   outsider's wait line („… und lässt sich danach noch 7 Tage
   wiederherstellen“) stands down
   (`lib/evidence.ts`, `EXPIRY_INLINE_DAYS = 7`).
2. The text: first lines, „Ganze E-Mail anzeigen“, „Zitierten Text anzeigen“.
   Plain text only. A link stays inert text; after it stand its domain in ink
   („→ dropbox.com“, so a look-alike host shows itself on a phone, which has no
   hover) and „Kopieren“ (`CopyableValue`), which copies the whole address.
3. „Anhänge“, read only (`AttachmentLine`, `attachment-line.tsx`): per row the
   thumbnail (clean images and PDFs only, drawn client-side in the sandboxed
   viewer; Office files show their tile), the name, „{Typ} · {Größe} ·
   Vorschau“ on a clean PDF or picture, a scan or failure line where there is
   one, and **one muted phrase of what filing does with it**, in the words
   „Übersicht“ uses (`usePlanWords`, `plan-words.tsx`, from `planLines` in
   `lib/filing-plan.ts`): „Ordner Behörde/Bescheide · Dokumentart Bescheid“
   (each value with its label: „Kommt nach … · Bescheid“ left her asking what
   the second „Bescheid“ was), „Neuer Ordner Fotos · Dokumentart Foto“,
   „Index D ersetzt Index C (C bleibt erhalten) · Ordner Tragwerk“ where
   both names carry an index (`indexChange`), „Fassung 4 von Statik.pdf
   (Fassung 3 bleibt erhalten) · Ordner Tragwerk“ where they do not
   (round 6: „Fassung 4 von S-101_C.pdf (ersetzt C)“ was not how an office
   speaks of a plan; the bracket says what „ersetzt“ leaves), „Neue Datei neben S-101_C.pdf · Ordner Tragwerk“, „bleibt weg –
   liegt schon im Projekt“, „Noch kein Ordner“. Until the person has seen „Übersicht“ once, a part that asks
   for a decision says so instead (`attachmentOpenReason`): „Offen: Ordner
   wählen“, „Offen: {productName} liest noch …“, „Offen: Index D als nächste
   Fassung von S-101_C.pdf ablegen?“ (without an index „Offen: könnte Fassung
   4 von Statik.pdf sein“), „Offen: ablegen oder nicht“, „Offen: Namensprüfung“,
   „Offen: Warnung prüfen“. **The pane has no checkbox, radio, chip or per-row
   press** but „Vorschau“ (pinned in `brand-literals.spec.ts`, „the mail is
   read, „Einordnen“ edits“): round 2's pane, with every control of the
   filing beside the mail, was still too much at once for the owner. The
   parts that cannot be filed one by one are listed without a suffix each,
   and one line under them says where they are: „Diese Dateien stecken nur im
   Original (.eml): Laden Sie es oben unter „Details“ herunter. Mit dem
   E-Mail-Text abgelegt, bleibt es beim E-Mail-Verlauf.“ A text that cannot be
   filed says why under the text (`MessageFacts`: unreadable, the original's
   scan, „Liegt schon in einem E-Mail-Verlauf“). „Vorschau“ (and Space, from
   the list) opens the attachment large: a PDF in the app's own viewer
   (`PdfDocumentView`: every page, the page steps, zoom, search; pdf.js draws
   it, nothing of it runs), a picture whole; full screen on a phone; with
   more than one, „Anhang 2 von 5“, „Voriger“ / „Nächster“ and ← →. Closing
   it hands the focus back to the press that opened it. A clean attachment
   says nothing about its scan; „Wird auf Schadsoftware geprüft …“, „Prüfung
   fehlgeschlagen, wird wiederholt“ and „Schadsoftware gefunden · lässt sich
   nicht ablegen“ still show.
4. The decision bar, pinned and safe-area padded (`DecisionBar`): **one
   primary, „Einordnen …“**, and „Verwerfen“ beside it, on a phone too (the
   primary the wider, nearest the thumb). On a desk one ink line left of the
   presses says what the primary does: „Zeigt zuerst, was wohin kommt.
   Abgelegt wird erst, wenn Sie es bestätigen.“, or „2 Fragen, dann die
   Übersicht. …“ when „Einordnen“ asks some; under it, muted, what
   „Verwerfen“ does, which the reader asked about her Outlook: „Verwerfen
   wirkt nur in {productName}, nicht im Mailprogramm, und lässt sich 7 Tage
   lang wiederherstellen.“, for every sender, an outsider whose domain did
   not confirm the mail included (the owner, round 5: the erasure at once
   had been the one exception, and its own copy in three places), and every
   dismissal's toast offers „Rückgängig“. An outsider's mail that nobody
   files is still removed after 14 days without a restore. On a phone only that
   second line stands over the two presses. Where nothing can be filed (a
   closed project, an infected original with nothing else), „Verwerfen“ is
   the one press and the primary. While a batch is selected in the list,
   „Einordnen …“ yields to the batch bar's primary and „Verwerfen“ stands
   down. A colleague of a claimed mail gets `ClaimedMailBar` instead (above).
5. **„Einordnen“** (`FilingDialog`, `filing-dialog.tsx`): the kit's `Dialog`,
   full screen on a phone (`fullScreenOnMobile`) with its presses pinned at
   the foot, opened on the agent's proposal (`initialDraft`: the server's
   defaults and the agent's suggestion). It asks **only the steps the draft
   needs** (`filingSteps`, `lib/filing-plan.ts`), in this order, one question
   per screen. Above the question every step names the mail, as the page
   behind it is blurred and which mail this was had been a guess (round 4):
   „Schritt 2 von 3 · „Tiefgarage Lüftung“ von Ing. Karl Bauer“ (the
   progress only when there are two or more steps; the subject without
   „AW:“, cut at the line's end; `filing-mail`):
   1. „Absender“ when the server asks for `acknowledgeSender`
      (`senderNeedsDecision`): the sender's name, address and verdict, the
      flags, and the one confirmation, worded as before: „Ich kenne den
      Absender und vertraue dieser E-Mail“, for the member's own „Ja, ich
      habe diese E-Mail gesendet“, a colleague's checked by another writer
      „Ich habe geprüft, dass diese E-Mail von {Name} ist“
      (`claimedWriter`), a forgery's „Ich habe telefonisch geprüft, dass die
      E-Mail echt ist“. The question is the title („Kennen Sie den
      Absender?“, „Haben Sie diese E-Mail gesendet?“, „Ist diese E-Mail von
      {Name}?“, „Haben Sie telefonisch geprüft, dass die E-Mail echt ist?“);
      „Weiter“ waits for the tick. A confirmation's whole row is its label,
      44px tall under a coarse pointer.
   2. „E-Mail-Text“ when an E-Mail-Verlauf could be chosen but none is
      preselected, the chosen one is an unsure match (`blocks`), or the
      text has content findings (`textNeedsDecision`). A new E-Mail-Verlauf
      with no existing one to choose instead is the proposal, not a
      question (the owner: no step only to confirm a proposal). **One
      question, one radio group, no checkbox above it** (`MessageRow`; round
      3's checkbox, radios, name and folder were three levels, „the low
      point“): „An „{Name}“ anfügen“ per candidate with why it fits in a
      second line (`candidateWhy`: „gleicher Betreff“, „antwortet auf eine
      E-Mail darin“, or the doubt: „antwortet auf eine E-Mail darin, das
      lässt sich aber nicht bestätigen“). **The E-Mail-Verlauf of the same
      subject is the answer chosen** when it is the only candidate there is
      (none other visible, none hidden from the reader, not full) and
      appending to it needs no acknowledgement (`sameSubjectThread`,
      `lib/draft.ts`): two near-identical Verläufe were what the old default
      „Als neuen E-Mail-Verlauf ablegen“ made (round 4). It is the dialog's
      default, never the server's: a subject match is never preselected
      (`PRESELECTABLE_STRENGTHS`), so the mail stays under „Braucht Sie“ and
      the step is asked, its hint saying why: „Vorgeschlagen ist „Tiefgarage
      Lüftung“: gleicher Betreff, und kein anderer E-Mail-Verlauf passt.
      Prüfen Sie, ob die E-Mail dazugehört.“ A candidate whose link the
      server could not confirm (an outsider's unsigned reference) is never a
      default, as choosing it is the acknowledgement. „Als neuen E-Mail-Verlauf ablegen“
      („im Ordner Korrespondenz“ until chosen; then its name field and
      „Ordner: …“ with „Ändern“ show under it, and only there), and „Text
      nicht ablegen“ („Der Text bleibt nur in der E-Mail und wird mit ihr
      verworfen.“). Choosing a candidate whose link the server could not
      confirm, its doubt in the label, carries the acknowledgement
      (`acknowledgeThread`); „Gehört trotzdem zu diesem E-Mail-Verlauf“ is
      left only for a preselected one that needs it. A hidden candidate
      reads, in ink, „Ein weiterer passender E-Mail-Verlauf liegt in einem
      Ordner mit eigenen Zugriffsrechten. Gehört die E-Mail dorthin, lassen
      Sie sie im E-Mail-Eingang: Wer dort eingetragen ist, kann sie
      ablegen.“ (the view carries only a count, never who could see it;
      „Fragen Sie die Projektleitung“ was read by the project lead). Under
      the target, the content findings' one question
      (`ContentFindingChoice`): „Im Text steht eine IBAN, ein Wort von der
      Liste vertraulicher Begriffe Ihres Büros.“ (each finding with its
      article: „IBAN, ein Begriff, …“ read as if the IBAN were the term),
      „Wie soll das im E-Mail-Verlauf stehen?“, „Unkenntlich machen“ („Im
      E-Mail-Verlauf steht an diesen Stellen „••••“. Den übrigen Text liest
      {productName} wie gewohnt und kann Fragen dazu beantworten.“; „kann
      ihn lesen“ left open what „ihn“ was) selected or „Lesbar ablegen“
      („Dann hält {productName} den ganzen E-Mail-Verlauf „{Name}“ zurück,
      bis eine Person, die das Projekt oder das Büro verwaltet, über ihn
      entscheidet. Bis dahin liest {productName} ihn nicht.“: who decides,
      in words the reader can check against herself), and under both: „Die E-Mail selbst bleibt unverändert: im Original (.eml) beim
      E-Mail-Verlauf und in den Postfächern, an die sie ging.“ No
      „Inhaltsprüfung“, no „jemand“, no „frei“.
   3. „Anhänge“ for the attachments that need a decision
      (`openAttachmentIds`: no folder, a suggestion still pending, an unsure
      next Fassung, one left out for a reason a person weighs
      (`asksForDecision`), a name stop or a risk not confirmed). The title
      is „Wohin kommt dieser Anhang?“ while each only lacks a folder, „Was
      geschieht mit diesem Anhang?“ / „… diesen 2 Anhängen?“ while one is a
      „whether“; under it, whenever a row has a tick, what the tick means:
      „Ein Häkchen heißt: Die Datei wird abgelegt. Ohne Häkchen bleibt sie
      weg und wird mit der E-Mail verworfen.“ **Every file is kept by
      default** (`AttachmentCase.defaultChecked`), also one the server left
      unselected, except what it keeps out for a reason it names: a copy the
      project has, a picture from the mail's text (named „Bild aus dem
      E-Mail-Text“, so „Übersicht“ says only „bleibt weg“ after it, and any
      other part without a filename „Unbenannter Anhang (PDF, 120 kB)“, never
      „Anhang {n}“; `useDraftCopy`), a name stop, a macro or a
      mismatched type, and anything of a mail posing as a member (a stop,
      never a default; CONTEXT.md). Server-side nothing changes: an
      unselected part needs no acknowledgement of its own; an unconfirmed
      sender's acknowledgement stays in „Absender“. **An unsure next
      Fassung is three answers, never a tick** (`unsureRevision`,
      `chooseRevision`), each with what it does under it: „Als nächste Fassung
      von S-101_C.pdf ablegen“ („Index D wird der aktuelle Stand, Index C bleibt
      erhalten.“) where both names carry an index, else „Als Fassung {n} von
      {Name} ablegen“ („Statik_neu.pdf wird der aktuelle Stand, Statik.pdf
      bleibt als Fassung 3 erhalten.“; `revisionOf`, and the choice is the
      `acknowledgeRisk` the server asks; a macro keeps its own „Ich vertraue
      …“), „Als neue Datei neben {Name} ablegen“ („S-101_C.pdf bleibt der
      aktuelle Stand.“; `revisionOf` null, in that document's folder) and
      „Nicht ablegen“ („Die Datei wird mit der E-Mail verworfen.“). **A
      plan's next index is the next Fassung by default** (round 4: with „neue
      Datei“ as the default the team kept building from C): when the file
      and the document carry the same plan number and format and the file's
      letter index is the same or later (`revisionByDefault`,
      `bff/inbound-mail/plan-index.ts`, which the UI re-exports: a name with
      a digit in its number, then `_` or `-`, then one letter; pdf, dwg, dxf,
      ifc, plt, pln, rvt), as „S-101_D.pdf“ over „S-101_C.pdf“. An older
      index, another number, another format or a name the rule does not read
      („S-101 Index D.pdf“) keeps „Als neue Datei“ as the default. The step is
      asked either way, and its note then says what the project holds: „Im
      Projekt liegt S-101_C.pdf im Ordner Tragwerk, dieselbe Plannummer in
      Index C. Darum ist Index D als nächste Fassung vorgeschlagen.“ (else, as
      before, „könnte Fassung 4 von S-101_C.pdf sein, aber nur der Dateiname
      spricht dafür“). The server finds such a candidate since round 6: a
      document of the same name, else the same plan number with the latest
      earlier index (`findScreenedRevisionCandidates`,
      [`inbound-mail.md`](../architecture/inbound-mail.md#sender-trust));
      it is never preselected for an unverified outsider. No copy calls a
      file a „Plan“ (CONTEXT.md, *Fassung*): the index is said, and
      „Plannummer“ where the number is meant. Each row (`AttachmentRow`) has its
      case notes, „Ordner: …“ with its own „Ordner wählen“ / „Ordner
      ändern“ (`FolderChoiceDialog`: the likely folders, „Neuer Ordner …“,
      the project's folders), „Dokumentart: …“, „Details ändern“ with
      the target dialog (name, folder, Dokumentart and Fassung; round 7:
      „Name, Dokumentart …“ read as a label cut off), and the
      confirmations „Ich vertraue dem Absender dieser Datei“ and „Trotzdem
      ablegen“. **„Weiter“ waits until every
      ticked file has a folder** (`keptWithoutFolder`), and says so beside
      it, as its description: „Wählen Sie zuerst für 1 Datei einen Ordner
      oder nehmen Sie ihr Häkchen weg.“ **An attachment without any folder
      is also answered in the step** (`FolderChoice`, `folder-choice.tsx`;
      `folderlessIds`): up to four likely folders first (`quickPicks`: the
      agent's suggestion, folders `extra` hands in, the folders this mail's
      other attachments go to, where a plan's earlier Fassung lies), then
      „Neuer Ordner …“ (the documents' `NewFolderDialog`; the filing makes
      it, `newFolderPath`, and a path the project has is that folder), then
      the project's folders (`FolderPickerList`, searchable). With two or
      more it reads „Alle 3 in diesen Ordner“ and one pick sends every
      ticked one there (`fileAllInto`; none ticked, it ticks and sends them
      all), so a plan set from an unknown sender is one choice. Once they
      share a folder the list folds to that choice, „✓ Alle 3 kommen in
      Pläne / Fassade · Anderer Ordner …“ (`foldAfterChoice`): the open list
      had shown „Pläne“ under the pointer, not the chosen „Pläne / Fassade“
      below the fold, and she feared she had moved them (round 4). Opened
      again, the chosen folder is the one row marked „Gewählt“ (`PickerRow`
      `current="chosen"`). A row puts „Details ändern“ beside its folder
      rather than on a line of its own, so three files fit 1440×900 without
      scrolling. The pane and the dialog read one draft, so a folder the
      dialog will preselect (the agent's, or the folder the sender's earlier
      attachments went to, `sender_memory`) is the pane's phrase too, never
      „Offen: Ordner wählen“; round 4's 04/05 disagreed only because the
      capture had picked a folder between them. The
      attachments with a sure proposal are folded under „4 weitere wie
      vorgeschlagen · Ändern“; opened, and whenever every row shows, the
      heading's „Alle auswählen“ / „Alle abwählen“ and „Ausgewählte in einen
      Ordner …“ (with „{n} von {m} ausgewählt“) apply to all.
   4. „Übersicht“, always: „So wird die E-Mail abgelegt“ and a list of what
      goes where (`OverviewRow` in `filing-dialog.tsx`, from `planLines`),
      one row per part that is filed: its first line the part with its
      glyph (the mail glyph and „E-Mail-Text“, or the file glyph and the
      name cut in its middle) and a quiet „Ändern“ on the right, also on a
      phone; its second line, indented under the destination's glyph (the
      Verlauf's or a folder's), where it goes, in ink and medium weight
      (`usePlanWords().destination`): „E-Mail-Verlauf „Stellplatznachweis““
      (with „ (Fundstellen unkenntlich)“ after a masked text), „Neuer
      E-Mail-Verlauf „…“ in Korrespondenz“, „Behörde/Bescheide · Bescheid“,
      „Tragwerk · Index D ersetzt Index C (C bleibt erhalten)“ (or „Tragwerk
      · Fassung 4 von Statik.pdf (Fassung 3 bleibt erhalten)“ where the
      names carry no index), „Tragwerk · neue Datei neben S-101_C.pdf“ (the
      decision on a possible Fassung is named, `PlanLine.besides`), „Neuer
      Ordner Fotos · Foto“, „Noch kein Ordner“. An encrypted file keeps the
      attachments step's note as a quiet third line with the lock glyph,
      „Verschlüsselt – {productName} kann den Inhalt nicht lesen“ (round 7:
      it was filed with no hint). A row's „Ändern“ goes to
      the step that decides that part, adding it when it was not asked: the
      text to „E-Mail-Text“, a file to „Anhänge“ with its row unfolded,
      scrolled to and focused. The owner, round 6: one sentence per part
      with two loose links under them („E-Mail-Text ändern“, „Anhänge
      ändern“) read as if they edited the text and the files. **What stays
      out is loud** (round 3: „S-101_D.pdf bleibt weg“ in grey was the plan
      the mail was about): after a hairline, a framed box (`filing-left`)
      below the filed rows, each part in ink with its reason („Bescheid_alt.pdf bleibt weg
      – liegt schon im Projekt“, „– Namensprüfung: „Honorar““, „– enthält
      Makros“, „– nicht ausgewählt“, „E-Mail-Text bleibt weg, samt
      Original“, and for a part filing cannot take „– wird noch auf
      Schadsoftware geprüft“, „– Schadsoftware gefunden“, „– lässt sich
      nicht ablegen“), „Doch ablegen“ where filing it is the person's call
      (`includable`: not selected, a name stop, a risk, the text; it ticks
      the part and, where it still needs a folder or a confirmation, adds
      „Anhänge“ or „E-Mail-Text“ and goes there), and under them, in ink,
      what pressing does to them, because the server dismisses every
      waiting part not in the decision (`writeMailDecisions`): „Was hier
      „bleibt weg“, verwirft {productName} beim Ablegen. Wiederherstellen
      lässt es sich 7 Tage lang.“, for every sender. When the text goes
      into an E-Mail-Verlauf and its sender could be followed
      (`followOffered`), a footnote under everything, never between the rows
      (`FollowLine`): „Weitere
      Antworten in diesem E-Mail-Verlauf legt {productName} ohne Klick ab ·
      Ausschalten“, the inline press toggling it to „… warten im
      E-Mail-Eingang · Einschalten“, and an ⓘ toggletip holding the
      explanation of the Verlauf's switch („Antworten von Beteiligten mit
      bestätigter Domain legt {productName} ab, als hätten Sie es selbst
      getan: … Es endet erst, wenn 60 Tage lang nichts in diesen
      E-Mail-Verlauf abgelegt wurde.“). The owner, round 6: it is a default one turns
      off, not a question, and round 5's framed switch with its paragraph
      weighed as much as the filing; the „E-Mails“ tab keeps the
      `FollowSwitch` with its state and explanation. Where replies could
      never be filed without a click (an unverifiable sender, an automatic
      mail) nothing is said: the ⓘ's explanation names who is filed. It is
      on by default (the owner kept follow by default); switched off, the
      decision's text carries
      `follow: false`, which the filing job honours (`noFollow`), so the
      follow the filing would start never starts. What blocks filing
      stands above the primary with the warning glyph (`blockerText`), and the
      primary is disabled. The primary names the act: „Ablegen“; a forgery's
      „Als echt ablegen“; with nothing left to file „Verwerfen“. Where the
      sender cannot be verified (an outsider's or a colleague's unsigned
      mail, `filingConfirmsUnverifiedSender`) the last line of „Übersicht“,
      quiet, with the sender-check glyph, says what pressing means:
      „Absender nicht überprüfbar – mit „Ablegen“ bestätigen Sie, dass die
      E-Mail echt ist.“ A forgery gets none: its verb says it.

   A mail with nothing to decide opens straight on „Übersicht“: „Einordnen“,
   then „Ablegen“. „Zurück“ and „Weiter“ walk the steps; the first step's
   left press is „Abbrechen“. Each new step's question takes the focus, so a
   screen reader reads it; „Übersicht“ opens with the focus on „Ablegen“.
   Escape, the X and a scrim click close it **without changing anything**:
   the draft lives in the detail, so closing and reopening keep every
   answer while the mail is open, and once „Übersicht“ was seen the next
   opening starts there. Closing hands the focus back to „Einordnen …“, however
   it was opened. **Filing sends exactly the decision the draft gave before**
   (`decisionOf`; the server API and every rule are unchanged): the dialog
   only orders the questions. A refusal keeps the dialog open; a name stop
   on a new E-Mail-Verlauf's name goes back to „E-Mail-Text“ with the
   release. A filing that the server took closes it, and the detail says
   „Wird abgelegt …“.

   **An impersonation keeps its stop.** The warning stands above the header,
   its report press, the primary, says what it does, „Melden und verwerfen
   …“ („Warnt Ihr Büro, damit niemand zahlt, und verwirft die E-Mail.“),
   „Verwerfen“ stands beside the mail as the secondary press, and „Einordnen …“ is offered (as the quiet press) only
   after „Trotzdem ablegen …“ („Nur wenn Sie telefonisch geprüft haben,
   dass die E-Mail echt ist.“; „Ablage schließen“ folds it again), which
   itself stands behind the muted disclosure „Weitere Möglichkeiten ⌄“:
   a raised „Trotzdem ablegen …“ under the fraud warning was the next press
   in reach (round 4). Its first step is the phone check, nothing is preselected, so
   „E-Mail-Text“ and „Anhänge“ follow, and the yes is „Als echt ablegen“.
6. After filing, when the sender would qualify, the same switch
   (`follow-offer.tsx`) under „E-Mail-Verlauf „{Name}““, in its state:
   on where the filing started the follow, which is the default. The days
   are `MAIL_THREAD_FOLLOW_DEFAULT_DAYS`. Code still says follow; the
   Postfach's notices say „ohne Klick ablegen“ and „abgelegt, als hätten Sie
   es selbst getan“ too (below).

Above the header, what happened to the mail (the closed project, someone else
deciding it, a partial failure, a full storage): one notice stands whole; two
or more fold into one line, the first's words and „+{n} Hinweise“, opened on a
tap. A notice says a thing once: the bar does not repeat the closed project
while its notice stands. „Jemand anderes hat diese E-Mail inzwischen
bearbeitet.“ wears the default notice, not a blue of its own; who it was is not
on the wire (`InboundMailView` carries no decider), so it does not say.

The open mail stays current: while a part is scanned, the original is, or the
agent is still reading a part with no place (`mailStillSettling`), it is read
again at a growing pause (twice the poll, then ×1.5, at most 30 s). A re-read,
a refusal's reload included, keeps every choice the person made while the mail
has the same parts (`rebaseDraft`): only parts nobody touched take the new
defaults. After a filing it is read until every part has landed; past 40 quick
rounds it says „Das dauert länger als üblich. Die Ablage läuft weiter; Sie
können die E-Mail verlassen.“ and keeps asking, slowly.

On a phone (390×844) the header, the text and the first attachment fit the
first screen with the decision bar, and a mail's toasts („E-Mail verworfen ·
Rückgängig“, the filing's) stand at the foot over the bar, not over the subject
at the top (`mailToast`: on the phone layout the global toaster's
`bottom-center`, lifted by the bar's height).

**Filing confirms itself** (`filed-to.tsx`, `lib/filed.ts`; the part views'
`filedAs`, per viewer like `documentId`). A filed attachment: „Abgelegt in
{Ordner} · Fassung {N} · Öffnen“ (root: „Dateien (oberste Ebene)“), its row
showing the name it was filed under. A filed text names its Verlauf, never a
Fassung (`filedPlace` drops a message's version): „In E-Mail-Verlauf „{Name}“
abgelegt · Öffnen“; by a follow „Dem E-Mail-Verlauf „{Name}“ angefügt (Verlauf
folgen)“. Where the viewer may not read the
folder: „In Dateien abgelegt“ / „In einem E-Mail-Verlauf abgelegt“, never the
place. One toast after a filing in the detail („1 Datei und der E-Mail-Text
abgelegt“, „N Dateien abgelegt“, „E-Mail-Text abgelegt“) with a line per part
(„E-Mail-Text → „Stellplatznachweis““, „Bescheid_MA37….pdf →
Behörde/Bescheide · Fassung 1“) and „Ansehen“. A filing has no undo;
„Öffnen“ and „Ansehen“ are the way on. A mail of which something was filed and
one part dismissed says „1 Teil verworfen · wiederherstellbar bis …“ instead
of a page-wide „Verworfen · …“.

**The agent's mark** (✦) leads „Vorschlag von {productName}“ over an
attachment's place only when a field of it is the agent's stored suggestion;
the rule's default folder for a new Verlauf is a plain „Ordner: …“.

**Bulk** by selection: „{n} ausgewählt · Wie vorgeschlagen ablegen ·
Verwerfen“, enabled only when every selected mail is complete
(`incompleteReason === null`); while it is not, the reason stands as a line
under the count („Bei 1 E-Mail muss der Absender bestätigt werden. Öffnen Sie
sie einzeln.“, the press's description), never behind an ⓘ. It never carries
an acknowledgement and confirms with a dialog grouped by destination.

**After a decision the next mail opens.** When the open mail no longer waits
after the reader filed (once it landed) or dismissed it, the mail below it in
the list opens, else the one above, and the focus goes to its row; with none
left the list stands alone, on a phone too (`nextOpenAfter`, `wasDecided`; the
detail's `onChanged`). A mail that still waits, a restore or a filing that
failed, stays open. On a phone the open mail's header carries where it stands
and the step to its neighbours, where the address menu stands over the list:
„2 von 9“ with ↑ „Vorige E-Mail“ and ↓ „Nächste E-Mail“ (`mail-stepper.tsx`,
the rows on show, replaced not pushed); the list once came back after each
decision and the way to the next mail was a guess.

**Live.** The list reads itself again when the shared count's read (every 60 s
and on focus) sees the waiting mail change, and on the project shelf's hint
(`useShelfLive`: a colleague's filing lands as documents), not within five
seconds of its own read. Mail arriving publishes no browser hint, so arrival
shows within the minute.

**States**, each with its own copy: empty (never received / nothing waits /
nothing handled), loading, load error, suggestion pending („{productName} liest
noch …“), no suggestion, decided by someone else, partial failure, quota full,
closed project („Projekt ist abgeschlossen – wieder öffnen, um abzulegen“,
dismiss possible), expired and dismissed („… · wiederherstellbar bis {Datum}“),
original not clean, feature off (`notFound()`).

**Keyboard** (group `inboundMail`, documented in the cheatsheet only with the
flag): J/K, Enter, X, Space, E „Einordnen (in der Übersicht: Ablegen)“, ⌫ „Verwerfen“. E opens „Einordnen“ on the open mail; inside it the list's keys stand down (a dialog is open) and the dialog's own E files from „Übersicht“, never while a field has the focus. None of
them answers while the profile turned shortcuts off (`useShortcutsPreference`).
⌫ and Entf act only where the reader is in the list or the mail: from the page,
the open row or the mail's text, never from a focused button, box, menu or
another row (`dismissKeyAllowed`). ⌫ dismisses every mail the same way, with
„Rückgängig“ in its toast: since every dismissal is restorable for 7 days,
the confirmation an outsider's mail once asked first is gone.

**Phone**: rows of at least 44px, the detail as a page, bottom sheets, a
decision bar of one note („Verwerfen“'s) over its two presses side by side with
`env(safe-area-inset-bottom)`, „Einordnen“ full screen with its presses pinned
at the foot, `text-base`, `dvh`.

## A Verlauf in Dateien

A Verlauf is a `.md` file of Dokumentart *Korrespondenz*, and the listing
showed exactly that: „Stellplatznachweis.md“, a text page's sketch, „MD · 6
kB“ and „Veröffentlicht“, as if someone had released it (the end-to-end walk of
round 4: the person who filed it read „E-Mail-Verlauf „Stellplatznachweis““ in
the E-Mail-Eingang and met a file format in the folder). The listing now says
what it is, from the server, never guessed from the name: the documents
listing carries `mailThread: { entryCount, lastEntryAt }` for a document that
is a Verlauf (`mailThreadsOfDocuments`, `bff/mail-thread/document-threads.ts`,
in `toDocumentWireRows`; one read of `mail_threads` per page, not on the
Büroablage). A tile shows a short stack of envelopes instead of a page, the name
without „.md“ (`listedFileName`), „3 E-Mails · zuletzt 14.10.2026“ where a file's
Fassungen and Freigabe stand, and „E-Mail-Verlauf · vor 1 Monat“ as its meta
line; a list row has the envelope in the format column, the same facts after
the name (on a phone on its second line) and „—“ for Freigabe
(`mail-thread-file.tsx`). The preview's header reads „E-Mail-Verlauf · 3
E-Mails“ and shows no Freigabe chip (`useMailThreadHeaderFacts`). A Verlauf's
Fassungen are its mails, which nobody releases.

## The rendition

`bff/mail-thread/render.ts`, one `##` section per mail, oldest first, as a
printed Akt reads; the headings never change, so a citation holds across
Fassungen. Under each heading „eingegangen …“, then the facts: **„Betreff“**
where the mail's own subject (`base_subject`, stored per entry since migration
0251) differs from the Verlauf's name, case and spaces aside („Betreff:
Stellplatznachweis – Nachreichung Statik“; a reply that changed the subject had
left no trace in the record, the search or the agent's passages), „Antwort
auf“, An, Cc, Termin, and „Anhänge“ with where each went, a folder as every
surface names one („abgelegt in Behörde/Bescheide“, never „/Behörde/…“).
Render version 4; the goldens are `bff/mail-thread/__golden__/`. A Verlauf
shows the new lines from its next Fassung on.

## The „E-Mails“ tab of a Verlauf

`features/documents/components/mail-thread/`. A Verlauf's preview rail (the
Dateien modal, the chat peek's „Details“ face, the phone's details sheet) has
two tabs, „E-Mails {n}“ and „Details“ (`rail-views.tsx`); „E-Mails“ is up when
a Verlauf opens. A document is asked whether it is a thread only when it can be
one, a `.md` file or Dokumentart *Korrespondenz*, with one `mail-thread-list
?documentId` call (`use-mail-thread-of-document.ts`).

- **Top**: „{n} E-Mails dieses E-Mail-Verlaufs warten im E-Mail-Eingang ·
  Ansehen“ (only for whoever may file), then the follow control. While the
  reader's switch is on, the line says why they wait anyway, from
  `waitingReasons` on the view: „2 E-Mails warten trotzdem im
  E-Mail-Eingang: Absender nicht überprüfbar oder kein Ordner für einen
  Anhang“ (also „vor dem Einschalten eingegangen“, „eine Prüfung nötig“;
  round 6: „An“ beside two waiting mails read as a switch that did not
  work).
- **Follow control** (`follow-control.tsx`): the switch of „Übersicht“
  (`FollowSwitch`), one label, one explanation, its state in words („An bis
  11.12.2026“ / „Aus“). A person who filed a text into this Verlauf already
  follows it (follow by default, ADR-0137's amendment of 2026-11-19), so for
  them it opens on, as „Übersicht“ said (round 4's preview showed it off
  beside a flow that had said on; `three-messages` follows now,
  `not-followed` does not). Switching on: toast „Antworten in „X“ werden bis
  {Datum} ohne Klick abgelegt“ with „Rückgängig“; switching off ends it.
  „Verlängern“ under it (only while 60 days from now reach at least a day
  past its end; every mail filed into the Verlauf already moves it to 60 days
  after that filing, so right after one there is nothing to renew, and the
  explanation says „Es endet erst, wenn 60 Tage lang nichts in diesen
  E-Mail-Verlauf abgelegt wurde.“). Others: „Auch für 2 weitere Personen eingeschaltet“; a
  member who may not file reads no switch but „Antworten in diesem
  E-Mail-Verlauf legt {productName} für 2 Personen ohne Klick ab.“; for a
  viewer with `managesFollows`, „Auch eingeschaltet für“ by name with
  „Beenden“ each.
- **One row per mail, newest first**, headed „Neueste zuerst“ (the document
  beside it reads oldest first; side by side the two orders read as one
  without the label) (`mail-thread-entry.tsx`): the heading
  exactly as the document cites it, which prints the sending on the office's
  clock; „eingegangen {Zeit}“ on that clock too (`receivedAtLabel`,
  `OFFICE_TIME_ZONE`): the time alone on the heading's day, else date and time.
  „Original (.eml)“ stands on that line as a quiet press, the evidence one
  press away (a raised press on every mail made the rail a column of identical
  buttons, design principle 6).
  On the reader's clock a heading at 09:12 once stood over „eingegangen 07:13“,
  and the preview's hand-written headings over one fixed arrival made every
  mail „eingegangen 09:30“ (`printedHeading` in the fixture now prints them as
  the server does). No „ab Fassung N“: the mail is not a Fassung; trust
  in three words: „Domain bestätigt: {domain}“ once per run of consecutive
  mails from the same confirmed domain, on the newest (`entriesSayingTrust`);
  „Absender nicht überprüfbar“ with the warning glyph and „Aus dem
  Outlook-Archiv · nicht geprüft“ on every mail. The heading wraps between
  date, name and domain, never inside the date (the space after it stands
  outside the unbroken date, or a name had no place to wrap but inside a
  word), a long German name hyphenates (`lang="de"`, `hyphens: auto`), and
  it is still exactly what the document prints; an attachment's name is one
  line cut in its middle (`FittedName`), one underline. Preview:
  `/dev/mail-thread?variant=same-sender`; how it was
  filed only where no person decided in the app (agent, the agent card, follow,
  archive import); „Anhänge“: each a link to its document, its note under its
  own name, indented past the file's glyph, the files 8px apart (with 2px a
  note read as the next file's): the folder a filed one lies in now, under
  its name with a folder glyph and quiet, as „Übersicht“ says it
  („Tragwerk/Statik“, „Dateien (oberste Ebene)“; the view's `folderPath`;
  round 7's „Ordner “ before it left the word alone on a line in the rail),
  „lag schon im Projekt“, „nicht abgelegt · {Grund}“ (15 reasons); one with
  no filename is „Unbenannter Anhang“ (the Verlauf's row carries neither type
  nor size, nor whether it was a picture of the text); one in a folder the
  reader cannot see is „Nicht sichtbarer Anhang“ („Anhang {n}“ said nothing)
  with „liegt in einem Ordner mit eigenen Zugriffsrechten; öffnen kann ihn,
  wer dort eingetragen ist“ (never named; „…, den Sie nicht sehen“ read as
  watched).
- **Row actions**: „Original (.eml)“ on the „eingegangen“ line (a 409
  `original_not_clean` replaces the press with „Das Original enthält
  Schadsoftware und kann nicht heruntergeladen werden“; an archive entry says
  „Kein Original: aus dem Outlook-Archiv übernommen“; a running scan says so;
  each as a fact line under the row). The row's ⋯ holds „Was diese E-Mail
  hinzufügte“ (the Verlauf before this mail against the Verlauf with it,
  inline under its own label, closed by „Ausblenden“; not on the mail that
  started the Verlauf) and „Herauslösen …“ (only for whoever may file, never on
  the thread's only mail); a row with neither has no ⋯.
- **Herauslösen** (`detach-dialog.tsx`): „Der E-Mail-Verlauf enthält diese
  E-Mail danach nicht mehr. Seine früheren Fassungen unter „Details“ behalten
  sie.“ (the Verlauf is a document, its Fassungen are listed there; the tab
  names no numbers) and „Antworten werden danach in diesem E-Mail-Verlauf für
  niemanden mehr ohne Klick abgelegt.“; the target is
  another thread or „Als neuen E-Mail-Verlauf“ (name, same folder). It is the
  kit's form dialog, not the confirm dialog: „Abbrechen“ a raised press beside
  the ink primary „Herauslösen“, the focus on the dialog on opening, never on a
  radio. Refusals are
  said in the dialog (`MAIL_THREAD_REFUSALS` and a closed project). A typed
  name is an edit: Escape, the X, a scrim click and „Abbrechen“ ask „Änderungen
  nicht übernehmen?“ first (`useUnsavedEditGuard`), as the attachment's
  „Ändern“ dialog does for Escape, the X and the scrim.
- **Links**: `/app/projects/{id}/files?doc={threadDocumentId}&mailEntry={entryId}`
  opens the Verlauf with „E-Mails“ up and the entry scrolled to and marked (the
  `Item`'s current state: lifted to the card with the selected hairline all
  round, `aria-current="location"`, focus moves; no bar down its edge). Closing or switching the
  preview drops `mailEntry`. A chat citation does not carry the section heading
  on the wire yet, so a citation opens the Verlauf without scrolling to its
  entry.

## Provenance (D36)

Under the preview header (the header keeps its one shape), a row for a document
whose newest Fassung came with a mail: „Kam mit der E-Mail von {Name} am
{Datum} · Domain bestätigt: {domain} · Im E-Mail-Verlauf ansehen“
(`mail-provenance-row.tsx`, from `document-version-list`'s `mailOrigins`);
several mails add „+{n} weitere“. „Im E-Mail-Verlauf ansehen“ opens the Verlauf
with „E-Mails“ up and that mail marked (`?mailEntry=`). Each Fassung row of
„Fassungen und Freigabe“ that a mail brought carries the same line
(`document-revisions.tsx`). It does not yet name the Verlauf („Im
E-Mail-Verlauf „Stellplatznachweis“ ansehen“): `MailOriginView` carries no
thread name (below).

## The Postfach's words for filing without a click

The notices of a follow say what the app says, never „folgen“, which read as
notifications (`collaboration` dictionary; `inbound-mail-copy.spec.ts` holds
it): `inbound_mail.appended` „Eine Antwort wurde ohne Klick einem
E-Mail-Verlauf in „{Projekt}“ angefügt“ (with attachments „… samt Anhängen
wurde in „{Projekt}“ ohne Klick abgelegt“), `mail_thread.follow_expiring`
„Antworten in einem E-Mail-Verlauf in „{Projekt}“ werden nur noch 5 Tage ohne
Klick abgelegt“, `mail_thread.follow_ended` „… werden nicht mehr ohne Klick
abgelegt, weil …“ with the reason, and a body that says where to switch it on
again („im E-Mail-Verlauf unter „E-Mails““). They name the project, not the
Verlauf: no subject or file name of a mail reaches a row or a push
([`inbound-mail.md`](../architecture/inbound-mail.md#the-twelve-notices)).

## Contrast, measured

`--warning` text measures 4.48:1 on paper and 4.2:1 inside the kit's
`Alert variant="warning"` at 12–14px, under WCAG AA. The E-Mail-Eingang draws
warnings as a gold glyph with ink words (`FactLine tone="warning"`,
`components/ui/fact-line.tsx`) and the default Alert with a gold icon, and what
makes filing impossible as a red glyph with ink words (`tone="danger"`). The
open row lifts to `bg-card` with the selected hairline inset all round instead
of a tint (`bg-accent/70` behind muted 12px text is 4.33:1), and the keyboard's
row (J/K) wears the keyboard's ring, inset: `Item`'s `data-current` and
`data-cursor`. Neither is a bar down the row's edge (design language,
„Emphasis without a stripe“). Each attachment's „Wird auf Schadsoftware
geprüft …“ and „Wird abgelegt …“ is a still glyph; the detail's own „Wird
abgelegt …“ line is the one spinner (one ambient loop per screen). The kit's warning Alert is a known AA gap of the
design system ([`design-language.md`](../design/design-language.md)).

## Not built yet

- The Verlauf's name on a notice (`inbound_mail.appended`, the follow notices):
  the payload rule keeps every mail-derived name off rows and pushes; the in-app
  row could resolve the document's name at read time, as `listInbox` resolves
  the waiting count, the push never.
- `mail_thread.follow_ended` lands on the E-Mail-Eingang even where its body
  says to switch it on again (`detached`, `address_rotated`): the row is
  anchored on the project and the follow, not the Verlauf
  (`announceFollowEnded`), so `inboundMailLink` cannot open the Verlauf.
- The Verlauf's name on the provenance row: `findMailOrigins` joins the
  Verlauf's document already; `MailOriginView` and its schema would carry it.
- Which mail each of a Verlauf's Fassungen added, under „Details“: the
  timeline lists them by uploader; `MailThreadEntryView.firstVersion` has the
  mapping.
- „Wie vorgeschlagen ablegen“ on the Postfach row and on the push: the waiting
  row is collapsed per project, so the action needs a product call (only for a
  row of one mail, or „Alle vollständigen ablegen“), and a push action needs a
  payload version and a `notificationclick` branch.
- „Als Fortsetzung ablegen“ for a full Verlauf (`thread_full` today asks for a
  new Verlauf).

## Following ends with the project

Closing a project ends every running follow of its E-Mail-Verläufe, as the
manager who closed it, reason `project_closed` („Das Projekt wurde
abgeschlossen“; `endFollowsOnProjectClose` in `lib/mail-thread/follows.ts`,
called from `lib/projects/service.ts`). Mail that still arrives waits for a
person as before. Reopening starts no follow again: following is the
follower's own act. Sweep 12 also ends, as the system, a follow it finds
running in a closed project, so a close whose follow-ending failed is caught
on the next sweep.
