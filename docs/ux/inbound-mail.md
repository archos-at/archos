# Project mail: the E-Mail-Eingang, the E-Mails tab and provenance

**Date:** 2026-10-27, the detail and the E-Mails tab reworked 2026-11-19; the decision on one mail said in plain words 2026-11-19 (round 2)
**Status:** Implemented, the W1 rework included
**Surfaces:** Dateien › E-Mail-Eingang (`/app/projects/[id]/files/mail`, `…/mail/[mailId]`), the address dialog and the settings card, the „E-Mails“ tab of a Verlauf's preview, the provenance row of a document that came by mail, the Postfach rows
**Preview:** `/dev/inbound-mail?variant=…`, `/dev/inbound-mail-detail?variant=…`, `/dev/inbound-mail-address?variant=…[&dialog=1]`, `/dev/mail-thread?variant=…`, `/dev/inbox?variant=mail`; each with `&locale=en`, and `&chrome=0` hides the variant strip. The variant lists are in each page's header.
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
  A read that stopped at its page says so: „50+“ and „Mehr als 50 E-Mails
  warten auf Ablage“; the list primes the count only from a page it read whole.
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
- Settings › Dokumente: the address card (create, „Neue Adresse erzeugen …“,
  „Ausschalten …“; managers only), „So kommt die Korrespondenz ins Projekt“
  (Cc and redirect, a line each with „Anleitung kopieren“) and „Bestehende E-Mail-Adressen
  für das Projekt“ (managers add and remove, members read;
  `/dev/inbound-mail-address?variant=forwards`).
- The Postfach rows of the seven notices (`/dev/inbox?variant=mail`).
  „E-Mails warten“ opens the list at „Bereit“ (`/files/mail#ready`,
  `lib/inbox/targets.ts`).

## The address dialog

Every door leads with what the address is for
(`features/inbound-mail/components/inbound-mail-address.tsx`). The dialog
(from „Per E-Mail senden …“ and „Adresse“) is titled „E-Mail-Adresse des
Projekts“, says „So landet die Korrespondenz im Projekt, ohne dass jemand sie
aus dem Mailprogramm herunterlädt und wieder hochlädt.“, then three lines: „Setzen Sie sie in Cc, wenn Sie an
Behörde, Statik oder Bauherrschaft schreiben: die Antworten landen im
E-Mail-Eingang.“, „Leiten Sie Unterlagen aus Ihrem Mailprogramm an sie
weiter.“, „Was jemand, der im Projekt ablegen darf, von der eigenen
Adresse sendet und die eigene Domain bestätigt, wird direkt abgelegt. Alles
andere wartet, bis jemand es ablegt; E-Mails von außerhalb des Büros 14 Tage
lang.“
Then the address, which a press copies (`CopyableValue`: a copy glyph beside
it, its name „Kopieren: {Adresse}“, „Kopiert“ announced; `EmailAddress` marks
where it may wrap: after
the `+`, before the token's dot and before the `@`, so a phone never splits
the domain, as `break-all` once did), „Als Kontakt sichern“ (a vCard), when mail last
arrived, how many automatic replies were dropped in 30 days, the size line
„Bis 25 MB pro E-Mail, Anhänge zusammen bis etwa 18 MB. Größere Dateien direkt
hochladen“ (the link goes to Dateien and closes the dialog; the overview tile
carries the same line), and „Anleitung“ (the help page, `/e-mail-eingang/`,
`/en/project-mail/`). Every number of days or bytes in this copy is a
placeholder filled from `inbound-mail-vocabulary.ts` (`INBOUND_MAIL_RESTORE_DAYS`,
`INBOUND_MAIL_STALE_DATE_DAYS`, `INBOUND_MAIL_ADDRESS_STATS_DAYS`,
`INBOUND_MAIL_MAX_MESSAGE_BYTES`), so the words cannot drift from the rule.

The office's own DKIM line („{n} % der E-Mails Ihres Büros der letzten 30 Tage
waren von Ihrer Domain bestätigt“, or „Ihre Domain signiert ihre E-Mails nicht
– so richten Sie es ein“ linking to the help page's `#dkim`) is on the settings
card only, and only for a manager; derived from rows, never a DNS probe. The
settings card's description leads with Cc too. A member without the right to
manage sees „Bitten Sie jemanden, der das Projekt verwaltet, sie in den
Projekteinstellungen zu erzeugen.“ Rotation's confirm says that every follow on
the project ends.

The E-Mail-Eingang's header shows the address itself (a press copies it) and
„Mehr zur Adresse“ (the dialog); a manager without an address reads „Adresse
erzeugen“ there, a member nothing.

Never used, the page is about the address: the list takes the whole width,
says „Noch keine E-Mails an dieses Projekt“ and the two ways mail gets here,
one line each: „Setzen Sie die Adresse in Cc, wenn Sie an Behörde, Statik oder
Bauherrschaft schreiben: Die Antworten landen hier.“ and „Hat das Projekt in
Ihrem Büro schon eine eigene Adresse, leiten Sie sie hierher weiter.“ (what is
filed directly is the address dialog's), and holds one sheet with the address a size up, „Kopieren“
(primary) and „Als Kontakt sichern“; the header's address and the
Wartet/Bearbeitet switch stand down. Without an address: „Dieses Projekt hat
noch keine E-Mail-Adresse …“ with „Adresse erzeugen“ for a manager, or whom to
ask for a member. An empty list never shows the „Wählen Sie …“ pane.

## The E-Mail-Eingang

**Layout by container, not viewport** (`inbound-mail-workspace.tsx`): a 22rem
list and the detail while the component's own box is wider than 48rem
(`@3xl`); below, list → detail with a back link. The filter lives on the URL
(`?status=handled`, replaced; the route and `inbound-mail-list` still take
`?outcome=`); an opened mail is pushed.

**The list** („Wartet auf Ablage · Bearbeitet“; `lib/list-sections.ts`,
`lib/completeness.ts`, `inbound-mail-list.tsx`, `inbound-mail-row.tsx`).
„Wartet auf Ablage“ has up to three headings: „Bereit ({n})“ first, „Braucht Sie
({n})“ second, „Wartet auf andere ({n})“ third (mail only another member may
file, `onlySenderReleases`, never an impersonation: dismissing a forgery is the
reader's to do), then the group „Automatisch ({n})“ (absence notes,
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
„Bereit“ means the server's `incompleteReason` is null and the mail does not
read as an impersonation (the client refuses an impersonation on its own side
too, `fileableReason`). „Bearbeitet“ is one list: each row says its outcome.

A row: the sender's domain, the subject without `AW:`/`WG:`, the time, „· 3
Anhänge“; suggestion chips; a trust or risk glyph. Over the rows a field
„Absender oder Betreff“ filters the loaded mail by sender and subject, every
word, without case or accents (`matchesQuery`, `lib/inbox-triage.ts`); the
count of matches is said once by a status, Escape clears it, and a search that
finds nothing says „Keine E-Mail passt zu „…““ with „Suche leeren“. The list's
rhythm is one: 32px between sections, 12px between a heading, a thread and a
run of rows inside one. Under „Bereit“: „Domain
bestätigt, für jeden Teil ein Ziel, nichts zu prüfen.“ and, with two or more
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
group under „Bereit“ with „Diese {n} wie vorgeschlagen ablegen“ (or „Die ersten
20 wie vorgeschlagen ablegen“); its replies that need a look are a group under
„Braucht Sie“ with „Ansehen“ (opens the first). The group line (the thread's glyph and „{name}“; „E-Mail-Verlauf“ and the
count in its title and the section's label) and its press share one row. The rows do
not repeat the thread: each subject drops the thread's name in front
(`subjectWithinThread`), so three replies read „Nachreichung Statik“, „Index C“
rather than three cut-off „Stellplatznachweis – …“. A row whose text a follow already appended shows no
thread line; its attachments still wait.

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
3. The „E-Mail-Text“ row: a checkbox and the target („An E-Mail-Verlauf „…“
   anfügen“, „Als neuen E-Mail-Verlauf ablegen“ with a name field and
   „Ordner: Korrespondenz“ beside one „Ändern“; the arrow chip „→ Korrespondenz“
   read as neither a label nor a press). When the mail's own text says
   something (six words or more, `substantiveText`), the row reads „Den
   E-Mail-Text mit ablegen (empfohlen)“; unchecked, the bar names it among what
   „Ablegen“ dismisses, in ink with the warning glyph. Which part is preselected
   stays the server's (`preselected`). A matching Verlauf in a folder the
   reader cannot see says what to do: „Ein weiterer passender E-Mail-Verlauf
   liegt in einem Ordner, den Sie nicht sehen. Gehört die E-Mail dorthin,
   lassen Sie sie für jemanden liegen, der ihn sieht.“
   When the text has content findings, they are one more question inside this
   row, under its target (`ContentFindingChoice`): „Im Text steht: IBAN, …“,
   „Die Inhaltsprüfung hält solche Angaben von {productName} fern, bis jemand
   sie prüft.“, then „Unkenntlich machen“ (selected) or „Ungekürzt ablegen“,
   whose hint names what it holds back: „… den ganzen E-Mail-Verlauf „X“ …
   Als neuer E-Mail-Verlauf abgelegt, bleibt „X“ frei.“ or „… den neuen
   E-Mail-Verlauf …“. The three choices of round 1 („Getrennt ablegen (eigener
   E-Mail-Verlauf)“ beside a selected „In E-Mail-Verlauf …“) read as two
   decisions that contradicted each other; „getrennt“ is „Ungekürzt“ with „Als
   neuen E-Mail-Verlauf ablegen“, the same request (`text: 'full'`,
   `thread.action: 'create'`).
4. „Anhänge“: on its heading, with two or more attachments to file, the count
   once, „{n} von {m} ausgewählt“, then „Alle auswählen“ / „Alle abwählen“ and
   „Ausgewählte in einen Ordner …“ (the folder picker; one choice sets the
   folder of every ticked attachment, a ticked next Fassung stays with its
   document, and a live region says „{n} Anhänge kommen nach „{Ordner}“.“).
   Two counts on two presses made the reader lose count. Per row: checkbox,
   thumbnail (clean images and PDFs only, drawn client-side in the sandboxed
   viewer; Office files show their tile), the name, „{Typ} · {Größe} ·
   Vorschau“ on a clean PDF or picture, the agent's suggestion, and the case
   notes (duplicate, revision, name stop, macro, type mismatch, not accepted,
   not staged). Where it goes is said as labelled facts, never as two chips
   that look alike (`PlaceFact`): „Ordner: Behörde/Bescheide“ (the whole path,
   the one the agent's reason names; „neuer Ordner“ when filing creates it;
   „Ordner: noch keiner“), „Dokumentart: Bescheid“, „Name: …“ when renamed.
   One press changes them: „Ändern“ opens the dialog, which holds the folder
   too („Anderen Ordner wählen …“; a next Fassung stays in its document's
   folder), and while there is no folder the press is „Ordner wählen“, never
   both side by side. An unverified next Fassung says why it is only a guess:
   „könnte Fassung {N} von {Name} sein, aber nur der Dateiname spricht dafür“
   (it said „Absender nicht überprüfbar“ under a header saying the domain was
   confirmed). An attachment the defaults left unticked for a reason a person
   should weigh (`asksForDecision`: selectable, not preselected, not a copy the
   project has, not a picture in the text) says so in ink with an ochre glyph:
   „Nicht vorausgewählt: Ohne Häkchen wird die Datei beim Ablegen
   verworfen.“ The parts that cannot be filed one by one are listed without a
   suffix each, and one line under them says where they are: „Diese Dateien
   stecken nur im Original (.eml): Laden Sie es oben unter „Details“ herunter.
   Mit dem E-Mail-Text abgelegt, bleibt es beim E-Mail-Verlauf.“
   „Vorschau“ (and Space, from the list) opens the attachment large: a PDF in
   the app's own viewer (`PdfDocumentView`: every page, the page steps, zoom,
   search; pdf.js draws it, nothing of it runs), a picture whole; full screen
   on a phone; with more than one, „Anhang 2 von 5“, „Voriger“ / „Nächster“
   and ← →. Closing it, and closing „Ändern“, hands the focus back to the
   press that opened it. A clean attachment
   says nothing about its scan; „Wird auf Schadsoftware geprüft …“, „Prüfung
   fehlgeschlagen, wird wiederholt“ and „Schadsoftware gefunden · lässt sich
   nicht ablegen“ still show.
5. The decision bar, pinned and safe-area padded, says what one press does
   (`planLabel`, `leftLabel`, `draftSummary`'s `textPlan`, `filesPlan`, `left`,
   `undecided`, `dismissErases`), in three lines left of the presses on a desk
   and above them on a phone: what „Ablegen“ files, in ink („E-Mail-Text an
   E-Mail-Verlauf „Stellplatznachweis“ anfügen · 4 Anhänge in 2 Ordner
   ablegen“; one file by name, „Bescheid….pdf in Behörde/Bescheide ablegen“ or
   „S-101_D.pdf als Fassung 4 von S-101_C.pdf ablegen“; „ (Fundstellen
   unkenntlich)“ after a masked text; at most two lines, it is the press's
   description); what „Ablegen“ dismisses with it, because the server
   dismisses every waiting part not ticked (`writeMailDecisions`):
   „Nicht ausgewählt, beim Ablegen verworfen: E-Mail-Text samt Original,
   S-101_D.pdf“ (names while one or two files, else „{n} Anhänge“), muted, and
   in ink with the warning glyph when it holds the mail's own words or an
   attachment that asks for a decision; and what „Verwerfen“ does, which the
   reader asked about her Outlook: „Verwerfen wirkt nur in {productName}, nicht
   im Mailprogramm, und lässt sich 7 Tage lang wiederherstellen.“, for an
   unconfirmed outsider „… Bei einem nicht überprüfbaren Absender ist
   Verworfenes gleich gelöscht.“ (`dismissErases`; that dismissal's toast
   offers no „Rückgängig“). Then „Verwerfen“ and „Ablegen“ side by side, on a
   phone too (the primary the wider, nearest the thumb).
   „Ich kenne den Absender und vertraue dieser E-Mail“ (the member's own: „Ja,
   ich habe diese E-Mail gesendet“; a colleague's checked by another writer:
   „Ich habe geprüft, dass diese E-Mail von {Name} ist“; a forgery's: „Ich habe
   telefonisch geprüft, dass die E-Mail echt ist“) only where the server asks
   for `acknowledgeSender`; no confirmation ends in „Ablegen“, which read as if
   ticking filed. Every confirmation says what the person affirms, never
   one „Trotzdem ablegen“ for six things: „Ich vertraue dem Absender dieser
   Datei“ (macro, type mismatch), „Ich bin sicher, dass es die nächste Fassung
   ist“; „Trotzdem ablegen“ is left to the Namensprüfung, whose word it is. A
   confirmation's whole row is its label, 44px tall under a coarse pointer. „E“
   with a blocker files nothing and says the first blocker in a `role="status"`
   region. A colleague of a claimed mail gets `ClaimedMailBar` instead (above).
6. After filing, the follow offer: „E-Mail-Verlauf „{Name}““ with one line
   of what it does and the button „Folgen“, only when the sender would qualify.
   Followed, the card says „Sie folgen „{Name}““, that replies are added from
   now on, and offers „Nicht mehr folgen“.

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
left the list stands alone; on a phone the list comes back
(`nextOpenAfter`, `wasDecided`; the detail's `onChanged`). A mail that still
waits, a restore or a filing that failed, stays open.

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
flag): J/K, Enter, X, Space, E „Wie gezeigt ablegen“, ⌫ „Verwerfen“. None of
them answers while the profile turned shortcuts off (`useShortcutsPreference`).
⌫ and Entf act only where the reader is in the list or the mail: from the page,
the open row or the mail's text, never from a focused button, box, menu or
another row (`dismissKeyAllowed`). For an outsider's mail whose domain did not
confirm it, which the sweep erases at once when dismissed, ⌫ asks first
(„E-Mail verwerfen? … Verworfen wird die E-Mail gelöscht und lässt sich nicht
wiederherstellen.“) and its toast offers no „Rückgängig“ (`dismissErases`).

**Phone**: rows of at least 44px, visible checkboxes, the detail as a page,
bottom sheets, a decision bar of its plan, what goes with it and what
„Verwerfen“ does over its two presses side by side with
`env(safe-area-inset-bottom)`,
`text-base`, `dvh`.

## The „E-Mails“ tab of a Verlauf

`features/documents/components/mail-thread/`. A Verlauf's preview rail (the
Dateien modal, the chat peek's „Details“ face, the phone's details sheet) has
two tabs, „E-Mails {n}“ and „Details“ (`rail-views.tsx`); „E-Mails“ is up when
a Verlauf opens. A document is asked whether it is a thread only when it can be
one, a `.md` file or Dokumentart *Korrespondenz*, with one `mail-thread-list
?documentId` call (`use-mail-thread-of-document.ts`).

- **Top**: „{n} E-Mails dieses E-Mail-Verlaufs warten im E-Mail-Eingang ·
  Ansehen“ (only for whoever may file), then the follow control.
- **Follow control** (`follow-control.tsx`): following, „Sie folgen diesem E-Mail-Verlauf
  bis {Datum}“ with „Verlängern“ (only while the follow can grow at least a day
  within 180 days of its start; otherwise „Folgen gilt höchstens 180 Tage ab
  Beginn. Danach erneut folgen.“) and „Nicht mehr folgen“. Not following: a
  card titled „Diesem E-Mail-Verlauf folgen“, one line of what it does and the
  button „Folgen“; toast „Sie folgen
  „X“ bis {Datum}“ with „Rückgängig“. Others: a count („2 weitere Personen
  folgen“); for a viewer with `managesFollows`, „Wer folgt“ by name with
  „Beenden“ each.
- **One row per mail, newest first** (`mail-thread-entry.tsx`): the heading
  exactly as the document cites it; „ab Fassung N · eingegangen {Zeit}“; trust
  in three words: „Domain bestätigt: {domain}“ once per run of consecutive
  mails from the same confirmed domain, on the newest (`entriesSayingTrust`);
  „Absender nicht überprüfbar“ with the warning glyph and „Aus dem
  Outlook-Archiv · nicht geprüft“ on every mail. The heading wraps between
  date, name and domain, never inside the date (the space after it stands
  outside the unbroken date, or a name had no place to wrap but inside a
  word), a long German name hyphenates (`lang="de"`, `hyphens: auto`), and
  it is still exactly what the document prints; an attachment's name is one
  line cut in its middle (`FittedName`), one underline; „ab Fassung N“ and „eingegangen …“ wrap as two units. Preview:
  `/dev/mail-thread?variant=same-sender`; how it was
  filed only where no person decided in the app (agent, the agent card, follow,
  archive import); „Anhänge“: each a link to its document, „lag schon im
  Projekt“, „nicht abgelegt · {Grund}“ (15 reasons), or „Ein Anhang in einem
  Ordner, den Sie nicht sehen“ (never named).
- **Row actions**: „Original (.eml)“ (a 409 `original_not_clean` replaces the
  button with „Das Original enthält Schadsoftware und kann nicht
  heruntergeladen werden“; an archive entry says „Kein Original: aus dem
  Outlook-Archiv übernommen“; a running scan says so), „Vergleichen“ (this mail's
  Fassung against the one before, inline), ⋯ „Herauslösen …“ (only for whoever
  may file, never on the thread's only mail).
- **Herauslösen** (`detach-dialog.tsx`): „Fassung {a} bis {b} behalten diese
  E-Mail. Dieser E-Mail-Verlauf bekommt Fassung {b+1} ohne sie.“ and „Wer
  diesem E-Mail-Verlauf folgt, folgt ihm danach nicht mehr.“; the target is
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

- Where a „Bearbeitet“ row went. The row says „1 Teil abgelegt“; the folder or
  Verlauf needs the parts' `filedAs` on the list's summary view
  (`summaryView`, `bff/inbound-mail/mail-views.ts`), which carries none.
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
