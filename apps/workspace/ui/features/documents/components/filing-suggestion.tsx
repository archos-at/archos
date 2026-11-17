'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type JSX,
  type ReactNode,
} from 'react'
import { FilingChip, NewMark } from '@/components/ui/filing-chip'
import { PathChange } from '@/components/ui/path-change'
import { Popover, PopoverTrigger } from '@/components/ui/popover'
import {
  SuggestionActions,
  SuggestionButton,
  SuggestionNote,
  SuggestionPopoverContent,
  SuggestionReason,
} from '@/components/ui/suggestion-panel'
import { useServerProposal, type ProposalOfKind } from '@/features/cards/hooks/use-server-proposal'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { FilingFolderSuggestion, FilingSuggestionView } from '../lib/filing-suggestions'

export function folderLeaf(path: string): string {
  const segments = path.split('/').filter((segment) => segment.trim() !== '')
  return segments.at(-1) ?? path
}

interface FilingSuggestionsContextValue {
  suggestionFor: (documentId: string) => FilingSuggestionView | undefined
  byFolder: readonly FilingFolderSuggestion[]
  onSettled: () => void
  folderPathOf: (documentId: string) => string | undefined
  openOnArrival: string | null
}

const FilingSuggestionsContext = createContext<FilingSuggestionsContextValue | null>(null)

export function useFilingSuggestionsContext(): FilingSuggestionsContextValue | null {
  return useContext(FilingSuggestionsContext)
}

export interface FilingHighlightStore {
  light: (documentIds: readonly string[]) => () => void
  has: (documentId: string) => boolean
  subscribe: (listener: () => void) => () => void
}

function createHighlightStore(): FilingHighlightStore {
  let lit: ReadonlySet<string> = new Set()
  const listeners = new Set<() => void>()
  const set = (next: ReadonlySet<string>) => {
    lit = next
    for (const listener of listeners) listener()
  }
  return {
    light: (documentIds) => {
      const mine = new Set(documentIds)
      set(mine)
      return () => {
        if (lit === mine) set(new Set())
      }
    },
    has: (documentId) => lit.has(documentId),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

const FilingHighlightContext = createContext<FilingHighlightStore | null>(null)

export function useFilingHighlight(): FilingHighlightStore | null {
  return useContext(FilingHighlightContext)
}

const noSubscription = () => () => undefined

export function useFilingHighlighted(documentId: string | null | undefined): boolean {
  const store = useContext(FilingHighlightContext)
  return useSyncExternalStore(
    store?.subscribe ?? noSubscription,
    () => Boolean(store && documentId && store.has(documentId)),
    () => false
  )
}

export function useLightWhile(active: boolean, documentIds: readonly string[]): void {
  const store = useFilingHighlight()
  const key = documentIds.join('\u0000')
  useEffect(() => {
    if (!active || !store || key === '') return
    return store.light(key.split('\u0000'))
  }, [active, store, key])
}

const NO_FOLDERS: readonly FilingFolderSuggestion[] = []
const unknownLocation = () => undefined

export function FilingSuggestionsProvider({
  byDocument,
  byFolder = NO_FOLDERS,
  onSettled,
  folderPathOf = unknownLocation,
  openOnArrival = null,
  children,
}: {
  byDocument: ReadonlyMap<string, FilingSuggestionView>
  byFolder?: readonly FilingFolderSuggestion[]
  onSettled: () => void
  folderPathOf?: (documentId: string) => string | undefined
  openOnArrival?: string | null
  children: ReactNode
}): JSX.Element {
  const value = useMemo(
    () => ({
      suggestionFor: (documentId: string) => byDocument.get(documentId),
      byFolder,
      onSettled,
      folderPathOf,
      openOnArrival,
    }),
    [byDocument, byFolder, onSettled, folderPathOf, openOnArrival]
  )
  const [highlight] = useState(createHighlightStore)
  return (
    <FilingSuggestionsContext.Provider value={value}>
      <FilingHighlightContext.Provider value={highlight}>{children}</FilingHighlightContext.Provider>
    </FilingSuggestionsContext.Provider>
  )
}

export function useFilingDecision(suggestion: FilingSuggestionView, onSettled: () => void) {
  const t = useTranslations(filesCopy)
  const settled = useCallback((_proposal: ProposalOfKind<'file_operation'>) => onSettled(), [onSettled])
  const { proposal, problem, busy, decide } = useServerProposal(suggestion.proposalId, 'file_operation', settled)
  const status = proposal?.status ?? 'proposed'
  const outcome =
    status === 'proposed'
      ? null
      : status === 'applied' || status === 'partially_applied'
        ? t('filing.moved', { folder: suggestion.folder })
        : status === 'failed'
          ? t('filing.failed')
          : t('filing.kept')
  return {
    status,
    outcome,
    failure: status === 'failed' ? (proposal?.results?.find((result) => !result.ok)?.reason ?? null) : null,
    mayDecide: proposal ? proposal.canDecide : suggestion.canDecide,
    error: problem === 'apply' || problem === 'dismiss' ? t('filing.error') : null,
    busy,
    apply: () => void decide('apply'),
    dismiss: () => void decide('dismiss'),
  }
}

export function FilingSuggestionSlot({
  documentId,
  className,
}: {
  documentId: string | null | undefined
  className?: string
}): JSX.Element | null {
  const context = useContext(FilingSuggestionsContext)
  const suggestion = documentId ? context?.suggestionFor(documentId) : undefined
  if (!context || !suggestion || !documentId) return null
  return (
    <FilingSuggestionChip
      key={suggestion.proposalId}
      documentId={documentId}
      suggestion={suggestion}
      onSettled={context.onSettled}
      folderPath={context.folderPathOf(documentId)}
      defaultOpen={context.openOnArrival === documentId}
      className={className}
    />
  )
}

const stop = (event: { stopPropagation: () => void }) => event.stopPropagation()

function FilingSuggestionChip({
  documentId,
  suggestion,
  onSettled,
  folderPath,
  defaultOpen,
  className,
}: {
  documentId: string
  suggestion: FilingSuggestionView
  onSettled: () => void
  folderPath: string | undefined
  defaultOpen: boolean
  className?: string
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const [open, setOpen] = useState(defaultOpen)
  const others = useMemo(
    () => suggestion.documentIds.filter((id) => id !== documentId),
    [suggestion.documentIds, documentId]
  )
  useLightWhile(open, others)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* The chip sits on a card or a row that opens the file: its own
            press, key and click stay its own. */}
        <FilingChip
          target={folderLeaf(suggestion.folder)}
          newLabel={suggestion.isNew ? t('filing.new') : undefined}
          aria-label={t('filing.chip', { folder: suggestion.folder })}
          className={className}
          data-testid="filing-chip"
          onClick={stop}
          onPointerDown={stop}
          onKeyDown={stop}
        />
      </PopoverTrigger>
      <SuggestionPopoverContent
        side="top"
        aria-label={t('filing.label')}
        data-testid="filing-popover"
        onOpenAutoFocus={defaultOpen ? (event) => event.preventDefault() : undefined}
      >
        <FilingDecisionBody suggestion={suggestion} onSettled={onSettled} folderPath={folderPath} />
      </SuggestionPopoverContent>
    </Popover>
  )
}

function FilingDecisionBody({
  suggestion,
  onSettled,
  folderPath,
}: {
  suggestion: FilingSuggestionView
  onSettled: () => void
  folderPath: string | undefined
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const decision = useFilingDecision(suggestion, onSettled)
  const others = suggestion.fileCount - 1
  const from =
    folderPath === undefined
      ? undefined
      : folderPath !== ''
        ? folderPath
        : suggestion.shelf === 'office'
          ? t('filing.rootOffice')
          : t('filing.rootProject')

  const path = (
    <PathChange
      from={from}
      to={suggestion.folder}
      toMark={suggestion.isNew ? <NewMark>{t('filing.new')}</NewMark> : undefined}
      fromLabel={t('filing.from')}
      toLabel={t('filing.to')}
    />
  )

  if (decision.outcome) {
    return (
      <>
        {path}
        <SuggestionNote tone="default" data-testid="filing-outcome" data-status={decision.status}>
          {decision.outcome}
        </SuggestionNote>
        {decision.failure && <SuggestionNote tone="error">{decision.failure}</SuggestionNote>}
      </>
    )
  }

  const moveLabel = suggestion.isNew
    ? t('filing.createAndMove')
    : others > 0
      ? t('filing.moveAll', { count: suggestion.fileCount })
      : t('filing.move')

  return (
    <>
      {path}
      {others > 0 && <SuggestionNote data-testid="filing-others">{t('filing.others', { count: others })}</SuggestionNote>}
      {suggestion.reason && <SuggestionReason title={suggestion.reason}>{suggestion.reason}</SuggestionReason>}
      {decision.error && <SuggestionNote tone="error">{decision.error}</SuggestionNote>}
      {decision.mayDecide ? (
        <SuggestionActions>
          <SuggestionButton
            variant="secondary"
            loading={decision.busy?.action === 'dismiss'}
            aria-disabled={decision.busy !== null}
            onClick={decision.dismiss}
            data-testid="filing-suggestion-dismiss"
          >
            {t('filing.keep')}
          </SuggestionButton>
          <SuggestionButton
            loading={decision.busy?.action === 'apply'}
            aria-disabled={decision.busy !== null}
            onClick={decision.apply}
            data-testid="filing-suggestion-apply"
            data-attr="files-filing-move"
          >
            {moveLabel}
          </SuggestionButton>
        </SuggestionActions>
      ) : (
        <SuggestionNote>{t('filing.readOnly')}</SuggestionNote>
      )}
    </>
  )
}
