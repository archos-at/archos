# Project mail: the E-Mail-Eingang, the E-Mails tab and provenance

**Date:** 2026-10-27, the detail and the E-Mails tab reworked 2026-11-19
**Status:** Implemented, the W1 rework included
**Surfaces:** Dateien › E-Mail-Eingang (`/app/projects/[id]/files/mail`, `…/mail/[mailId]`), the address dialog and the settings card, the „E-Mails“ tab of a Verlauf's preview, the provenance row of a document that came by mail, the Postfach rows
**Preview:** `/dev/inbound-mail?variant=…`, `/dev/inbound-mail-detail?variant=…`, `/dev/inbound-mail-address?variant=…[&dialog=1]`, `/dev/mail-thread?variant=…`, `/dev/inbox?variant=mail`; each with `&locale=en`, and `&chrome=0` hides the variant strip. The variant lists are in each page's header.
**Why:** [ADR-0137](../adr/0137-mail-sent-to-a-project-waits-until-a-person-files-it.md); the flow: [`inbound-mail.md`](../architecture/inbound-mail.md); the words: [`CONTEXT.md`](../../CONTEXT.md#project-mail).

## The rule

> **The server says what a mail asks of a person; the UI shows it.**

Completeness, the defaults (`preselected`), the sender's risk, thread groups
(„wird Fassung 4–7“) and the forwarded-from line are computed on the server
(`lib/inbound-mail/{sender-risk,review-defaults,thread-groups,forwarded}.ts`)
and carried on the views. The UI never derives them, so the app, an outside
agent and the agent's card see the same mail the same way.

One word per concept (DECISION §3, the i18n file headers say it again):
„E-Mail-Eingang“ is the place, „ablegen“ puts a part into the project,
„verwerfen“ says no to the whole mail, „wiederherstellen“ undoes either for
seven days, the „E-Mail-Verlauf“ is the conversation's document and its states
are „Fassung N“. The sender line names a domain, never a person. Never
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
group under „Bereit“ with „Als Fassung {a}–{b} ablegen“ (or „Die ersten 20 als
Fassung … ablegen“); its replies that need a look are a group under „Braucht
Sie“ with „Ansehen“ (opens the first, with no Fassung range, which would depend
on what is filed first). The group line (the thread's glyph and „{name}“; „E-Mail-Verlauf“ and the
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
   always together), then one muted line: the trust („Domain bestätigt:
   {domain}“ with its ⓘ toggletip; trust is never folded), the received time
   and „Details ▾“ (on a phone the time starts its own line, no dot left at the
   end of the trust's). One line of all six was the densest on the page. Trust
   is said as what it means for the reader, never as the protocol: a mail its
   domain did not sign reads „Absender nicht überprüfbar – Name und Adresse
   könnten gefälscht sein“, a member's address without that proof „Adresse eines
   Mitglieds · nicht überprüfbar, könnte gefälscht sein“; DKIM and DMARC are
   named only at the end of the ⓘ's help text („Technisch: …“). The
   sender's flags („An andere Empfänger adressiert“, …), why it waits
   (`SenderWaitLine`, one pattern, „Wartet auf {wen}: {warum}“: „Wartet auf
   Ablage: …“, „Wartet auf Sie: …“ for the member's own, „Wartet auf {Name}: …“;
   for a
   colleague of a claimed mail, `waitReason.signature`, `replay` and
   `automatic` name only whom it waits for and why, because `ClaimedMailBar`
   right below already says „Sie können sie verwerfen.“, design principle 9)
   and, for a
   forward, „Von {Autor} · nicht überprüfbar · weitergeleitet von {Name}“
   (the Verlauf's and the provenance line's words) stay visible under it. „Details“ opens Gesendet,
   Eingegangen, every recipient (An, Cc, Antwort an), „Wartet bis {Datum},
   danach läuft sie ab“ and „Original (.eml) herunterladen“ with „Öffnet sich
   im Mailprogramm; Bilder von außen werden dort geladen.“, or the original's
   infected or scanning line. In its last week the expiry comes forward into
   the header: „Wartet nur noch bis {Datum}“ (`lib/evidence.ts`,
   `EXPIRY_INLINE_DAYS = 7`).
2. The text: first lines, „Ganze E-Mail anzeigen“, „Zitierten Text anzeigen“.
   Plain text only. A link stays inert text; after it stand its domain in ink
   („→ dropbox.com“, so a look-alike host shows itself on a phone, which has no
   hover) and „Kopieren“ (`CopyableValue`), which copies the whole address.
3. The „E-Mail-Text“ row: a checkbox and the target („In E-Mail-Verlauf „…“
   ablegen (wird Fassung N)“, „Als neuen E-Mail-Verlauf ablegen“ with a name
   field). When the mail's own text says something (six words or more,
   `substantiveText`), the row reads „Den E-Mail-Text mit ablegen (empfohlen)“;
   unchecked, the bar says right above its presses, in ink with the warning
   glyph, „Der E-Mail-Text wird nicht abgelegt und ist nach der Ablage weg: Das
   Original wird gelöscht.“ (a mail of no words of its own keeps the quiet
   „Das Original der E-Mail wird nach der Ablage gelöscht“). Which part is
   preselected stays the server's (`preselected`).
   When the text has content findings, the choice stands here, after the text
   and beside its filing: „Unkenntlich ablegen“ (selected), „Getrennt ablegen
   (eigener E-Mail-Verlauf)“, „Ungekürzt in den E-Mail-Verlauf“.
4. „Anhänge“: on its heading, with two or more attachments to file, „Alle {n}
   auswählen“ / „Alle abwählen“ and „Alle {n} ausgewählten in Ordner …“ (the
   folder picker; one choice sets the folder of every ticked attachment, a
   ticked next Fassung stays with its document, and a live region says „{n}
   Anhänge kommen nach „{Ordner}“.“). Per row: checkbox, thumbnail (clean
   images and PDFs only, drawn client-side in the sandboxed viewer; Office
   files show their tile), the name, „{Typ} · {Größe} · Vorschau“ on a clean
   PDF or picture, the agent's suggestion, and the case notes (duplicate,
   revision, name stop, macro, type mismatch, not accepted, not staged).
   „Vorschau“ (and Space, from the list) opens the attachment large: a PDF in
   the app's own viewer (`PdfDocumentView`: every page, the page steps, zoom,
   search; pdf.js draws it, nothing of it runs), a picture whole; full screen
   on a phone; with more than one, „Anhang 2 von 5“, „Voriger“ / „Nächster“
   and ← →. Closing it, and closing „Ändern“, hands the focus back to the
   press that opened it. A clean attachment
   says nothing about its scan; „Wird auf Schadsoftware geprüft …“, „Prüfung
   fehlgeschlagen, wird wiederholt“ and „Schadsoftware gefunden · lässt sich
   nicht ablegen“ still show.
5. The decision bar, pinned and safe-area padded: the one-line summary of
   what the press files („{n} Dateien und den E-Mail-Text ablegen“ / „E-Mail-Text
   ablegen“ / „Nichts ablegen“, cut at its end), then „Verwerfen“ and „Ablegen“
   side by side, on a phone too (the primary the wider, nearest the thumb).
   „Ich kenne den Absender und vertraue dieser E-Mail“ (the member's own: „Ja,
   ich habe diese E-Mail gesendet. Ablegen“; a forgery's: „Ich habe telefonisch
   geprüft, dass die E-Mail echt ist“) only where the server asks for
   `acknowledgeSender`. Every confirmation says what the person affirms, never
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
showing the name it was filed under. A filed text: „In E-Mail-Verlauf „{Name}“
abgelegt · Fassung {N} · Öffnen“; by a follow „Dem E-Mail-Verlauf „{Name}“
angefügt (Verlauf folgen) · Fassung {N}“. Where the viewer may not read the
folder: „In Dateien abgelegt“ / „In einem E-Mail-Verlauf abgelegt“, never the
place. One toast after a filing in the detail („1 Datei und der E-Mail-Text
abgelegt“, „N Dateien abgelegt“, „E-Mail-Text abgelegt“) with a line per part
(„E-Mail-Text → „Stellplatznachweis“ · Fassung 4“, „Bescheid_MA37….pdf →
Behörde/Bescheide · Fassung 1“) and „Ansehen“. A filing has no undo;
„Öffnen“ and „Ansehen“ are the way on. A mail of which something was filed and
one part dismissed says „1 Teil verworfen · wiederherstellbar bis …“ instead
of a page-wide „Verworfen · …“.

**The agent's mark** (✦) appears on a folder chip only when the folder is the agent's
stored suggestion; the rule's default folder for a new Verlauf is a plain chip.

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
bottom sheets, a decision bar of one summary line over its two presses side
by side with `env(safe-area-inset-bottom)`,
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
  (`pastRestore`, `sweep-erasure-repository.ts`), so the detail's own
  „Verwerfen“ still offers „Rückgängig“ for it. ⌫ asks first (above).

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
