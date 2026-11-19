# Project mail: the E-Mail-Eingang, the E-Mails tab and provenance

**Date:** 2026-10-27, the detail and the E-Mails tab reworked 2026-11-19; the decision on one mail said in plain words, and the address, the list and the E-Mails tab again after a cold read, 2026-11-19 (round 2); the mail read in the pane and filed through „Einordnen“ 2026-11-19 (round 3)
**Status:** Implemented, the W1 rework included
**Surfaces:** Dateien › E-Mail-Eingang (`/app/projects/[id]/files/mail`, `…/mail/[mailId]`), the address dialog and the settings card, the „E-Mails“ tab of a Verlauf's preview, the provenance row of a document that came by mail, the Postfach rows
**Preview:** `/dev/inbound-mail?variant=…`, `/dev/inbound-mail-detail?variant=…`, `/dev/inbound-mail-address?variant=…[&dialog=1]`, `/dev/mail-thread?variant=…` (the rail beside its Verlauf on a wide screen, alone on a phone, as the preview draws it), `/dev/inbox?variant=mail`; each with `&locale=en`, and `&chrome=0` hides the variant strip. The variant lists are in each page's header.
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
  Behörde, Statik und Bauherrschaft in den E-Mail-Eingang, bereit zum
  Ablegen.“, the address (a press copies it), „Als Kontakt sichern“ and the footer
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
down. Without an address: „Dieses Projekt hat noch keine E-Mail-Adresse …“
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
first (soonest first, the rest in the server's order) and says so on its row:
„Läuft in 2 Tagen ab“, „Läuft in weniger als einem Tag ab“ (after its reason,
or on a line of its own with an hourglass); an outsider's mail is erased 14
days after it came.
„Ablagebereit“ means the server's `incompleteReason` is null and the mail does not
read as an impersonation (the client refuses an impersonation on its own side
too, `fileableReason`). „Bearbeitet“ is one list: each row says its outcome. A
mail filed without a click (by a follow, or its sender's own filing) adds a
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
run of rows inside one. „Ablagebereit“ says on hover „Domain bestätigt und
für jeden Teil ein Ziel vorgeschlagen: Ein Klick legt sie ab.“ and, with two or more
ready mails, „Alle {n} wie vorgeschlagen ablegen“ (bulk, confirmed and grouped
by destination; more than 20: „Die ersten 20 wie vorgeschlagen ablegen“, since
one request decides at most 20). A ready row outside a thread group carries
„Wie vorgeschlagen ablegen“, shown where the reader is (the open row, under the
pointer or the keyboard, always under a finger): one press, no confirmation,
the same request as bulk and never an acknowledgement. Under a finger it
stands only on the open row: shown on every row, one stray tap filed a mail. A
row whose parts are
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
rather than three cut-off „Stellplatznachweis – …“. A row whose text a follow already appended shows no
thread line; what still waits are the attachments the follow could not place
in an existing folder.

**Impersonation is a stop** (`riskLevel === 'impersonation'`). In the list the
row reads „Gibt sich als {Name} aus · nicht ablegen“ (a red glyph, the words
in ink) and has neither
the one-press button nor a checkbox: it can never join a bulk decision, nor by
the keyboard's X. The
detail opens with a full-width warning above the header („Vorsicht: Diese
E-Mail gibt sich als {Name} aus. …“ or „Vorsicht: Der Name {Name} gehört einem
Mitglied, die Adresse {Adresse} nicht.“, then „So beginnen Betrugsversuche mit
Kontoänderungen. …“). „Verwerfen“ is the primary button; the filing controls
fold behind „Trotzdem ablegen …“ („Nur wenn Sie telefonisch geprüft haben, dass
die E-Mail echt ist.“), and filing still needs „Ich habe telefonisch geprüft,
dass die E-Mail echt ist“, after which the primary reads „Als echt ablegen“:
the high-risk yes has its own words and its own verb, never the „Ablegen“ of
every other mail. Once opened the fold's button reads „Ablage schließen“.

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
   toggletip, never folded: „Echte Adresse“ (a confirmed domain, its own
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
   (`SenderWaitLine`: „Wartet auf Sie: …“ for the member's own, „Wartet auf
   Ablage: …“; for a colleague of a claimed mail, `waitReason.signature`,
   `replay` and `automatic` name only whom it waits for and why, because
   `ClaimedMailBar` right below already says „Sie können sie verwerfen.“,
   design principle 9) and, for a forward, „Von {Autor} · nicht überprüfbar ·
   weitergeleitet von {Name}“ (the Verlauf's and the provenance line's words)
   stay visible under it. The wait line wears an ochre clock only where it asks
   the reader to check something (`signature`, `replay`, `automatic`,
   `sender_unchecked`). A colleague without the right to file:
   „Wartet auf Sie: {Name} darf in diesem Projekt nicht selbst ablegen, Sie
   schon.“ An outsider's mail says, muted, until when it waits and that a
   reminder comes: „Von außerhalb des Büros. Wartet bis {Datum} auf eine
   Entscheidung, danach wird sie gelöscht. {productName} erinnert 5 Tage vorher
   daran.“ (`inbound_mail.expiring`, `INBOUND_MAIL_EXPIRING_NOTICE_DAYS`, to
   whoever may file; it replaced „… läuft sie nach 14 Tagen ab und lässt sich
   danach nicht wiederherstellen“, the page's most frightening sentence).
   „Details“ opens the sender's check, Gesendet, Eingegangen, every recipient
   (An, Cc, Antwort an), „Wartet bis {Datum}, danach läuft sie ab“ and
   „Original (.eml) herunterladen“ with „Öffnet sich im Mailprogramm; Bilder
   von außen werden dort geladen.“, or the original's infected or scanning
   line. In its last week the expiry comes forward into the header: „Wartet nur
   noch bis {Datum}“, for an outsider „…, danach wird sie gelöscht“
   (`expiryErases`), and the outsider's wait line stands down
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
   `lib/filing-plan.ts`): „Kommt nach Behörde/Bescheide · Bescheid“, „Wird
   Fassung 4 von S-101_C.pdf“, „Bleibt weg – liegt schon im Projekt“, „Noch
   kein Ordner“. Until the person has seen „Übersicht“ once, a part that asks
   for a decision says so instead (`attachmentOpenReason`): „Offen: Ordner
   wählen“, „Offen: {productName} liest noch …“, „Offen: könnte Fassung 4 von
   S-101_C.pdf sein“, „Offen: nicht vorausgewählt“, „Offen: Namensprüfung“,
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
   lang wiederherstellen.“, for an unconfirmed outsider „… Bei einem nicht
   überprüfbaren Absender ist Verworfenes gleich gelöscht.“ (`dismissErases`;
   that dismissal's toast offers no „Rückgängig“). On a phone only that
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
   per screen, „Schritt 2 von 3“ above the question only when there are two
   or more:
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
      question (the owner: no step only to confirm a proposal). The step is
      the text's row as before (`MessageRow`): „Den E-Mail-Text mit ablegen
      (empfohlen)“ when the text says something (`substantiveText`), „An
      E-Mail-Verlauf „…“ anfügen“ per candidate with its doubt, „Als neuen
      E-Mail-Verlauf ablegen“ with a name field and „Ordner: Korrespondenz“
      beside one „Ändern“, the hidden candidate's line („Ein weiterer
      passender E-Mail-Verlauf liegt in einem Ordner, den Sie nicht sehen.
      …“), and the content findings' one question under the target
      (`ContentFindingChoice`: „Im Text steht: IBAN, …“, „Unkenntlich
      machen“ selected or „Ungekürzt ablegen“, whose hint names what it holds
      back).
   3. „Anhänge“ for the attachments that need a decision
      (`openAttachmentIds`: no folder, a suggestion still pending, an unsure
      next Fassung, not preselected for a reason a person weighs
      (`asksForDecision`), a name stop or a risk not confirmed). The title
      is „Wohin kommt dieser Anhang?“ while each only lacks a folder, „Was
      geschieht mit diesem Anhang?“ / „… diesen 2 Anhängen?“ while one is a
      „whether“. Each is the editing row as before (`AttachmentRow`:
      checkbox, case notes, „Ordner: …“, „Dokumentart: …“, „Ändern“ with the
      target dialog, the confirmations „Ich vertraue dem Absender dieser
      Datei“, „Ich bin sicher, dass es die nächste Fassung ist“, „Trotzdem
      ablegen“). **An attachment without any folder is answered in the
      step** (`FolderChoice`, `folder-choice.tsx`; `folderlessIds`): the
      project's folders inline (`FolderPickerList`, the body of the
      documents' `FolderPickerSheet`, searchable), under up to four likely
      folders first (`quickPicks`: the agent's suggestion, the folders this
      mail's other attachments go to, where a plan's earlier Fassung lies).
      With two or more it reads „Alle 3 in diesen Ordner“ and one pick sends
      every ticked one there (`fileAllInto`; none ticked, it ticks and sends
      them all), so a plan set from an unknown sender is one choice. The
      attachments with a sure proposal are folded under „4 weitere wie
      vorgeschlagen · Ändern“; opened, and whenever every row shows, the
      heading's „Alle auswählen“ / „Alle abwählen“ and „Ausgewählte in einen
      Ordner …“ (with „{n} von {m} ausgewählt“) apply to all.
   4. „Übersicht“, always: „So wird die E-Mail abgelegt“ and one sentence per
      waiting part (`planLines`), the part first: „E-Mail-Text → an
      E-Mail-Verlauf „Stellplatznachweis“ anfügen“ (with „ (Fundstellen
      unkenntlich)“ after a masked text), „E-Mail-Text → als neuen
      E-Mail-Verlauf „…“ in Korrespondenz ablegen“, „Bescheid_MA37.pdf →
      Behörde/Bescheide · Bescheid“, „S-101_D.pdf → Fassung 4 von
      S-101_C.pdf“, „Foto_Baustelle.jpg → Fotos (neuer Ordner) · Foto“,
      „Angebot_2026.pdf → noch kein Ordner“, „Bescheid_alt.pdf bleibt weg –
      liegt schon im Projekt“, „E-Mail-Text bleibt weg, samt Original“, and
      for a part filing cannot take „bleibt weg – wird noch auf
      Schadsoftware geprüft“, „– Schadsoftware gefunden“, „– lässt sich nicht
      ablegen“. When the text goes into an E-Mail-Verlauf and its sender
      could be followed (`followOffered`), one quiet line under it:
      „Weitere Antworten in diesem E-Mail-Verlauf legt {productName} ohne
      Klick ab.“ (filing a text starts the follow; stopping it stays in the
      E-Mails tab). „E-Mail-Text ändern“ and „Anhänge ändern“ add that step
      when it was not asked. Then, truthfully, what pressing does to the rest,
      because the server dismisses every waiting part not in the decision
      (`writeMailDecisions`): „Was „bleibt weg“, verwirft {productName} beim
      Ablegen. Wiederherstellen lässt es sich 7 Tage lang.“, for an
      unconfirmed outsider (`dismissalIsFinal`) „… Bei einem nicht
      überprüfbaren Absender ist es damit gelöscht.“ What blocks filing
      stands above the primary with the warning glyph (`blockerText`), and the
      primary is disabled. The primary names the act: „Ablegen“; a forgery's
      „Als echt ablegen“; with nothing left to file „Verwerfen“.

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
   „Verwerfen“ is the primary, and „Einordnen …“ is offered (as the quiet
   press) only after „Trotzdem ablegen …“ („Nur wenn Sie telefonisch
   geprüft haben, dass die E-Mail echt ist.“; „Ablage schließen“ folds it
   again). Its first step is the phone check, nothing is preselected, so
   „E-Mail-Text“ and „Anhänge“ follow, and the yes is „Als echt ablegen“.
6. After filing, the follow offer: „E-Mail-Verlauf „{Name}““ with one line
   of what it does and the button „Folgen“, only when the sender would qualify.
   Followed, the card says „Sie folgen „{Name}““, that replies are added from
   now on, and offers „Nicht mehr folgen“.
6. After filing, the follow offer (`follow-offer.tsx`), named for what it does,
   since „Folgen“ read as notifications: „Antworten in „{Name}“ ohne Klick
   ablegen“, one line („Weitere Antworten von Beteiligten mit bestätigter Domain
   kommen 60 Tage lang in Ihrem Namen in diesen E-Mail-Verlauf, ihre Anhänge
   hierher. Sie können das jederzeit beenden.“) and „Einschalten“, only when
   the sender would qualify. Switched on, the card says „Antworten in „{Name}“
   werden ohne Klick abgelegt“, „In Ihrem Namen, 60 Tage lang. Anhänge warten
   weiter hier. „Beenden“ hört damit auf.“ and offers „Beenden“. The days are
   `MAIL_THREAD_FOLLOW_DEFAULT_DAYS`. Code and the Postfach's notices still say
   follow / „folgen“.

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
another row (`dismissKeyAllowed`). For an outsider's mail whose domain did not
confirm it, which the sweep erases at once when dismissed, ⌫ asks first
(„E-Mail verwerfen? … Verworfen wird die E-Mail gelöscht und lässt sich nicht
wiederherstellen.“) and its toast offers no „Rückgängig“ (`dismissErases`).

**Phone**: rows of at least 44px, the detail as a page, bottom sheets, a
decision bar of one note („Verwerfen“'s) over its two presses side by side with
`env(safe-area-inset-bottom)`, „Einordnen“ full screen with its presses pinned
at the foot, `text-base`, `dvh`.

## The „E-Mails“ tab of a Verlauf

`features/documents/components/mail-thread/`. A Verlauf's preview rail (the
Dateien modal, the chat peek's „Details“ face, the phone's details sheet) has
two tabs, „E-Mails {n}“ and „Details“ (`rail-views.tsx`); „E-Mails“ is up when
a Verlauf opens. A document is asked whether it is a thread only when it can be
one, a `.md` file or Dokumentart *Korrespondenz*, with one `mail-thread-list
?documentId` call (`use-mail-thread-of-document.ts`).

- **Top**: „{n} E-Mails dieses E-Mail-Verlaufs warten im E-Mail-Eingang ·
  Ansehen“ (only for whoever may file), then the follow control.
- **Follow control** (`follow-control.tsx`), in the follow offer's words. A
  person who filed a text into this Verlauf already follows it (follow by
  default, ADR-0137's amendment of 2026-11-19), so for them it usually opens
  switched on. Not switched on, a card titled „Antworten ohne Klick ablegen“,
  the line „Weitere Antworten von Beteiligten mit bestätigter Domain kommen 60
  Tage lang in Ihrem Namen hierher, ihre Anhänge in den bestehenden Ordner, den
  {productName} vorschlägt, sonst in den E-Mail-Eingang. Sie können das jederzeit
  beenden.“ and „Einschalten“; toast „Antworten in „X“ werden bis {Datum} ohne
  Klick abgelegt“ with „Rückgängig“. Switched on: „Antworten werden bis {Datum}
  ohne Klick abgelegt“, „In Ihrem Namen: der Text in diesen E-Mail-Verlauf,
  jeder Anhang in den bestehenden Ordner, den {productName} vorschlägt. Der Rest
  wartet im E-Mail-Eingang. „Beenden“ hört damit auf.“, „Verlängern“ (only while it can
  grow at least a day within 180 days of its start; otherwise „Höchstens 180
  Tage ab Beginn. Danach wieder einschalten.“) and „Beenden“. Others: „Auch für
  2 weitere Personen eingeschaltet“; for a viewer with `managesFollows`, „Auch
  eingeschaltet für“ by name with „Beenden“ each.
- **One row per mail, newest first** (`mail-thread-entry.tsx`): the heading
  exactly as the document cites it, which prints the sending on the office's
  clock; „eingegangen {Zeit}“ on that clock too (`receivedAtLabel`,
  `OFFICE_TIME_ZONE`): the time alone on the heading's day, else date and time.
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
  note read as the next file's): „lag schon im Projekt“, „nicht abgelegt ·
  {Grund}“ (15 reasons); one in a folder the reader cannot see is „Anhang {n}“
  with „abgelegt in einem Ordner, den Sie nicht sehen“ (never named).
- **Row actions**: „Original (.eml)“ (a 409 `original_not_clean` replaces the
  button with „Das Original enthält Schadsoftware und kann nicht
  heruntergeladen werden“; an archive entry says „Kein Original: aus dem
  Outlook-Archiv übernommen“; a running scan says so), „Was diese E-Mail
  hinzufügte“ (the Verlauf before this mail against the Verlauf with it, inline;
  closed by „Ausblenden“), ⋯ „Herauslösen …“ (only for whoever
  may file, never on the thread's only mail).
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
several mails add „+{n} weitere“. Each Fassung row of „Fassungen und Freigabe“
that a mail brought carries the same line (`document-revisions.tsx`).

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

- Where a „Bearbeitet“ row a person filed went. The row says „1 Teil
  abgelegt“; only a mail filed without a click names its place
  (`filedWithoutClick`).
- The server's `restorableUntil` for a dismissed part of an unconfirmed
  outsider's mail: it says seven days while the sweep erases the part at once
  (`pastRestore`, `sweep-erasure-repository.ts`). The detail says so in its
  bar and its toast offers no „Rückgängig“ (`dismissErases`); ⌫ asks first
  (above).

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
