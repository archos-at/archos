/** The detail variants of the E-Mail-Eingang preview, one per state DECISION §9 names (`./fixtures.ts`). */

import type { InboundMailTextView, InboundMailView } from '@/lib/inbound-mail/inbound-mail-wire'
import { daysAhead, fixtureId, minutesAgo } from './fixture-base'
import { mail, messagePart, part, permitDecision, statik, suggestion, text, thread } from './fixture-builders'

// ------------------------------------------------------------ detail variants

export interface DetailFixture {
  view: InboundMailView
  text: InboundMailTextView
  decidedByOther?: boolean
  /** Keep the mail loading (the skeleton), or fail its read. */
  load?: 'loading' | 'error'
}

const memberVerified = mail({
  key: 'member-verified',
  subject: 'WG: Bescheid MA 37 – Stellplatznachweis',
  sender: {
    name: 'Miriam Huber',
    address: 'm.huber@huber-architektur.at',
    domain: 'huber-architektur.at',
    signerDomain: 'huber-architektur.at',
    trust: 'member_verified',
    reason: 'dkim_pass',
    flags: [],
  },
  parts: [messagePart({ id: fixtureId('message:member') }), permitDecision()],
  threadCandidates: [thread()],
})

const longName =
  'Einreichplanung_Stellplatznachweis_Tiefgarage_Ebene_-2_Brandabschnitte_und_Fluchtwege_überarbeitet_nach_Verhandlung_vom_14_10_2026_Index_F_final_final2.pdf'

export const DETAIL_VARIANTS: Record<string, DetailFixture> = {
  // Miriam forwards the MA 37's Bescheid from her own, signed domain: the suggestion reads the file's name, never the sender.
  'member-verified': {
    view: memberVerified,
    text: text({ ownText: 'Zur Ablage: der Bescheid zum Stellplatznachweis ist gestern gekommen.\n\nlg Miriam', quoted: [] }),
  },
  'external-unverified': {
    view: mail({
      key: 'external-unverified',
      subject: 'Angebot Fassadenreinigung',
      sender: { name: 'Clean & Shine GmbH', address: 'office@clean-shine.example', domain: 'clean-shine.example', signerDomain: null, trust: 'external_unverified', reason: 'dkim_none', flags: [] },
      parts: [messagePart({ id: fixtureId('message:ext') }), part({ name: 'Angebot_2026.pdf' })],
      threadCandidates: [],
    }),
    text: text({ ownText: 'Sehr geehrte Damen und Herren,\n\nanbei unser Angebot für die Fassadenreinigung.\n\nMfG' , quoted: [] }),
  },
  impersonation: {
    view: mail({
      key: 'impersonation',
      subject: 'Dringend: Kontoänderung Honorarnote',
      sender: { name: 'Miriam Huber', address: 'm.huber@huber-architektur.at', domain: 'huber-architektur.at', signerDomain: null, trust: 'member_unverified', reason: 'dkim_fail', flags: [] },
      parts: [messagePart({ id: fixtureId('message:imp') }), part({ name: 'Honorarnote_neu.pdf', riskFlags: ['name_stop'], nameStopTerms: ['Honorar'] })],
      threadCandidates: [],
    }),
    text: text({ ownText: 'Bitte überweisen Sie die offene Honorarnote ab sofort auf das neue Konto.', quoted: [] }),
  },
  // An outsider whose display name is a member's: the address is not theirs (D8b `claims_member_name`).
  'member-name': {
    view: mail({
      key: 'member-name',
      subject: 'Dringend: Kontoänderung Honorarnote',
      sender: { name: 'Miriam Huber', address: 'miriam.huber@mail.example', domain: 'mail.example', signerDomain: 'mail.example', trust: 'external_verified', reason: 'dkim_pass', flags: ['claims_member_name'] },
      parts: [messagePart({ id: fixtureId('message:member-name') }), part({ name: 'Bankverbindung_neu.pdf' })],
      threadCandidates: [],
    }),
    text: text({ ownText: 'Liebe Kolleginnen und Kollegen,\n\nbitte ab sofort die Honorarnoten auf das neue Konto im Anhang überweisen. Ich bin heute nicht erreichbar.\n\nMiriam', quoted: [] }),
  },
  // A mail with a colleague's address and a signature that failed, as another writer sees it: only Miriam can file it.
  'claimed-by-colleague': {
    view: mail({
      key: 'claimed-by-colleague',
      subject: 'Plan Tiefgarage Index G',
      sender: { name: 'Miriam Huber', address: 'm.huber@huber-architektur.at', domain: 'huber-architektur.at', signerDomain: null, trust: 'member_unverified', reason: 'dkim_none', flags: [] },
      onlySenderReleases: true,
      parts: [messagePart({ id: fixtureId('message:claimed') }), part({ name: 'TG_Index_G.pdf' })],
      threadCandidates: [],
    }),
    text: text({ ownText: 'Anbei Index G der Tiefgarage.', quoted: [] }),
  },
  'bcc-own': {
    view: mail({
      key: 'bcc-own',
      subject: 'AW: Stellplatznachweis',
      sender: { name: 'Miriam Huber', address: 'm.huber@huber-architektur.at', domain: 'huber-architektur.at', signerDomain: 'huber-architektur.at', trust: 'member_verified', reason: 'dkim_pass', flags: ['not_addressed_to_project', 'bcc_own'] },
      parts: [messagePart({ id: fixtureId('message:bcc') })],
    }),
    text: text({ ownText: 'Liebe Frau Weber,\n\ndanke, das passt so. Wir reichen am Montag ein.\n\nlg Miriam', quoted: [] }),
  },
  'not-addressed': {
    view: mail({
      key: 'not-addressed',
      sender: { name: 'Miriam Huber', address: 'm.huber@huber-architektur.at', domain: 'huber-architektur.at', signerDomain: 'huber-architektur.at', trust: 'member_verified', reason: 'dkim_pass', flags: ['not_addressed_to_project', 'stale_date'] },
      sentAt: minutesAgo(60 * 24 * 12),
      threadCandidates: [thread({ preselected: false, blocks: ['not_addressed_to_project', 'stale_date'] })],
    }),
    text: text(),
  },
  forwarded: {
    view: mail({
      key: 'forwarded',
      subject: 'WG: Verhandlungsschrift Bauverhandlung 04.11.',
      sender: { name: 'Miriam Huber', address: 'm.huber@huber-architektur.at', domain: 'huber-architektur.at', signerDomain: 'huber-architektur.at', trust: 'member_verified', reason: 'dkim_pass', flags: [] },
      parts: [messagePart({ id: fixtureId('message:fwd') }), permitDecision({ filename: 'Verhandlungsschrift_2026-11-04.pdf' })],
      threadCandidates: [],
    }),
    text: text({
      ownText: 'Zur Ablage.',
      quoted: [
        {
          header: '-----Ursprüngliche Nachricht-----',
          text: 'Von: MA 37 – Baupolizei <post@ma37.wien.gv.at>\nGesendet: Montag, 20. Oktober 2026 14:02\nAn: Huber Architektur\nBetreff: Verhandlungsschrift Bauverhandlung 04.11.\n\nSehr geehrte Damen und Herren,\n\nanbei die Verhandlungsschrift.',
        },
      ],
      // What the route reads from the quote above (`lib/inbound-mail/forwarded.ts`).
      forwardedFrom: { name: 'MA 37 – Baupolizei', address: 'post@ma37.wien.gv.at' },
    }),
  },
  'mixed-attachments': {
    view: mail({
      key: 'mixed',
      parts: [
        messagePart({ id: fixtureId('message:mixed') }),
        statik(),
        part({ name: 'Grundriss_EG.dwg', contentType: 'application/acad', sizeBytes: 5_800_000, suggestion: suggestion('Tragwerk', 'Grundriss', 'DWG mit Bezeichnung EG.') }),
        part({ name: 'Foto_Baustelle.jpg', contentType: 'image/jpeg', sizeBytes: 3_100_000, suggestion: suggestion('Fotos', 'Foto', 'Foto vom Bauplatz.', { newFolder: true }) }),
        part({ name: 'Bescheid_alt.pdf', duplicateOf: { documentId: fixtureId('doc:bescheid'), name: 'Bescheid_alt.pdf', folderPath: 'Behörde/Bescheide' } }),
        part({ name: 'Statik_verschluesselt.pdf', riskFlags: ['encrypted'], suggestion: suggestion('Tragwerk', null, 'Nur nach dem Namen.') }),
        part({ filename: null, contentType: 'image/png', sizeBytes: 182_000 }),
      ],
      notStaged: [
        { filename: 'winmail.dat', reason: 'tnef' },
        { filename: 'Pläne_Archiv.zip', reason: 'archive' },
        { filename: 'logo.png', reason: 'embedded' },
        { filename: 'linkedin.png', reason: 'embedded' },
        { filename: 'smime.p7s', reason: 'signature' },
        { filename: 'Einladung.ics', reason: 'calendar' },
      ],
    }),
    text: text({
      calendar: [{ summary: 'Bauverhandlung Bauplatz 12', start: '2026-11-04T08:00:00.000Z', end: '2026-11-04T10:00:00.000Z', allDay: false, location: 'MA 37, Dresdner Straße 73–75, 1200 Wien', status: 'CONFIRMED' }],
    }),
  },
  'type-not-accepted': {
    view: mail({
      key: 'type-not-accepted',
      parts: [
        messagePart({ id: fixtureId('message:tna') }),
        part({ name: 'Kostenschaetzung.xlsm', contentType: 'application/vnd.ms-excel.sheet.macroEnabled.12', offered: false, riskFlags: ['type_not_accepted'] }),
        statik(),
      ],
    }),
    text: text(),
  },
  'name-stop': {
    view: mail({
      key: 'name-stop',
      parts: [messagePart({ id: fixtureId('message:ns') }), part({ name: 'Honorarnote_Statik_10-2026.pdf', riskFlags: ['name_stop'], nameStopTerms: ['Honorar'], suggestion: suggestion('Verträge', 'Vertrag', 'Rechnungen des Statikers.') })],
    }),
    text: text(),
  },
  macro: {
    view: mail({
      key: 'macro',
      parts: [
        messagePart({ id: fixtureId('message:macro') }),
        part({ name: 'Massenermittlung.docm', contentType: 'application/vnd.ms-word.document.macroEnabled.12', riskFlags: ['macro'], suggestion: suggestion('Tragwerk', 'Sonstiges', 'Massenermittlung zur Statik.') }),
        part({ name: 'Lageplan.pdf', contentType: 'application/pdf', riskFlags: ['type_mismatch'], suggestion: suggestion('Behörde', 'Bebauungsplan', 'Lageplan zur Einreichung.') }),
      ],
    }),
    text: text(),
  },
  // Three days left: „Wartet nur noch bis …“ comes forward from „Details“ into the header.
  'expires-soon': {
    view: mail({ key: 'expires-soon', expiresAt: daysAhead(3), parts: [messagePart({ id: fixtureId('message:es') }), permitDecision()] }),
    text: text(),
  },
  'scan-pending': {
    view: mail({ key: 'scan-pending', parts: [messagePart({ id: fixtureId('message:sp') }), statik({ scan: 'pending', scannedAt: null }), permitDecision({ scan: 'failed' })] }),
    text: text(),
  },
  infected: {
    view: mail({ key: 'infected', parts: [messagePart({ id: fixtureId('message:inf') }), part({ name: 'Rechnung_Oktober.pdf.exe', contentType: 'application/x-msdownload', scan: 'infected' }), permitDecision()] }),
    text: text(),
  },
  'original-infected': {
    view: mail({ key: 'original-infected', rawScan: 'infected', parts: [messagePart({ id: fixtureId('message:oi') }), part({ name: 'Anhang.pdf', scan: 'infected' })] }),
    text: text(),
  },
  'content-finding': {
    view: mail({
      key: 'content-finding',
      subject: 'AW: Honorarvereinbarung – Kontodaten',
      parts: [messagePart({ id: fixtureId('message:cf'), contentFindings: ['iban', 'term'] })],
    }),
    text: text({ ownText: 'Liebe Frau Huber,\n\nbitte überweisen Sie auf AT•• •••• •••• •••• ••••.\n\nlg Petra Weber', masked: true, quoted: [] }),
  },
  'thread-append': { view: mail({ key: 'thread-append', parts: [messagePart({ id: fixtureId('message:ta') })] }), text: text() },
  'unverified-thread': {
    view: mail({
      key: 'unverified-thread',
      sender: { name: 'Ing. Karl Bauer', address: 'k.bauer@bauer-bau.at', domain: 'bauer-bau.at', signerDomain: 'bauer-bau.at', trust: 'external_verified', reason: 'dkim_pass', flags: [] },
      parts: [messagePart({ id: fixtureId('message:ut') }), statik({ riskFlags: ['unverified_thread'] })],
      threadCandidates: [
        thread({ preselected: false, blocks: ['header_not_signed'] }),
        thread({ threadId: fixtureId('thread:tg'), documentId: fixtureId('doc:tg'), name: 'Tiefgarage Lüftung', nextVersion: 2, strength: 'subject', preselected: false, blocks: ['weak_match'] }),
      ],
      hiddenThreadCandidates: 1,
    }),
    text: text(),
  },
  'new-thread': {
    view: mail({ key: 'new-thread', subject: 'Baustellenbegehung 28.10.', parts: [messagePart({ id: fixtureId('message:nt') })], threadCandidates: [] }),
    text: text({ ownText: 'Hallo zusammen,\n\nTreffpunkt am 28.10. um 8:00 am Bauplatz.\n\nlg', quoted: [] }),
  },
  'full-thread': {
    view: mail({ key: 'full-thread', parts: [messagePart({ id: fixtureId('message:ft') })], threadCandidates: [thread({ full: true, preselected: false, nextVersion: 201 })] }),
    text: text(),
  },
  revision: {
    view: mail({ key: 'revision', subject: 'AW: Stellplatznachweis – Statik S-101 Index C', parts: [messagePart({ id: fixtureId('message:rev') }), statik()] }),
    text: text(),
  },
  // The MA 37 writes from its own signed domain into the project's Verlauf with the authority: complete, so „Bereit“.
  'authority-statement': {
    view: mail({
      key: 'authority-statement',
      subject: 'Stellungnahme Brandschutz – Bauplatz 12',
      sender: { name: 'Mag. Karin Huber', address: 'k.huber@ma37.wien.gv.at', domain: 'ma37.wien.gv.at', signerDomain: 'wien.gv.at', trust: 'external_verified', reason: 'dkim_pass', flags: [] },
      receivedAt: minutesAgo(45),
      parts: [
        messagePart({ id: fixtureId('message:authority') }),
        part({
          name: 'Stellungnahme_MA37_Brandschutz.pdf',
          sizeBytes: 864_000,
          suggestion: suggestion('Behörde', 'Gutachten', 'Stellungnahmen der MA 37 liegen in Behörde.'),
        }),
      ],
      threadCandidates: [
        thread({ threadId: fixtureId('thread:ma37'), documentId: fixtureId('doc:ma37'), name: 'Verfahren MA 37', folderPath: 'Behörde', nextVersion: 3 }),
      ],
    }),
    text: text({
      ownText: 'Sehr geehrte Frau Huber,\n\nanbei die Stellungnahme zum Brandschutzkonzept. Die Fluchtwege der Tiefgarage sind so genehmigungsfähig.\n\nMit freundlichen Grüßen\nKarin Huber\nMA 37 – Baupolizei',
      quoted: [],
    }),
  },
  duplicate: {
    view: mail({
      key: 'duplicate',
      parts: [
        messagePart({ id: fixtureId('message:dup') }),
        part({ name: 'S-101_B.pdf', duplicateOf: { documentId: fixtureId('doc:s101'), name: 'S-101_B.pdf', folderPath: 'Tragwerk' } }),
        part({ name: 'Detail_Attika.pdf', revisionCandidateHidden: true, suggestion: suggestion('Tragwerk', 'Detail', 'Detail zur Statik.') }),
      ],
    }),
    text: text(),
  },
  'already-filed': {
    view: mail({
      key: 'already-filed',
      sender: { name: 'DI Petra Weber', address: 'p.weber@statik-weber.at', domain: 'statik-weber.at', signerDomain: 'statik-weber.at', trust: 'external_verified', reason: 'dkim_pass', flags: ['message_id_reused', 'already_filed'] },
      parts: [messagePart({ id: fixtureId('message:af') }), statik()],
    }),
    text: text(),
  },
  'still-reading': {
    view: mail({ key: 'still-reading', receivedAt: minutesAgo(2), parts: [messagePart({ id: fixtureId('message:sr') }), part({ name: 'Protokoll_JF_12.pdf' })] }),
    text: text(),
  },
  'no-suggestion': {
    view: mail({ key: 'no-suggestion', receivedAt: minutesAgo(180), parts: [messagePart({ id: fixtureId('message:nos') }), part({ name: 'Unterlage_ohne_Namen.pdf' })] }),
    text: text(),
  },
  'decided-by-other': {
    view: mail({
      key: 'decided-by-other',
      status: 'handled',
      parts: [messagePart({ id: fixtureId('message:dbo'), state: 'filed', documentId: fixtureId('doc:stellplatz') }), permitDecision({ state: 'filed', documentId: fixtureId('doc:bescheid-neu') })],
    }),
    text: text(),
    decidedByOther: true,
  },
  'partial-failure': {
    view: mail({
      key: 'partial-failure',
      parts: [
        messagePart({ id: fixtureId('message:pf'), state: 'filed', documentId: fixtureId('doc:stellplatz') }),
        statik({ state: 'filed', documentId: fixtureId('doc:s101') }),
        permitDecision({ lastFailure: 'name_taken' }),
      ],
    }),
    text: text(),
  },
  'quota-full': {
    view: mail({ key: 'quota-full', parts: [messagePart({ id: fixtureId('message:qf') }), statik({ lastFailure: 'quota' }), permitDecision({ lastFailure: 'quota' })] }),
    text: text(),
  },
  'filed-outcome': {
    view: mail({
      key: 'filed-outcome',
      status: 'handled',
      sender: { name: 'Mag. Huber', address: 'k.huber@ma37.wien.gv.at', domain: 'ma37.wien.gv.at', signerDomain: 'wien.gv.at', trust: 'external_verified', reason: 'dkim_pass', flags: [] },
      originalHeld: false,
      parts: [
        messagePart({
          id: fixtureId('message:fo'),
          state: 'filed',
          documentId: fixtureId('doc:stellplatz'),
          filedAs: { name: 'Stellplatznachweis', folderPath: 'Korrespondenz', version: 7 },
        }),
        permitDecision({
          state: 'filed',
          documentId: fixtureId('doc:bescheid-neu'),
          filedAs: { name: 'Bescheid_MA37_2026-10-14.pdf', folderPath: 'Behörde/Bescheide', version: 1 },
        }),
        part({ name: 'Beilage_alt.pdf', state: 'dismissed', restorableUntil: daysAhead(7) }),
      ],
    }),
    text: text(),
  },
  'follow-offer': {
    view: mail({
      key: 'follow-offer',
      status: 'handled',
      originalHeld: false,
      parts: [messagePart({ id: fixtureId('message:fof'), state: 'filed', documentId: fixtureId('doc:stellplatz') })],
    }),
    text: text(),
  },
  followed: {
    view: mail({
      key: 'followed',
      followedBy: 'user_01JFOLLOWER0000000000000000',
      parts: [messagePart({ id: fixtureId('message:fol'), state: 'filed', documentId: fixtureId('doc:stellplatz') }), statik()],
    }),
    text: text(),
  },
  closed: { view: mail({ key: 'closed', projectClosed: true, parts: [messagePart({ id: fixtureId('message:cl') }), permitDecision()] }), text: text() },
  expired: {
    view: mail({ key: 'expired', status: 'handled', parts: [messagePart({ id: fixtureId('message:exp'), state: 'expired', restorableUntil: daysAhead(5) }), permitDecision({ state: 'expired', restorableUntil: daysAhead(5) })] }),
    text: text(),
  },
  dismissed: {
    view: mail({ key: 'dismissed', status: 'handled', parts: [messagePart({ id: fixtureId('message:dis'), state: 'dismissed', restorableUntil: daysAhead(6) }), permitDecision({ state: 'dismissed', restorableUntil: daysAhead(6) })] }),
    text: text(),
  },
  'unreadable-text': {
    view: mail({ key: 'unreadable', parts: [messagePart({ id: fixtureId('message:unr'), riskFlags: ['unreadable'] }), permitDecision()] }),
    text: text({ ownText: '', quoted: [], unreadable: true }),
  },
  loading: { view: memberVerified, text: text(), load: 'loading' },
  error: { view: memberVerified, text: text(), load: 'error' },
  'worst-case': {
    view: mail({
      key: 'worst-case',
      subject: 'AW: AW: WG: [EXTERN] RE: Fwd: Stellplatznachweis Tiefgarage Ebene -2 – Nachreichung der überarbeiteten Brandabschnitte, Fluchtwege und Lüftungsquerschnitte nach der Bauverhandlung vom 14.10.2026 (Index F)',
      sender: {
        name: 'Aleksandra Wiśniewska-Kowalczyk, MSc. BSc. (Projektleitung Tragwerksplanung Ost)',
        address: 'aleksandra.wisniewska-kowalczyk@northwind-industries-holdings-ingenieurbuero.example.com',
        domain: 'northwind-industries-holdings-ingenieurbuero.example.com',
        signerDomain: 'northwind-industries-holdings-ingenieurbuero.example.com',
        trust: 'external_verified',
        reason: 'dkim_pass',
        flags: ['date_out_of_range'],
      },
      participants: Array.from({ length: 14 }, (_, index) => ({
        role: index === 0 ? ('from' as const) : index < 6 ? ('to' as const) : ('cc' as const),
        name: index % 3 === 0 ? null : `Bartholomew Fitzgerald-${index}`,
        address: `bartholomew.fitzgerald.${index}@northwind-industries-holdings.example.com`,
      })),
      parts: [
        messagePart({ id: fixtureId('message:wc'), contentFindings: ['iban', 'at_svnr', 'credit_card', 'term'] }),
        part({ name: longName, sizeBytes: 98_765_432, suggestion: suggestion('Einreichung/Behörde/Bescheide und Stellungnahmen/Tiefgarage/Ebene -2/Brandschutz', 'correspondence', 'Ein sehr langer Grund, warum the agent genau diesen tief verschachtelten Ordner vorschlägt, der in drei Zeilen kaum Platz findet und trotzdem gelesen werden will.', { newFolder: true }) }),
        part({ name: 'a.pdf', sizeBytes: 12, revisionCandidate: { documentId: fixtureId('doc:a'), name: longName, folderPath: 'Tragwerk', nextVersion: 128 }, riskFlags: ['unverified_thread', 'name_stop', 'macro'], nameStopTerms: ['Honorar', 'Rechnung', 'Gehalt', 'Kontoauszug'] }),
        part({ name: '工程图纸_第二版_最终.pdf', sizeBytes: 3_000_000, lastFailure: 'digest_mismatch' }),
        ...Array.from({ length: 9 }, (_, index) => part({ name: `Detail_${index + 1}_${'Fassadenschnitt'.repeat(2)}.pdf` })),
      ],
      threadCandidates: [
        thread({ name: 'Stellplatznachweis Tiefgarage Ebene -2 – Korrespondenz mit MA 37, MA 46 und Bezirksvertretung 22 (2025–2026)', nextVersion: 199 }),
        thread({ threadId: fixtureId('thread:w2'), documentId: fixtureId('doc:w2'), name: 'X', nextVersion: 1, strength: 'subject', preselected: false, blocks: ['weak_match', 'date_out_of_range'] }),
      ],
      hiddenThreadCandidates: 12,
      notStaged: Array.from({ length: 4 }, (_, index) => ({ filename: `${'Archiv_Einreichunterlagen_'.repeat(3)}${index}.zip`, reason: 'archive' as const })),
    }),
    text: text({
      ownText: `${'Diesesisteinsehrlangeswortohneumbruchdaskeinbrowsergernumbricht'.repeat(3)}\n\n${'Sehr geehrte Damen und Herren, '.repeat(40)}\n\nhttps://northwind-industries-holdings.example.com/${'sehr/lange/pfade/'.repeat(12)}datei.pdf\n\n${Array.from({ length: 30 }, (_, index) => `Zeile ${index + 1}`).join('\n')}`,
      ownTextTruncated: true,
      masked: true,
      quoted: Array.from({ length: 6 }, (_, index) => ({ header: `Am ${index + 1}.10.2026 schrieb jemand mit einem sehr langen Namen <jemand@example.com>:`, text: 'Zitat '.repeat(80) })),
    }),
  },
}
