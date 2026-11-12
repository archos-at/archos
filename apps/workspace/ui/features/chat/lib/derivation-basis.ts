/**
 * What the Herleitung says about a turn as a whole, read off its stored steps
 * and its citation model: the header's counts and its one warning, the last
 * card („Grundlagen · Entwurf“), and the two shapes that need no graph (a turn
 * without research, a turn of one call).
 *
 * Pure, and every word a dictionary key. Two rules hold here:
 *  - Piloti never says „nachgewiesen“: the last card lists what the answer
 *    rests on and calls itself a draft (`Entwurf`).
 *  - A gap is stated as the gap: a search that found nothing says where it
 *    looked and for what, never „Keine Informationen gefunden“.
 */

import type { Translator } from '@/i18n'
import type { StoredAction, StoredThinkingStep } from '@/lib/conversations/message-provenance'
import {
  citationNumbers,
  citedLoci,
  isCited,
  oibDocumentKey,
  type CitationLocus,
  type CitedDocument,
} from './citations'
import { documentEdition, documentShortName } from './document-names'
import { retrievalRounds } from './retrieval-rounds'
import {
  allRows,
  isInterrupted,
  prefetchRounds,
  withActionRounds,
  workRounds,
  type WorkRound,
  type WorkRow,
} from './work-list'
import {
  actionPlace,
  breadcrumb,
  namePattern,
  placeIn,
  placeLabel,
  quoteQuery,
  sentenceKind,
  workParts,
} from './work-sentence'

const SHELF_KEYS: Record<string, string> = {
  project: 'project',
  office: 'office',
  office_shelf: 'office',
  base: 'base',
  web: 'web',
  session: 'session',
}

/**
 * A clause a reader can write down: a numbered point („3.2.1“, „A.1“), a
 * paragraph with its Absatz, Ziffer and litera („§ 43 Abs. 2 Z 9“), or a
 * named one followed by its number or letter („Tabelle 3“, „Anhang A“,
 * „Anlage 1“, „Art. 15a“, „Ziffer 3“). Anything else the chunker put in
 * `clause` (a heading trail „Anforderungen … › U-Wert Bauteil (2)“, a heading
 * that only starts like one, „Punktförmige Wärmebrücken“, „Tabellenverzeichnis“,
 * a cover number, a bare year, the Vorbemerkungen „0“) is no address: the card
 * leaves it to the hover. A numbered heading („3.2.1 Allgemeines“) is
 * addressed by its number.
 */
const TOKEN = String.raw`(?:\d+[a-z]?(?:\.\d+[a-z]?)*\.?|[a-z](?:\.\d+)*)`
const NAMED = String.raw`(?:(?:Art|Tab|Abb|Anh|Abs|Pkt|lit|Z)\.\s*|(?:Artikel|Tabelle|Tab|Abbildung|Anhang|Anlage|Absatz|Punkt|Ziffer|Z|Kapitel|Abschnitt)\s+)${TOKEN}`
const PARAGRAPH = String.raw`§{1,2}\s*\d+[a-z]?(?:\s+(?:Abs\.|Absatz)\s*\d+[a-z]?)?(?:\s+(?:Z\.?|Ziffer)\s*\d+)?(?:\s+lit\.\s*[a-z])?`
const POINT = String.raw`(?:[a-z]\.)?\d+(?:\.\d+)*[a-z]?\.?`
const ADDRESS = new RegExp(`^(?:${PARAGRAPH}|${NAMED}|${POINT})$`, 'i')
const NUMBERED_HEADING = /^(\d+(?:\.\d+)+)\.?\s+\p{L}/u
const NO_ADDRESS = /^(?:\d{4}|0|(?:Pkt\.|Punkt)\s*0)$/i

/** The address a clause names, as written, or undefined when it names none (see `ADDRESS`). */
export const addressOf = (clause: string | undefined): string | undefined => {
  const text = clause?.trim().replace(/\s+/g, ' ')
  if (!text) return undefined
  const heading = NUMBERED_HEADING.exec(text)
  const candidate = heading ? heading[1]! : text
  if (NO_ADDRESS.test(candidate) || !ADDRESS.test(candidate)) return undefined
  return candidate
}

/** „Pkt. 3.2.1“ for a bare numbered point, every other address as written. */
const addressLabel = (t: Translator, address: string): string =>
  new RegExp(`^${POINT}$`, 'i').test(address) ? t('thinking.node.basis.clause', { clause: address.replace(/\.$/, '') }) : address

/** „7–8, 10“: pages sorted, a run of consecutive pages said as a range. */
export const pageRanges = (pages: readonly number[]): string => {
  const sorted = [...new Set(pages)].sort((a, b) => a - b)
  const runs: string[] = []
  for (let i = 0; i < sorted.length; ) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j += 1
    runs.push(j === i ? String(sorted[i]) : `${sorted[i]}\u2013${sorted[j]}`)
    i = j + 1
  }
  return runs.join(', ')
}

/** The most addresses a card names before it says how many more there are. */
const MAX_ADDRESSES = 2

/**
 * Where in the document the answer stands, short enough to read at a glance:
 * the addresses a reader would write down and the pages to open, „Tabelle 2 ·
 * S. 7–8“. The cited passages, else the passages read. Which page carries which
 * `[N]`, and the heading around it, is `documentLocationDetail`'s, for the hover.
 */
export const documentLocation = (t: Translator, doc: CitedDocument): string | undefined => {
  const loci = isCited(doc) ? citedLoci(doc) : doc.loci
  const addresses = [...new Set(loci.flatMap((locus) => {
    const address = addressOf(locus.clause)
    return address ? [addressLabel(t, address)] : []
  }))]
  const pages = loci.flatMap((locus) => (typeof locus.page === 'number' ? [locus.page] : []))
  const named = addresses.slice(0, MAX_ADDRESSES)
  if (addresses.length > MAX_ADDRESSES) named.push(t('thinking.node.basis.more', { count: addresses.length - MAX_ADDRESSES }))
  const distinct = new Set(pages)
  const pageLabel =
    distinct.size === 0 ? '' : distinct.size === 1 ? t('thinking.node.basis.page', { page: pages[0]! }) : t('thinking.node.basis.pages', { pages: pageRanges(pages) })
  const parts = [named.join(', '), pageLabel]
  const label = parts.filter(Boolean).join(' · ')
  return label || undefined
}

/**
 * Every passage the card stands for, one per line, for the hover: its `[N]`,
 * its page and the clause as the document gives it, heading trail included
 * („[3] S. 8 · Anforderungen an wärmeübertragende Bauteile › U-Wert Bauteil“).
 */
export const documentLocationDetail = (t: Translator, doc: CitedDocument): string | undefined => {
  const loci = isCited(doc) ? citedLoci(doc) : doc.loci
  const lines = loci.flatMap((locus) => {
    const parts = [
      typeof locus.number === 'number' ? `[${locus.number}]` : '',
      typeof locus.page === 'number' ? t('thinking.node.basis.page', { page: locus.page }) : '',
      locus.clause?.trim() && locus.clause.trim() !== '0' ? locus.clause.trim() : '',
    ].filter(Boolean)
    return parts.length > 0 ? [parts.join(' · ')] : []
  })
  const unique = [...new Set(lines)]
  return unique.length > 0 ? unique.join('\n') : undefined
}

/**
 * One line of „Grundlagen“: the `[N]` the answer cites the document by, and
 * „OIB-Richtlinie 2, Ausgabe Mai 2023, Pkt. 3.1.1“. The numbers stay numbers so
 * the card draws the answer's own marker for them rather than their text.
 */
export interface BasisLine {
  numbers: number[]
  text: string
}

/**
 * A document as its card names it: the short name and, when the title states
 * one, its edition („OIB-Richtlinie 2, Ausgabe Mai 2023“). The one naming the
 * card, the basis and the open points share, so a document never has two.
 */
export const cardName = (doc: CitedDocument): string => {
  const name = doc.fileName ?? doc.title
  return [documentShortName(name, doc.title), documentEdition(name, doc.title)]
    .filter(Boolean)
    .join(', ')
}

/**
 * The act that declares a cited edition binding where the project is, as its
 * records name it: the provision („StBTV 2020“), with the act's designation in
 * front when the provision does not already say it („WBTV, LGBl. 26/2026“).
 * Undefined unless the records state a binding role through an act: law in its
 * own territory has no route, and a text read for reference has no role.
 */
export const adoptingAct = (doc: Pick<CitedDocument, 'line'>): string | undefined => {
  const line = doc.line
  if (line?.role !== 'binding' || !line.route) return undefined
  const designation = line.route.designation?.trim()
  const provision = line.route.provision?.trim()
  if (!provision) return designation || undefined
  if (!designation || provision.includes(designation)) return provision
  return `${designation}, ${provision}`
}


/** The labels a role carries when the platform's check of its edition is due or was never made (ADR-0173). */
const CHECK_DUE = new Set(['check_overdue', 'unchecked_since'])

/** `YYYY-MM-DD` as the dictionary writes a day; undefined for anything else. */
const dayOf = (t: Translator, value: string | null | undefined): string | undefined => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '')
  return match ? t('thinking.node.basis.date', { year: match[1], month: match[2], day: match[3] }) : undefined
}

/**
 * What the records say about how far the route has been checked: never against its source, last on a day
 * that is now past due, or read from an official source nobody curated. Nothing when the check is current.
 */
const checkState = (t: Translator, doc: CitedDocument): string[] => {
  const B = 'thinking.node.basis.'
  const labels = doc.line?.role_labels ?? []
  const states: string[] = []
  if (labels.includes('uncurated_source')) states.push(t(`${B}uncurated`))
  if (labels.some((label) => CHECK_DUE.has(label))) {
    const last = dayOf(t, doc.line?.last_checked_at)
    states.push(last ? t(`${B}checkedOn`, { date: last }) : t(`${B}unchecked`))
  }
  return states
}

/**
 * One line of „Grundlagen“: the edition, the act it is binding through and since when, then the passage.
 * This is the chain a reader checks the answer by: which act makes this edition apply at the site. It is
 * the platform's record of that chain, so when that record is not checked, or its check is past due, the
 * line says which, rather than stating the route as settled law.
 */
const basisLine = (t: Translator, doc: CitedDocument): BasisLine => {
  const act = adoptingAct(doc)
  const since = act ? dayOf(t, doc.line?.role_since) : undefined
  const B = 'thinking.node.basis.'
  const record = act && [since ? t(`${B}bindingSince`, { act, since }) : t(`${B}binding`, { act }), ...checkState(t, doc)]
  const name = record ? t(`${B}withRecord`, { name: cardName(doc), record: record.join(', ') }) : cardName(doc)
  const text = [name, documentLocation(t, doc)].filter(Boolean).join(', ')
  return { numbers: citationNumbers(doc), text }
}

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * Two editions that may be the same one: either is unstated, or every number
 * the call's states („2023“) is in the card's („Mai 2023“). A Richtlinie of
 * another year is another document, and is never renamed to the card's.
 */
const editionsAgree = (stated: string | undefined, card: string | undefined): boolean => {
  if (!stated || !card) return true
  const numbers: readonly string[] = card.match(/\d+/g) ?? []
  return (stated.match(/\d+/g) ?? []).every((n) => numbers.includes(n))
}

/**
 * The card for the document a call named, when the turn has one: by its file
 * name or title, else by the short name both come to, else, for an OIB
 * Richtlinie, by its identity („OIB-RL 2, Ausgabe 2023“ is the card
 * „OIB-Richtlinie 2“; `oibDocumentKey` ignores the edition as the citation
 * model does). The call's `target` is the path the backend wrote
 * („Projekt/Brandschutzkonzept.pdf“), so the match is on its last part.
 */
export const cardForTarget = (
  target: string,
  cards: readonly CitedDocument[]
): CitedDocument | undefined => {
  const leaf = target.split(/[\\/›]+/).at(-1)?.trim() ?? ''
  if (!leaf) return undefined
  const short = documentShortName(leaf)
  const oib = oibDocumentKey(leaf)
  return (
    cards.find((doc) => [doc.fileName, doc.title].some((name) => name && sameName(name, leaf))) ??
    cards.find((doc) => sameName(documentShortName(doc.fileName ?? doc.title, doc.title), short)) ??
    (oib
      ? cards.find(
          (doc) =>
            (oibDocumentKey(doc.fileName) === oib || oibDocumentKey(doc.title) === oib) &&
            editionsAgree(
              documentEdition(leaf),
              documentEdition(doc.fileName ?? doc.title, doc.title)
            )
        )
      : undefined)
  )
}

export interface BasisLines {
  /** The cited normative sources, with their edition: „Rechtsgrundlage“. */
  law: BasisLine[]
  /** The cited project, office and web sources, with their place: „Belegt durch“. */
  evidence: BasisLine[]
}

/** The cited documents of the turn, by their first `[N]`, split into the law and the rest. */
export function basisLines(t: Translator, cards: readonly CitedDocument[]): BasisLines {
  const cited = cards
    .filter(isCited)
    .sort((a, b) => (citationNumbers(a)[0] ?? Infinity) - (citationNumbers(b)[0] ?? Infinity))
  return {
    law: cited.filter((doc) => doc.kind === 'building_law').map((doc) => basisLine(t, doc)),
    evidence: cited.filter((doc) => doc.kind !== 'building_law').map((doc) => basisLine(t, doc)),
  }
}

/** Verbs whose call is known by the document or folder it opened, not by a query. */
const TARGET_VERBS: ReadonlySet<string> = new Set(['list', 'read', 'look'])

/**
 * A call as the subject of „… fehlgeschlagen ist“: „die Abfrage im RIS nach
 * ‚Brandabschnitt‘“, „das Lesen des Dokuments „Brandschutzkonzept““. A noun,
 * never the row's verb, so the sentence reads as one.
 */
const callNoun = (t: Translator, action: StoredAction): string => {
  const place = actionPlace(action)
  if (place) {
    // A call over the filesystem is named by where it looked: „die wörtliche Suche in allen Ablagen nach ‚…‘“.
    const kind = sentenceKind(action)
    const where = placeIn(t, place)
    // A pattern is no wörtliche Suche: „die Suche in der Büroablage › Vorlagen nach dem Muster ‚EI\s?90‘“.
    if (kind === 'grep' && action.mode === 'regex' && action.query)
      return t('thinking.node.basis.callPlacePattern', {
        place: where,
        query: quoteQuery(t, action.query),
      })
    const call = t(`thinking.node.basis.call.${kind}`)
    return action.query
      ? t('thinking.node.basis.callPlaceQuery', {
          call,
          place: where,
          query: quoteQuery(t, action.query),
        })
      : t('thinking.node.basis.callPlace', { call, place: where })
  }
  const call = t(`thinking.node.basis.call.${action.verb}`)
  if (TARGET_VERBS.has(action.verb) && action.target)
    return t('thinking.node.basis.callTarget', { call, target: breadcrumb(action.target) })
  if (action.query)
    return t('thinking.node.basis.callQuery', { call, query: quoteQuery(t, action.query) })
  return call
}

/**
 * One open point from a call that failed, broke off or found nothing; null for
 * any other row. A document the call named is named as its card names it
 * (`cardName`), so „Offen“ and the fan never call one document two things.
 */
const openPoint = (
  t: Translator,
  row: WorkRow,
  cards: readonly CitedDocument[]
): string | null => {
  const interrupted = isInterrupted(row)
  if (row.running || (!interrupted && row.action.status !== 'error' && row.action.status !== 'empty'))
    return null
  const card = row.action.target ? cardForTarget(row.action.target, cards) : undefined
  const action = card ? { ...row.action, target: cardName(card) } : row.action
  if (action.status === 'error') return t('thinking.node.basis.openFailed', { call: callNoun(t, action) })
  if (interrupted) return t('thinking.node.basis.openInterrupted', { call: callNoun(t, action) })
  // Most of the scope was searched and the rest could not be: not a no, and „Offen“ says which.
  if (action.incomplete)
    return t('thinking.node.basis.openIncomplete', { call: callNoun(t, action) })
  const missing = missingName(t, action)
  if (missing)
    return t(
      action.verb === 'read'
        ? 'thinking.node.basis.openNotFoundDocument'
        : 'thinking.node.basis.openNotFoundFolder',
      { name: missing }
    )
  const place = actionPlace(action)
  const kind = sentenceKind(action)
  if (place && action.query && kind === 'grep')
    return t('thinking.node.basis.openNoHitPlace', { call: callNoun(t, action) })
  if (place && action.query && kind === 'glob')
    return t('thinking.node.basis.openNoFile', {
      place: placeIn(t, place),
      what: namePattern(t, action.query),
    })
  const { query, target } = action
  if (!query) {
    const parts = workParts(t, action)
    return t('thinking.node.basis.openEmpty', {
      what: [parts.verb, parts.object].filter(Boolean).join(' '),
    })
  }
  const quoted = quoteQuery(t, query)
  if (target)
    return t('thinking.node.basis.openNoHitIn', {
      target: card ? target : breadcrumb(target),
      query: quoted,
    })
  const shelfKey = row.action.shelf ? SHELF_KEYS[row.action.shelf.toLowerCase()] : undefined
  return shelfKey
    ? t('thinking.node.basis.openNoHitShelf', {
        shelf: t(`thinking.work.shelf.${shelfKey}`),
        query: quoted,
      })
    : t('thinking.node.basis.openNoHit', { query: quoted })
}

/** The folder or document an empty listing or read did not find, by the name the row gives it; null otherwise. */
const missingName = (t: Translator, action: StoredAction): string | null => {
  if (!action.missing) return null
  if (action.verb === 'read') return action.target || null
  const place = actionPlace(action)
  return place ? placeLabel(t, place) : null
}

/**
 * The open points of the turn: one per failed or empty call, failed first.
 * `cards` is the turn's citation model, for naming a document as its card does.
 */
export function openPoints(
  t: Translator,
  rounds: readonly WorkRound[],
  cards: readonly CitedDocument[] = []
): string[] {
  const rows = rounds.flatMap(allRows)
  const ordered = [
    ...rows.filter((row) => row.action.status === 'error'),
    ...rows.filter((row) => row.action.status === 'empty' || isInterrupted(row)),
  ]
  return [...new Set(ordered.flatMap((row) => openPoint(t, row, cards) ?? []))]
}

export interface DerivationOverview {
  /** The rounds a reader sees as „Schritt N“; the prefetch is none of them. */
  steps: number
  /** Documents the answer cites. */
  cited: number
  /** Calls that failed. */
  failed: number
  /** Calls that found nothing or broke off: an open point each. */
  open: number
  /** Whether the turn looked anything up, or ran any tool: only a turn that did neither is „ohne Recherche“. */
  researched: boolean
  /** The turn's one call, when it made exactly one and it settled with a result: the header is then the Herleitung. */
  single: WorkRow | null
}

/** The turn at a glance, for the header and its edge cases. */
export function derivationOverview(
  steps: readonly StoredThinkingStep[],
  cards: readonly CitedDocument[]
): DerivationOverview {
  const work = workRounds(steps)
  const prefetch = prefetchRounds(steps)
  const rounds = withActionRounds(retrievalRounds(steps), steps).filter(
    (round) => !prefetch.has(round.index)
  )
  const rows = work.flatMap(allRows)
  const settled = rows.filter((row) => !row.running)
  const only = rows.length === 1 && !rows[0].fold ? rows[0] : null
  return {
    steps: rounds.length,
    cited: cards.filter(isCited).length,
    failed: settled.filter((row) => row.action.status === 'error').length,
    open: settled.filter((row) => row.action.status === 'empty' || isInterrupted(row)).length,
    researched:
      cards.length > 0 ||
      rounds.length > 0 ||
      prefetch.size > 0 ||
      steps.some((step) => step.kind === 'look' || step.kind === 'sources' || step.kind === 'tool'),
    single:
      only &&
      !only.running &&
      only.action.status === 'ok' &&
      rounds.length === 1 &&
      cards.length <= 1
        ? only
        : null,
  }
}
