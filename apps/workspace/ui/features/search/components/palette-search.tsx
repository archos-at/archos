'use client'

import type { JSX } from 'react'
import { createContext, useContext } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Bookmark, History, RotateCw, Search, Users } from 'lucide-react'

import { CommandGroup, CommandItem } from '@/components/ui/command'
import { useDelayedFlag } from '@/hooks/use-transient-flag'
import { useTranslations } from '@/i18n'
import { searchCopy } from '@/i18n/namespaces/search'
import { cn } from '@/lib/utils'
import type { SavedSearchView } from '@/lib/search/saved-search-client'
import { SEARCH_KINDS, type SearchHit, type SearchResponse, type SearchScopeQuery } from '@/lib/search/search-wire'
import { PALETTE_HITS_PER_KIND } from '../hooks/use-palette-search'
import { hitHref } from '../lib/search-hrefs'
import {
  PALETTE_HIT_CLASS,
  PALETTE_STALE_CLASS,
  PaletteAside,
  PaletteEmpty,
  PaletteGlyph,
  PaletteGroupHeading,
  PaletteHitsSkeleton,
  PaletteLabel,
  PaletteScopeLine,
  PaletteStatusLine,
} from './palette-atoms'
import { ResultRowFrameProvider, type ResultRowFrameProps } from './search-atoms'
import { HitRow, HitScopeProvider } from './search-result-list'

export const PALETTE_SEARCH_VALUE_PREFIX = 'search:'
export const PALETTE_ALL_RESULTS_VALUE = `${PALETTE_SEARCH_VALUE_PREFIX}all`
export const PALETTE_RETRY_VALUE = `${PALETTE_SEARCH_VALUE_PREFIX}retry`
const hitValue = (href: string): string => `${PALETTE_SEARCH_VALUE_PREFIX}hit:${href}`
export const paletteHitValue = (hit: SearchHit): string => hitValue(hitHref(hit))
export const isPaletteHitValue = (value: string): boolean => value.startsWith(`${PALETTE_SEARCH_VALUE_PREFIX}hit:`)
export const paletteHitHref = (value: string): string => value.slice(`${PALETTE_SEARCH_VALUE_PREFIX}hit:`.length)

type CommandFilter = (value: string, search: string, keywords?: string[]) => number

export function paletteFilter(defaultFilter: CommandFilter): CommandFilter {
  return (value, search, keywords) => (value.startsWith(PALETTE_SEARCH_VALUE_PREFIX) ? 2 : defaultFilter(value, search, keywords))
}

const OpenContext = createContext<(href: string) => void>(() => {})

function PaletteHitFrame({ href, testId, className, children }: ResultRowFrameProps): JSX.Element {
  const open = useContext(OpenContext)
  return (
    <CommandItem
      forceMount
      value={hitValue(href)}
      onSelect={() => open(href)}
      className={`${className} ${PALETTE_HIT_CLASS}`}
      data-testid={testId ? `palette-${testId}` : undefined}
    >
      {children}
    </CommandItem>
  )
}

export interface PaletteSearchResultsProps {
  text: string
  answered: string
  response: SearchResponse | null
  loading: boolean
  failed: boolean
  onOpen: (href: string) => void
  onRetry?: () => void
  onPick?: (hit: SearchHit) => void
  allHref: string | null
  perKind?: number
  scope?: SearchScopeQuery
  itemClassName?: string
}

export const PALETTE_LATE_ANSWER_MS = 300
export const PALETTE_LATE_HOLD_MS = 200

export function PaletteSearchResults({
  text,
  answered,
  response,
  loading,
  failed,
  onOpen,
  onRetry,
  onPick,
  allHref,
  perKind = PALETTE_HITS_PER_KIND,
  scope = {},
  itemClassName,
}: PaletteSearchResultsProps): JSX.Element {
  const t = useTranslations(searchCopy)
  const words = text.trim()
  const stale = answered !== words
  const shown = paletteHits(response, perKind)
  const anyHits = shown.length > 0
  const busy = !failed && (loading || stale)
  const late = useDelayedFlag(busy && anyHits, PALETTE_LATE_ANSWER_MS, PALETTE_LATE_HOLD_MS)
  const tCount = (kind: (typeof SEARCH_KINDS)[number]): string | null => {
    const section = response?.sections[kind]
    const shownHere = Math.min(section?.hits.length ?? 0, perKind)
    if (!section || (section.total <= shownHere && !section.totalIsLowerBound)) return null
    const total = section.totalIsLowerBound ? t('totalAtLeast', { count: section.total }) : String(section.total)
    return t('palette.ofTotal', { shown: shownHere, total })
  }
  const status = failed ? t('error') : busy ? t('loading') : response && !anyHits ? t('palette.noHits') : null
  const firstAnswer = loading && !failed && response === null
  const empty = !busy && (failed || (response !== null && !anyHits))
  const oneProject = scope.scope === 'project' ? null : sharedProject(shown)
  const rowScope: SearchScopeQuery = oneProject ? { scope: 'project', projectId: oneProject.id } : scope
  const select = onPick
    ? (href: string): void => {
        const hit = shown.find((entry) => hitHref(entry) === href)
        if (hit) onPick(hit)
      }
    : onOpen
  return (
    <OpenContext.Provider value={select}>
      {oneProject ? <PaletteScopeLine project={oneProject.name} dimmed={late} /> : null}
      <HitScopeProvider scope={rowScope}>
      <ResultRowFrameProvider value={PaletteHitFrame}>
        {SEARCH_KINDS.map((kind) => {
          const hits = response?.sections[kind]?.hits.slice(0, perKind) ?? []
          if (hits.length === 0) return null
          return (
            <CommandGroup
              key={kind}
              heading={<PaletteGroupHeading count={tCount(kind)}>{t(`kinds.${kind}`)}</PaletteGroupHeading>}
              forceMount
              className={late ? PALETTE_STALE_CLASS : undefined}
              aria-busy={late || undefined}
              data-testid={`palette-group-${kind}`}
            >
              {hits.map((hit) => (
                <HitRow key={`${hit.kind}:${hit.id}`} hit={hit} text={answered} />
              ))}
            </CommandGroup>
          )
        })}
      </ResultRowFrameProvider>
      </HitScopeProvider>
      {firstAnswer ? <PaletteHitsSkeleton /> : null}
      {allHref === null ? (
        status ? (
          <PaletteStatusLine busy={loading && !failed} testId="palette-search-status">
            {status}
          </PaletteStatusLine>
        ) : null
      ) : (
        <>
          {empty ? (
            <PaletteEmpty
              title={failed ? t('error') : t('palette.noHitsFor', { text: words })}
              hint={failed ? (onRetry ? t('palette.retryHint') : undefined) : t('palette.noHitsHint')}
              testId="palette-search-status"
            />
          ) : (
            <span className="sr-only" aria-live="polite" data-testid="palette-search-status">
              {status}
            </span>
          )}
          <CommandGroup forceMount>
            {failed && onRetry ? (
              <CommandItem forceMount value={PALETTE_RETRY_VALUE} onSelect={onRetry} className={itemClassName} data-testid="palette-search-retry">
                <PaletteGlyph icon={RotateCw} />
                <PaletteLabel>{t('palette.retry')}</PaletteLabel>
              </CommandItem>
            ) : null}
            <CommandItem
              forceMount
              value={PALETTE_ALL_RESULTS_VALUE}
              onSelect={() => onOpen(allHref)}
              className={cn(itemClassName, firstAnswer && 'data-[selected=true]:bg-transparent')}
              data-testid="palette-workspace-search"
            >
              <PaletteGlyph icon={Search} />
              {/* Nothing here is no promise of nothing there: the page searches with filters, and further than three of a kind. */}
              <PaletteLabel>{empty ? t('palette.continueInSearch') : t('palette.allResults', { text: words })}</PaletteLabel>
            </CommandItem>
          </CommandGroup>
        </>
      )}
    </OpenContext.Provider>
  )
}

export function sharedProject(hits: readonly SearchHit[]): { id: string; name: string } | null {
  if (hits.length < 2) return null
  let shared: { id: string; name: string } | null = null
  for (const hit of hits) {
    if (hit.kind === 'project' || !hit.projectId || !hit.projectName) return null
    if ('shelf' in hit && hit.shelf !== 'project') return null
    if (shared && shared.id !== hit.projectId) return null
    shared = { id: hit.projectId, name: hit.projectName }
  }
  return shared
}

export function paletteHits(response: SearchResponse | null, perKind: number = PALETTE_HITS_PER_KIND): SearchHit[] {
  return SEARCH_KINDS.flatMap((kind): SearchHit[] => response?.sections[kind]?.hits.slice(0, perKind) ?? [])
}

export interface PaletteSearchStartProps {
  inProject: boolean
  recent: readonly string[]
  saved: readonly SavedSearchView[] | null
  onRecent: (text: string) => void
  onSaved: (item: SavedSearchView) => void
  onOpenSearch: () => void
  itemClassName?: string
}

export function PaletteSearchStart({ inProject, recent, saved, onRecent, onSaved, onOpenSearch, itemClassName }: PaletteSearchStartProps): JSX.Element {
  const t = useTranslations(searchCopy)
  return (
    <>
      <CommandGroup forceMount>
        <CommandItem forceMount value={PALETTE_ALL_RESULTS_VALUE} onSelect={onOpenSearch} className={itemClassName} data-testid="palette-workspace-search">
          <PaletteGlyph icon={Search} top />
          <PaletteLabel hint={t(inProject ? 'palette.hint.project' : 'palette.hint.office')} hintTestId="palette-search-hint">
            {t('palette.open')}
          </PaletteLabel>
        </CommandItem>
      </CommandGroup>
      {recent.length > 0 ? (
        <CommandGroup heading={t('palette.recent')} data-testid="palette-recent">
          {recent.map((entry) => (
            <PaletteRow key={entry} value={`${PALETTE_SEARCH_VALUE_PREFIX}recent:${entry}`} icon={History} onSelect={() => onRecent(entry)} className={itemClassName}>
              {entry}
            </PaletteRow>
          ))}
        </CommandGroup>
      ) : null}
      {saved && saved.length > 0 ? (
        <CommandGroup heading={t('saved.label')} data-testid="palette-saved">
          {saved.map((item) => (
            <PaletteRow
              key={item.id}
              value={`${PALETTE_SEARCH_VALUE_PREFIX}saved:${item.id}`}
              icon={item.ownedByMe ? Bookmark : Users}
              onSelect={() => onSaved(item)}
              className={itemClassName}
              aside={item.ownedByMe ? undefined : item.ownerName ? t('saved.byColleague', { name: item.ownerName }) : t('saved.fromColleague')}
            >
              {item.name}
            </PaletteRow>
          ))}
        </CommandGroup>
      ) : null}
    </>
  )
}

function PaletteRow({
  value,
  icon,
  onSelect,
  className,
  aside,
  children,
}: {
  value: string
  icon: LucideIcon
  onSelect: () => void
  className?: string
  aside?: string
  children: string
}): JSX.Element {
  return (
    <CommandItem value={value} onSelect={onSelect} className={className}>
      <PaletteGlyph icon={icon} />
      <PaletteLabel>{children}</PaletteLabel>
      {aside ? <PaletteAside>{aside}</PaletteAside> : null}
    </CommandItem>
  )
}
