import type { Translator } from '@/i18n'
import type { ActionMount, StoredAction } from '@/lib/conversations/message-provenance'
import { bindAbbreviations } from './document-names'

export type WorkTone = 'ok' | 'running' | 'empty' | 'error' | 'interrupted' | 'incomplete'

export interface WorkParts {
  verb: string
  object: string
  result: string
  tone: WorkTone
  note?: string
}

export interface WorkFold {
  count: number
  counts: StoredAction['counts']
}

const SHELF_KEYS: Record<string, string> = {
  project: 'project',
  office: 'office',
  office_shelf: 'office',
  base: 'base',
  web: 'web',
  session: 'session',
}

export const MAX_READING_RESULT_CHARS = 48

const SEARCHING = new Set<StoredAction['verb']>(['search', 'lookup', 'law', 'web'])

export const breadcrumb = (path: string): string =>
  bindAbbreviations(
    path
      .split(/[\\/]+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .join(' › ')
  )

const ANY_QUOTE = /["„“”«»]/
const WRAPPED = /^["„“«](.*)["“”»]$/
const INNER_PAIR = /["„“«]([^"„“”«»]*)["“”»]/g

export function quoteQuery(t: Translator, query: string): string {
  const trimmed = query.trim()
  const wrapped = WRAPPED.exec(trimmed)
  const bare = wrapped && !ANY_QUOTE.test(wrapped[1]) ? wrapped[1].trim() : trimmed
  return bare.replace(INNER_PAIR, (_, inner: string) =>
    t('thinking.work.innerQuote', { text: inner })
  )
}

const REGION_KEYS: Record<string, string> = {
  'oben links': 'topLeft',
  'oben rechts': 'topRight',
  'oben in der Mitte': 'topCenter',
  'unten links': 'bottomLeft',
  'unten rechts': 'bottomRight',
  'unten in der Mitte': 'bottomCenter',
  'in der Mitte links': 'middleLeft',
  'in der Mitte rechts': 'middleRight',
  'in der Seitenmitte': 'pageCenter',
}

export const regionWords = (t: Translator, where: string): string => {
  const key = REGION_KEYS[where.trim()]
  return key ? t(`thinking.look.region.${key}`) : where
}

const isClause = (pages: string): boolean => /^\s*pkt/i.test(pages)

export const firstPage = (pages: string | undefined): number | null => {
  if (!pages || isClause(pages)) return null
  const match = /\d+/.exec(pages)
  const page = match ? Number(match[0]) : 0
  return page >= 1 ? page : null
}

export const pageRange = (pages: string): string => pages.replace(/(\d)\s*-\s*(\d)/g, '$1–$2')

const shelfPhrase = (t: Translator, action: StoredAction): string => {
  const key = action.shelf ? SHELF_KEYS[action.shelf.toLowerCase()] : undefined
  return key ? t(`thinking.work.shelf.${key}`) : ''
}

export interface ActionPlace {
  mount: ActionMount
  folder: string
}

export const actionPlace = (action: StoredAction): ActionPlace | null =>
  action.mount
    ? { mount: action.mount, folder: (action.target ?? '').replace(/^\/+|\/+$/g, '') }
    : null

const bareFolder = (place: ActionPlace): boolean =>
  place.mount === 'project' || place.mount === 'estate'

export const placeLabel = (t: Translator, place: ActionPlace): string => {
  const crumbs = breadcrumb(place.folder)
  if (!place.folder) return t(`thinking.work.place.${place.mount}`)
  return bareFolder(place)
    ? crumbs
    : t('thinking.work.place.folderIn', {
        place: t(`thinking.work.place.crumb.${place.mount}`),
        folder: crumbs,
      })
}

const placedFolder = (t: Translator, place: ActionPlace, form: 'object' | 'in'): string =>
  t('thinking.work.place.folderIn', {
    place: `${t(`thinking.work.place.article.${place.mount}.${form}`)} ${t(`thinking.work.place.crumb.${place.mount}`)}`,
    folder: breadcrumb(place.folder),
  })

export const placeName = (t: Translator, place: ActionPlace): string => {
  if (!place.folder) return t(`thinking.work.place.${place.mount}`)
  return bareFolder(place) ? breadcrumb(place.folder) : placedFolder(t, place, 'object')
}

export const placeIn = (t: Translator, place: ActionPlace): string => {
  if (!place.folder) return t(`thinking.work.placeIn.${place.mount}`)
  return bareFolder(place)
    ? t('thinking.work.placeIn.folder', { folder: breadcrumb(place.folder) })
    : placedFolder(t, place, 'in')
}

const GLOB_EXTENSION = /^(?:\*\*\/)?\*\.([A-Za-z0-9]{1,5})$/
const GLOB_WORD = /^(?:\*\*\/)?\*([^*?[\]{}/\\]+)\*(?:\.([A-Za-z0-9]{1,5}))?$/

export function namePattern(t: Translator, pattern: string): string {
  const trimmed = pattern.trim()
  const typed = GLOB_EXTENSION.exec(trimmed)
  if (typed) return t('thinking.work.object.namesWhat.ext', { ext: typed[1].toUpperCase() })
  const named = GLOB_WORD.exec(trimmed)
  const word = named?.[1].trim()
  if (named && word) {
    return named[2]
      ? t('thinking.work.object.namesWhat.extWord', { ext: named[2].toUpperCase(), word })
      : t('thinking.work.object.namesWhat.word', { word })
  }
  return t('thinking.work.object.namesWhat.pattern', { query: quoteQuery(t, trimmed) })
}

const REGEX_WORDS = /^[\p{L}\p{N} -]+(?:\|[\p{L}\p{N} -]+)*$/u

export const regexWords = (pattern: string): string[] | null =>
  REGEX_WORDS.test(pattern.trim())
    ? pattern
        .split('|')
        .map((word) => word.trim())
        .filter(Boolean)
    : null

const wordList = (t: Translator, words: readonly string[]): string => {
  const quoted = words.map((word) => t('thinking.work.object.query', { query: word }))
  const last = quoted.pop() ?? ''
  return quoted.length ? `${quoted.join(', ')} ${t('thinking.work.object.or')} ${last}` : last
}

const FOLDED_LETTERS = /[äöüß]|ae|oe|ue|ss/i

const grepObject = (t: Translator, action: StoredAction, place: ActionPlace): string => {
  const words = action.mode === 'regex' && action.query ? regexWords(action.query) : null
  const where = placeName(t, place)
  if (words) {
    const literal = !words.some((word) => FOLDED_LETTERS.test(word))
    return t(literal ? 'thinking.work.object.grepAny' : 'thinking.work.object.grepWords', {
      place: where,
      words: wordList(t, words),
    })
  }
  const query = action.query ? quoteQuery(t, action.query) : ''
  return t(
    action.mode === 'regex' ? 'thinking.work.object.grepRegex' : 'thinking.work.object.grepExact',
    { place: where, query }
  )
}

export type WorkSentenceKind = StoredAction['verb'] | 'grep' | 'glob'

export const sentenceKind = (action: StoredAction): WorkSentenceKind => {
  if (!action.mount) return action.verb
  if (action.verb === 'search' && action.mode !== 'meaning') return 'grep'
  if (action.verb === 'list' && action.query) return 'glob'
  return action.verb
}

const placeVerbAndObject = (
  t: Translator,
  action: StoredAction
): { verb: string; object: string } | null => {
  const place = actionPlace(action)
  if (!place) return null
  switch (sentenceKind(action)) {
    case 'grep':
      return { verb: t('thinking.work.verb.grep'), object: grepObject(t, action, place) }
    case 'glob':
      return {
        verb: t('thinking.work.verb.glob'),
        object: t('thinking.work.object.names', {
          what: namePattern(t, action.query ?? ''),
          place: placeIn(t, place),
        }),
      }
    case 'list':
      return { verb: t('thinking.work.verb.list'), object: placeName(t, place) }
    default:
      return null
  }
}

const searchVerb = (t: Translator, action: StoredAction): string => {
  const mode = action.mode === 'exact' ? 'Exact' : action.mode === 'regex' ? 'Regex' : ''
  return t(`thinking.work.verb.search${mode}${action.target ? 'In' : ''}`)
}

const searchObject = (t: Translator, action: StoredAction): string => {
  const { target } = action
  const query = action.query ? quoteQuery(t, action.query) : ''
  if (target && query)
    return t('thinking.work.object.queryIn', { target: breadcrumb(target), query })
  if (target) return breadcrumb(target)
  const shelf = shelfPhrase(t, action)
  if (!query) return shelf
  return shelf
    ? t('thinking.work.object.queryShelf', { query, shelf })
    : t('thinking.work.object.query', { query })
}

const quotedQuery = (t: Translator, query: string | undefined): string =>
  query ? t('thinking.work.object.query', { query: quoteQuery(t, query) }) : ''

const placeObject = (
  t: Translator,
  target: string,
  pages: string | undefined,
  where?: string
): string => {
  const name = bindAbbreviations(target)
  if (!pages) return name
  if (isClause(pages))
    return t('thinking.work.object.clause', { target: name, pages: clauseLabel(pages) })
  const range = pageRange(pages)
  return where
    ? t('thinking.work.object.where', { target: name, pages: range, where: regionWords(t, where) })
    : t('thinking.work.object.pages', { target: name, pages: range })
}

const clauseLabel = (pages: string): string => pages.trim().replace(/^(pkt\.?)\s*/i, '$1\u00A0')

const FOLD_KEEPS_VERB = new Set<WorkSentenceKind>(['read', 'look', 'list'])

const FOLDED_KEYS: Record<WorkSentenceKind, string> = {
  grep: 'searches',
  glob: 'nameSearches',
  read: 'documents',
  look: 'documents',
  list: 'folders',
  search: 'searches',
  law: 'lawSearches',
  web: 'webSearches',
  lookup: 'lookupSearches',
  model: 'modelQueries',
  workspace: 'workspaceCalls',
}

const foldedObject = (t: Translator, action: StoredAction, count: number): string =>
  t(`thinking.work.many.${FOLDED_KEYS[sentenceKind(action)]}`, { count })

const verbAndObject = (
  t: Translator,
  action: StoredAction,
  where: string | undefined
): { verb: string; object: string } => {
  const placed = placeVerbAndObject(t, action)
  if (placed) return placed
  const { verb, query, target, pages } = action
  switch (verb) {
    case 'search':
      return { verb: searchVerb(t, action), object: searchObject(t, action) }
    case 'list':
      return { verb: t('thinking.work.verb.list'), object: target ? breadcrumb(target) : '' }
    case 'read':
      return {
        verb: t('thinking.work.verb.read'),
        object: target ? placeObject(t, target, pages) : '',
      }
    case 'look':
      return {
        verb: t('thinking.work.verb.look'),
        object: target ? placeObject(t, target, pages, where) : '',
      }
    case 'law':
      return {
        verb: t('thinking.work.verb.law'),
        object: target ? bindAbbreviations(target) : quotedQuery(t, query),
      }
    case 'lookup':
    case 'web':
    case 'model':
      return { verb: t(`thinking.work.verb.${verb}`), object: quotedQuery(t, query) }
    case 'workspace':
      return { verb: t('thinking.work.verb.workspace'), object: target ?? '' }
  }
}

const foundOf = (t: Translator, action: StoredAction, counts: StoredAction['counts']): string => {
  const { hits, documents, files, folders } = counts ?? {}
  if (action.verb === 'list') {
    if (!action.query && files === 0 && !folders) return t('thinking.work.found.emptyFolder')
    if (action.mount === 'estate' && !action.query && files !== undefined && folders !== undefined)
      return t('thinking.work.found.places', { files, folders })
    if (files !== undefined && folders !== undefined && files > 0 && folders > 0)
      return t('thinking.work.found.listing', { files, folders })
    if (folders !== undefined && folders > 0 && !files)
      return t('thinking.work.found.folders', { count: folders })
    if (files !== undefined) return t('thinking.work.found.files', { count: files })
    if (folders !== undefined) return t('thinking.work.found.folders', { count: folders })
    return ''
  }
  if (action.verb === 'read' || action.verb === 'look') {
    return hits !== undefined ? t('thinking.work.found.passages', { count: hits }) : ''
  }
  if (hits !== undefined) {
    const key = action.mount ? 'hitsFiles' : 'hitsDocuments'
    return documents !== undefined
      ? t(`thinking.work.found.${key}`, { hits, documents })
      : t('thinking.work.found.hits', { count: hits })
  }
  return documents !== undefined ? t('thinking.work.found.documents', { count: documents }) : ''
}

export function workParts(
  t: Translator,
  action: StoredAction,
  options: { running?: boolean; fold?: WorkFold; where?: string; reading?: string } = {}
): WorkParts {
  const { running = false, fold, where, reading } = options
  const folded = fold && fold.count > 1 ? fold : undefined
  const named = verbAndObject(t, action, where)
  const object = folded ? foldedObject(t, action, folded.count) : named.object
  const verb = folded && !FOLD_KEEPS_VERB.has(sentenceKind(action)) ? '' : named.verb
  const parts = object
    ? { verb, object }
    : { verb: '', object: t(`thinking.work.fallback.${action.verb}`) }
  if (running) return { ...parts, result: t('thinking.work.running'), tone: 'running' }
  if (action.status === 'running')
    return { ...parts, result: t('thinking.work.interrupted'), tone: 'interrupted' }
  if (action.status === 'error')
    return {
      ...parts,
      result: t('thinking.work.failed'),
      tone: 'error',
      note: t('thinking.work.failedNote'),
    }
  if (action.status === 'empty') {
    const result = emptyResult(t, action)
    return action.incomplete
      ? { ...parts, ...incomplete(t, result, false) }
      : { ...parts, result, tone: 'empty' }
  }
  const found = foundOf(t, action, folded ? folded.counts : action.counts)
  if (action.incomplete) return { ...parts, ...incomplete(t, found, true) }
  const short = reading && reading.length <= MAX_READING_RESULT_CHARS ? reading : ''
  return { ...parts, result: found || (action.verb === 'look' ? short : ''), tone: 'ok' }
}

const emptyResult = (t: Translator, action: StoredAction): string => {
  if (action.missing) return t('thinking.work.notFound')
  if (sentenceKind(action) === 'glob') return t('thinking.work.noFile')
  if (!SEARCHING.has(action.verb)) return t('thinking.work.nothingFound')
  const searched = action.counts?.searched
  if (!searched) return t('thinking.work.noHit')
  return t(action.mount ? 'thinking.work.noHitInFiles' : 'thinking.work.noHitIn', { count: searched })
}

const incomplete = (
  t: Translator,
  found: string,
  hit: boolean
): Pick<WorkParts, 'result' | 'tone' | 'note'> => ({
  result: found || t('thinking.work.incomplete'),
  tone: 'incomplete',
  note: t(hit ? 'thinking.work.incompleteNote.hits' : 'thinking.work.incompleteNote.noHit'),
})

export function settledHead(t: Translator, action: StoredAction, name?: string): string {
  const parts = workParts(t, action)
  const object = name || (parts.verb ? parts.object : '')
  return object
    ? t(`thinking.work.done.${sentenceKind(action)}`, { name: object })
    : t(`thinking.work.doneFallback.${action.verb}`)
}

export const workPartsText = (parts: WorkParts): string => {
  const head = [parts.verb, parts.object].filter(Boolean).join(' ')
  const said = parts.result ? `${head}: ${parts.result}` : head
  return parts.tone === 'incomplete' && parts.note ? `${said} (${parts.note})` : said
}
