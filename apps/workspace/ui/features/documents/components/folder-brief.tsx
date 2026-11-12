'use client'

import type { JSX, ReactNode } from 'react'
import { Camera, ChevronDown, CircleAlert, CircleDashed, Clock, CornerDownRight, RotateCcw, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Chip, ChipCount, ChipLabel } from '@/components/ui/chip'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { SegmentMeter, TONE_INK, ToneSwatch, type MeterTone } from '@/components/ui/segment-meter'
import { useLocale, useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { dossierCopy } from '@/i18n/namespaces/dossier'
import type { DocumentFindingsResponse } from '@/lib/documents/findings-wire'
import { CLAUSE_JOIN, formatDayRange } from '@/lib/format'
import { offeredForRetry } from '@/lib/documents/retry-policy'
import { tagLabel } from '@/lib/documents/tag-vocabulary'
import { cn } from '@/lib/utils'
import { AsksYouChip } from '@/components/ui/asks-you-chip'
import type { BulkReingestProgress } from '../hooks/use-bulk-reingest'
import { FolderReadState } from './folder-read-state'
import { DocumentFindingsSection, useOpenOnFindingsLink } from './document-findings-panel'
import { BRIEF_CHEVRON, BriefDisclosure } from './brief-disclosure'
import type { MissingDocument } from '@/lib/document-roles/prompt-loader'
import {
  readShare,
  type BriefSelection,
  type FolderBrief as FolderBriefData,
  type FolderLocation,
  type KnowledgeTally,
  type PhotoSpan,
  type ReadState,
} from '../lib/folder-knowledge'

/** Read state → the tone its swatch and meter segment are drawn in. */
export const READ_STATE_TONE: Record<ReadState, MeterTone> = {
  readable: 'ink',
  reading: 'inkSoft',
  failed: 'destructive',
  held: 'warning',
  unindexed: 'muted',
}

/**
 * The states Piloti is meant to read, in the order the legend reads them: what
 * Piloti has, then what is moving, then what needs a person. The headline's read
 * count and the legend's counts add up to its „von N", which is the whole point
 * of listing them apart from `unindexed`.
 */
const MEANT_TO_READ: readonly ReadState[] = ['readable', 'reading', 'failed', 'held']

/**
 * The states the bar draws. `unindexed` is out of the headline's denominator
 * (`readShare`), so it is out of the bar too and named as an aside, unless it is
 * all there is. The legend leaves out `readable`: the headline says how many
 * are read, and a number is said once.
 */
function meterStates(tally: KnowledgeTally): readonly ReadState[] {
  return tally.total - tally.unindexed > 0 ? MEANT_TO_READ : ['unindexed']
}

const meterSegments = (tally: KnowledgeTally) =>
  meterStates(tally).map((state) => ({ key: state, value: tally[state], tone: READ_STATE_TONE[state] }))

/** Whether the documents Piloti never reads are named beside the legend rather than in it. */
function hasUnindexedAside(tally: KnowledgeTally): boolean {
  return tally.unindexed > 0 && tally.total - tally.unindexed > 0
}

export interface FolderBriefProps {
  brief: FolderBriefData
  /** The folder the brief is about, or null at the shelf root. */
  folderName: string | null
  /** Which shelf's root the null folder is — the words differ, the brief does not. */
  shelfKind: 'project' | 'office'
  /** Show a slice of the subtree as a flat listing below the brief. */
  onSelect: (selection: BriefSelection) => void
  /** Walk into a folder below this one. */
  onOpenFolder: (folderId: string) => void
  /**
   * Re-read every failed document in the subtree. Absent when the reader may
   * not write here — a re-read changes the document's state for everybody.
   */
  onReadAgain?: () => void
  readAgainProgress?: BulkReingestProgress | null
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  /**
   * What Piloti expects the PROJECT to hold and does not (`useMissingDocuments`)
   * — the agent's own `documents_missing:` list. Shown at the project root only;
   * null when unknown, so an unread list is never presented as "nothing missing".
   */
  missing?: readonly MissingDocument[] | null
  /**
   * Load what Piloti put on each document, for a {@link FolderBriefData.partial}
   * brief (ADR-0102): the workspace then reads the whole shelf once and the
   * brief is built from it. Absent offers nothing to load.
   */
  onLoadDetails?: () => void
  /** The shelf is being read for {@link onLoadDetails}. */
  detailsLoading?: boolean
  /** What the project's documents say about each other (`useDocumentFindings`): at the project's root only. */
  findings?: { projectId: string; response: DocumentFindingsResponse } | null
  /** The folder holds folders, so the brief speaks for them too. */
  hasSubfolders?: boolean
}

/**
 * „Was Piloti hier weiß" — the folder, as Piloti understands it.
 *
 * A file manager answers "what is in here" with a list of names. That is the
 * wrong question for a shelf whose point is that an assistant reads it: the
 * planner wants to know whether Piloti has READ what is in here, what it took
 * it to be, and what it could not make sense of — and before this, the only way
 * to find out was to open each folder and each file in turn (feld72, Jour fixe
 * 2026-10-09: answers reported documents missing that had been read).
 *
 * So every level opens with Piloti's account of its whole subtree, built from
 * nothing but what the listing already carries (`folder-knowledge.ts`):
 *
 * 1. How much of it Piloti can cite (a sentence and a bar, each state a swatch and a word).
 * 2. What it is about (types, disciplines, kinds of content, as chips that narrow the listing).
 * 3. What needs a person (failures with one re-read for all, held and unplaced documents).
 * 4. Where below it the trouble sits (the deepest folder, one click away).
 *
 * It never shows CONTENT of a document Piloti cannot cite: a quarantined file
 * is counted, never described (`buildFolderBrief`).
 */

export function FolderBrief({
  brief,
  folderName,
  shelfKind,
  onSelect,
  onOpenFolder,
  onReadAgain,
  readAgainProgress,
  collapsed,
  onCollapsedChange,
  missing,
  onLoadDetails,
  detailsLoading = false,
  findings,
  hasSubfolders = false,
}: FolderBriefProps): JSX.Element | null {
  const t = useTranslations(filesCopy)
  const td = useTranslations(dossierCopy)
  const { locale } = useLocale()
  const { tally } = brief
  // What it found, beside what it read: at the root, where the findings are the project's.
  const found = folderName === null && findings && findings.response.findings.length > 0 ? findings : null
  const foundCount = found?.response.findings.length ?? 0
  useOpenOnFindingsLink(foundCount > 0, collapsed, onCollapsedChange)
  // On a phone too, at every level: shown at the root (for its finding) and gone in every folder, the read line was a
  // rule nobody could see (review of 2026-11-10, finding 10).
  if (tally.total === 0) return null

  // The title above names the folder; the line says only how far it reaches („and its subfolders“ where there are some).
  const scope = folderName
    ? t(hasSubfolders ? 'brief.scopeFolderTree' : 'brief.scopeFolder')
    : t(shelfKind === 'office' ? 'brief.scopeOffice' : 'brief.scopeProject')
  const headline = briefHeadline(tally, t)
  const meterLabel = `${headline} ${scope}. ${legendSentence(tally, t)}`

  // ONE ELEMENT THAT OPENS IN PLACE: folded, one quiet line on the listing's edge; open, a sheet on the column's edge
  // with its content 16px in, on a phone too (a 12px bleed left the sheet's edge at 220 under a 232 title).
  const open = !collapsed
  const allRead = everythingRead(tally)
  const quietPages = allRead && !hasUnindexedAside(tally) && tally.pages > 0
  const pagesLine = t('brief.pagesCount', { count: tally.pages, formatted: tally.pages.toLocaleString(locale) })
  return (
    <Card
      className={cn(
        'gap-0 border-0 bg-sheet py-0 shadow-sm transition-[background-color,border-color,box-shadow] duration-quick ease-out motion-reduce:transition-none',
        // Open, a sheet: 32px to the listing under it, as between sections; folded, its line keeps 16px (principle 5).
        collapsed ? 'bg-transparent shadow-none' : 'mb-4'
      )}
      data-testid="folder-brief"
      data-state={open ? 'open' : 'closed'} data-surface={open ? 'sunken' : undefined}
      aria-labelledby="folder-brief-title"
      role="region"
    >
      <Collapsible open={open} onOpenChange={(next) => onCollapsedChange(!next)}>
        {/* Folded, what it read is the quiet line and what asks the reader a chip of its own after it (`AsksYouChip`): at
            the end of the grey sentence, 13px of ink had no weight (finding 12). */}
        <h2 className={cn('m-0', !open && foundCount > 0 && 'flex flex-wrap items-center gap-x-2')}>
          <CollapsibleTrigger asChild>
            <button data-attr="folder-brief-toggle"
              type="button"
              id="folder-brief-title"
              title={t(open ? 'brief.collapse' : 'brief.expand')}
              className={cn(
                'hover:text-foreground focus-visible:ring-ring flex min-w-0 items-center gap-2 rounded-control py-2 text-left text-xs',
                (open || foundCount === 0) && 'w-full',
                'transition-colors duration-quick ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset motion-reduce:transition-none pointer-coarse:min-h-11',
                open ? 'text-foreground px-4' : 'text-muted-foreground px-0' /* folded, its glyph on the listing's edge */
              )}
              data-testid="folder-brief-toggle"
            >
              <Sparkles className="size-3.5 shrink-0" aria-hidden />
              <span className="min-w-0" /* wraps, never cuts (a long project's line was cut at 768px); the chevron follows the last word */>
                <span className={cn(open && 'font-medium')}>{headline}</span>{' '}
                <span className="text-muted-foreground">{scope}</span>
                {/* All read, the page count is the brief's one figure: on its line, not a row of its own. */}
                {open && quietPages && <span className="text-muted-foreground tabular-nums">{CLAUSE_JOIN}{pagesLine}</span>}
                {/* What it found is ink on the quiet line: one more clause, not a second strip (dev, 2026-11-10). */}
                {open && foundCount > 0 && (
                  <span className="text-foreground tabular-nums" data-testid="folder-brief-findings-count">
                    {CLAUSE_JOIN}
                    {td('findings.count', { count: foundCount })}
                  </span>
                )}
                <ChevronDown className={cn(BRIEF_CHEVRON, 'ml-1 inline align-[-2px]', open && 'rotate-180')} aria-hidden />
              </span>
            </button>
          </CollapsibleTrigger>
          {!open && foundCount > 0 && (
            <AsksYouChip onPress={() => onCollapsedChange(false)} testId="folder-brief-findings-count">
              {td('findings.count', { count: foundCount })}
            </AsksYouChip>
          )}
        </h2>

        <CollapsibleContent id="folder-brief-body">
          {/* All read is the quiet case: no bar. While something is open, a hairline, never a band. */}
          {(!allRead || hasUnindexedAside(tally)) && (
            <div className="flex flex-col gap-2.5 px-4 pb-3 pt-0.5" data-testid="folder-brief-meter">
              {!allRead && <SegmentMeter className="h-1" label={meterLabel} segments={meterSegments(tally)} />}
              <ReadStateLegend tally={tally} onSelect={onSelect} />
            </div>
          )}

          {/* Ordered by what the reader has to do: what needs them first, open; then what is missing, what the folder
              is about and where the trouble sits, each folded to one line (open in full it was taller than a laptop). */}
          {/* A measure for its sentences, and each action right after its own: across the page „Anzeigen“ stood 1300px
              from the sentence it acts on (finding 12). */}
          <div className="flex max-w-[720px] flex-col gap-1" data-testid="folder-brief-sections">
            <NeedsYouSection
              brief={brief}
              onSelect={onSelect}
              onReadAgain={onReadAgain}
              readAgainProgress={readAgainProgress}
            />
            {found && <DocumentFindingsSection projectId={found.projectId} response={found.response} />}
            {folderName === null && missing && missing.length > 0 && <MissingSection missing={missing} />}
            {brief.partial ? (
              <DeferredAboutSection tally={tally} onLoadDetails={onLoadDetails} loading={detailsLoading} />
            ) : (
              <AboutSection brief={brief} onSelect={onSelect} />
            )}
            <HotspotSection hotspots={brief.hotspots} onOpenFolder={onOpenFolder} />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}

type Translate = ReturnType<typeof useTranslations>

/** Every document Piloti is meant to read has been read: nothing reading, failed or held. */
export function everythingRead(tally: KnowledgeTally): boolean {
  return tally.reading + tally.failed + tally.held === 0 && tally.readable === tally.total - tally.unindexed
}

function briefHeadline(tally: KnowledgeTally, t: Translate): string {
  const share = readShare(tally)
  if (share === null) return t('brief.headlineNothingToRead', { count: tally.total })
  const meantToRead = tally.total - tally.unindexed
  // Beside documents the agent never reads, „all" says what it counts: the knowledge base's.
  if (tally.readable === meantToRead) return t(tally.unindexed > 0 ? 'brief.headlineAllOfKnowledge' : 'brief.headlineAll', { count: meantToRead })
  if (tally.readable === 0) return t('brief.headlineNone', { count: meantToRead })
  return t('brief.headlineSome', { readable: tally.readable, count: meantToRead })
}

function legendSentence(tally: KnowledgeTally, t: Translate): string {
  const states = meterStates(tally)
    .filter((state) => tally[state] > 0)
    .map((state) => t(`brief.states.${state}`, { count: tally[state] }))
  if (hasUnindexedAside(tally)) states.push(t('brief.unindexedAside', { count: tally.unindexed }))
  return states.join(', ')
}

/** Each state the headline does not name (never `readable`), as swatch + count + word, and a way into exactly those documents. */
function ReadStateLegend({ tally, onSelect }: { tally: KnowledgeTally; onSelect: (s: BriefSelection) => void }) {
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  const states = tally.total > tally.unindexed ? MEANT_TO_READ.filter((state) => state !== 'readable' && tally[state] > 0) : []
  if (hasUnindexedAside(tally)) states.push('unindexed')
  return (
    // `-mx-1.5`: the entries' inset holds their hover fill, so dots and page count stand on the brief's edges.
    <div className="-mx-1.5 flex flex-wrap items-center gap-x-1 gap-y-1">
      {states.map((state) => (
        <button data-attr={state === 'unindexed' ? 'folder-brief-state-unindexed' : 'files-select'}
          key={state}
          type="button"
          onClick={() => onSelect({ kind: 'state', state })}
          className="text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:ring-ring touch-target inline-flex items-center gap-1.5 rounded-control px-1.5 py-0.5 text-xs transition-colors duration-quick ease-out focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none"
          title={t('brief.showState', { state: t(`brief.slice.${state}`) })}
          data-testid={`folder-brief-state-${state}`}
        >
          <ToneSwatch tone={READ_STATE_TONE[state]} />
          <span>
            {state === 'unindexed'
              ? t('brief.unindexedAside', { count: tally.unindexed })
              : t(`brief.states.${state}`, { count: tally[state] })}
          </span>
        </button>
      ))}
      {tally.pages > 0 && (
        <span className="text-muted-foreground ml-auto px-1.5 text-xs tabular-nums">
          {t('brief.pages', { count: tally.pages, formatted: tally.pages.toLocaleString(locale) })}
        </span>
      )}
    </div>
  )
}

/**
 * What Piloti took the documents to be: the document types and disciplines it
 * assigned, each family under its own label, the topics it recognised, and the
 * kinds of content in them. Folded to one line by default; the line names the
 * biggest types, so the folder still says what it is without being opened.
 */
function AboutSection({ brief, onSelect }: { brief: FolderBriefData; onSelect: (s: BriefSelection) => void }) {
  const t = useTranslations(filesCopy)
  const { documentTypes, disciplines, contents, tally, topics, photos } = brief
  const { locale } = useLocale()
  if (tally.readable === 0) return null
  const contentNames = contents.map(({ label }) => t(`preview.contentTypeNames.${label}`))
  // The closed line names the first four kinds and counts the rest; the disclosure holds them all.
  const kinds = [...documentTypes, ...disciplines].map(({ label }) => tagLabel(label, t))
  const more = kinds.length - 4
  const summary = kinds.length === 0 ? t('brief.noTypes') : [...kinds.slice(0, 4), ...(more > 0 ? [t('brief.aboutMore', { count: more })] : [])].join(CLAUSE_JOIN)
  return (
    <BriefDisclosure id="folder-brief-about" title={t('brief.aboutTitle')} summary={summary}>
      {documentTypes.length === 0 && disciplines.length === 0 ? (
        <p className="text-muted-foreground text-xs leading-relaxed">{t('brief.noTypes')}</p>
      ) : (
        <div className="flex flex-col gap-2" data-testid="folder-brief-types">
          {documentTypes.length > 0 && (
            <ChipFamily label={t('brief.typesLabel')}>
              {documentTypes.map(({ label, count }) => (
                <TagChip key={label} label={label} count={count} onSelect={onSelect} />
              ))}
            </ChipFamily>
          )}
          {disciplines.length > 0 && (
            <ChipFamily label={t('brief.disciplinesLabel')}>
              {disciplines.map(({ label, count }) => (
                <TagChip key={label} label={label} count={count} onSelect={onSelect} variant="secondary" />
              ))}
            </ChipFamily>
          )}
        </div>
      )}
      {topics.length > 0 && (
        <ChipFamily label={t('brief.topicsTitle')} testId="folder-brief-topics">
          {topics.map(({ label, count }) => (
            <Chip key={label} asChild interactive variant="muted" size="sm" className="text-foreground/80">
              <button data-attr="files-select"
                type="button"
                onClick={() => onSelect({ kind: 'topic', topic: label })}
                title={t('brief.showTag', { tag: label })}
                data-testid={`folder-brief-topic-${label}`}
              >
                <ChipLabel>{label}</ChipLabel>
                <ChipCount count={count} />
              </button>
            </Chip>
          ))}
        </ChipFamily>
      )}
      {contentNames.length > 0 && (
        <p className="text-muted-foreground text-xs">{t('brief.contains', { list: contentNames.join(CLAUSE_JOIN) })}</p>
      )}
      {photos && (
        <button data-attr="folder-brief-photos"
          type="button"
          onClick={() => onSelect({ kind: 'photos' })}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring touch-target inline-flex items-center gap-1.5 self-start rounded-control text-left text-xs underline underline-offset-2 decoration-muted-foreground/40 transition-colors duration-quick ease-out hover:decoration-current focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none"
          data-testid="folder-brief-photos"
        >
          <Camera className="size-3.5 shrink-0" aria-hidden />
          {photoLine(photos, locale, t)}
        </button>
      )}
    </BriefDisclosure>
  )
}

/**
 * „Worum es hier geht“ before the documents are loaded (ADR-0102). The folder
 * is read page by page, and what Piloti put on each document lives beside the
 * rows rather than in the counts, so the section says that and offers to load
 * them instead of claiming Piloti recognised nothing.
 */
function DeferredAboutSection({
  tally,
  onLoadDetails,
  loading,
}: {
  tally: KnowledgeTally
  onLoadDetails?: () => void
  loading: boolean
}) {
  const t = useTranslations(filesCopy)
  if (tally.readable === 0) return null
  return (
    <BriefDisclosure id="folder-brief-about" title={t('brief.aboutTitle')} summary={t('brief.aboutDeferred')}>
      <p className="text-muted-foreground text-xs leading-relaxed">{t('brief.aboutDeferredHint')}</p>
      {onLoadDetails && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="self-start"
          onClick={onLoadDetails}
          disabled={loading}
          data-testid="folder-brief-load-details"
        >
          {loading ? t('brief.loadingDetails') : t('brief.loadDetails')}
        </Button>
      )}
    </BriefDisclosure>
  )
}

/**
 * One family of chips under its run-in label — „Dokumentart", „Fachbereich",
 * „Themen" — so a type and a discipline are told apart by a word, not only by
 * fill against outline.
 */
function ChipFamily({ label, testId, children }: { label: string; testId?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1" data-testid={testId}>
      <p className="text-muted-foreground text-[11px]">{label}</p>
      <div className="flex min-w-0 flex-wrap gap-1.5 pointer-coarse:gap-2">{children}</div>
    </div>
  )
}

function TagChip({
  label,
  count,
  onSelect,
  variant = 'secondary',
}: {
  label: string
  count: number
  onSelect: (s: BriefSelection) => void
  variant?: 'secondary' | 'outline'
}) {
  const t = useTranslations(filesCopy)
  return (
    <Chip asChild interactive variant={variant} size="sm">
      <button data-attr="files-select"
        type="button"
        onClick={() => onSelect({ kind: 'tag', tag: label })}
        title={t('brief.showTag', { tag: tagLabel(label, t) })}
        data-testid={`folder-brief-tag-${label}`}
      >
        <ChipLabel>{tagLabel(label, t)}</ChipLabel>
        <ChipCount count={count} />
      </button>
    </Chip>
  )
}

/** Failures, holds and unplaced documents — the things a person has to do something about. */
function NeedsYouSection({
  brief,
  onSelect,
  onReadAgain,
  readAgainProgress,
}: {
  brief: FolderBriefData
  onSelect: (s: BriefSelection) => void
  onReadAgain?: () => void
  readAgainProgress?: BulkReingestProgress | null
}) {
  const t = useTranslations(filesCopy)
  // Counted from the tally, which both briefs carry exactly; the attention
  // lists only NAME documents for an action, and a summary-built brief names
  // the failed ones alone, up to the summary's limit (ADR-0102). The re-read
  // button counts what it will send: not a file that failed for a lasting
  // reason (`offeredForRetry`), which stays in the tally and is not sent.
  const { failed, held, unplaced } = brief.tally
  const sendable = offeredForRetry(brief.attention.failed).length
  if (failed + held + unplaced === 0) return null
  return (
    <section className="flex flex-col gap-1 px-4 pb-3 pt-2" aria-labelledby="folder-brief-needs" /* its heading 4px over its rows; 24px from the legend above */>
      <h3 id="folder-brief-needs" className="text-foreground text-name font-medium" /* a heading by weight: 13/20/600 over 14/440 rows (rank by two channels) */>
        {t('brief.needsTitle')}
      </h3>
      {failed > 0 && (
        <AttentionRow
          tone="destructive"
          text={t('brief.failedLine', { count: failed })}
          showLabel={t('brief.showFailed', { count: failed })}
          onShow={() => onSelect({ kind: 'state', state: 'failed' })}
          testId="folder-brief-needs-failed"
        >
          {onReadAgain && (sendable > 0 || Boolean(readAgainProgress)) && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="gap-1.5"
              onClick={onReadAgain}
              disabled={Boolean(readAgainProgress)}
              data-testid="folder-brief-read-again"
            >
              <RotateCcw className={cn('size-3.5', readAgainProgress && 'animate-spin motion-reduce:animate-none')} aria-hidden />
              {readAgainProgress
                ? t('brief.readAgainProgress', { done: readAgainProgress.done, count: readAgainProgress.total })
                : sendable === 2
                  ? t('brief.readAgainBoth')
                  : t('brief.readAgainAll', { count: sendable })}
            </Button>
          )}
        </AttentionRow>
      )}
      {held > 0 && (
        <AttentionRow
          tone="warning"
          text={t('brief.heldLine', { count: held })}
          showLabel={t('brief.showHeld', { count: held })}
          onShow={() => onSelect({ kind: 'state', state: 'held' })}
          testId="folder-brief-needs-held"
        />
      )}
      {unplaced > 0 && (
        <AttentionRow
          tone="muted"
          text={t('brief.unplacedLine', { count: unplaced })}
          hint={t('brief.unplacedHint')}
          showLabel={t('brief.showUnplaced', { count: unplaced })}
          onShow={() => onSelect({ kind: 'unplaced' })}
          testId="folder-brief-needs-unplaced"
        />
      )}
    </section>
  )
}

/** What needs the reader by its glyph: failed (red, alert), held (ochre, a clock), unplaced (muted, an open circle). */
const AttentionGlyph = ({ tone }: { tone: MeterTone }): JSX.Element => {
  const Glyph = tone === 'destructive' ? CircleAlert : tone === 'warning' ? Clock : CircleDashed
  return <Glyph className={cn('mt-[5px] size-3.5 shrink-0', TONE_INK[tone === 'muted' ? 'ink' : tone])} aria-hidden />
}

function AttentionRow({
  tone,
  text,
  hint,
  showLabel,
  onShow,
  testId,
  children,
}: {
  tone: MeterTone
  text: string
  hint?: string
  /** The button's accessible name: three „Anzeigen" in a row are three different things. */
  showLabel: string
  onShow: () => void
  testId: string
  children?: ReactNode
}) {
  const t = useTranslations(filesCopy)
  return (
    <div className="flex items-start gap-2" data-testid={testId}>
      <AttentionGlyph tone={tone} /* a glyph with the colour and the words: a bare red dot was a hue alone */ />
      {/* The sentence, then its actions as one group: at the line's end where it fits, together below on a phone. */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <p className="text-foreground min-w-0 flex-1 basis-48 py-[3px] text-[13px] leading-snug">{text}</p>
          <div className="flex shrink-0 items-center gap-3">
            {children}
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="shrink-0" /* tonal as the press before it, 12px after it (the group's gap), its fill on the brief's edge */
              onClick={onShow}
              aria-label={showLabel}
              title={showLabel}
            >
              {t('brief.show')}
            </Button>
          </div>
        </div>
        {hint && <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">{hint}</p>}
      </div>
    </div>
  )
}

/** The deepest folders below this one where something waits — the reader goes there, not to an ancestor. */
function HotspotSection({
  hotspots,
  onOpenFolder,
}: {
  hotspots: readonly FolderLocation[]
  onOpenFolder: (id: string) => void
}) {
  const t = useTranslations(filesCopy)
  if (hotspots.length === 0) return null
  return (
    <BriefDisclosure
      id="folder-brief-where"
      title={t('brief.whereTitle')}
      summary={hotspots.map(({ trail }) => trail.join(' / ')).join(CLAUSE_JOIN)}
    >
      <ul className="-mx-1.5 flex flex-col">
        {hotspots.map(({ folder, trail, tally }) => (
          <li key={folder.id}>
            <button data-attr="files-open-folder"
              type="button"
              onClick={() => onOpenFolder(folder.id)}
              className="hover:bg-hover focus-visible:ring-ring touch-target group flex w-full min-w-0 items-center gap-2 rounded-control px-1.5 py-1 text-left transition-colors duration-quick ease-out focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none"
              data-testid={`folder-brief-hotspot-${folder.id}`}
            >
              <CornerDownRight className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
              <span className="text-foreground min-w-0 flex-1 truncate text-[13px]" title={trail.join(' / ')}>
                {trail.join(' / ')}
              </span>
              <FolderReadState tally={tally} withUnplaced />
            </button>
          </li>
        ))}
      </ul>
    </BriefDisclosure>
  )
}

/** How many expected documents the brief names before it says how many more. */
const MAX_MISSING_SHOWN = 8

/**
 * „Was Piloti noch fehlt" — the documents the project's intake answers say it
 * should have, that no file has been named as.
 *
 * This is the list the agent reads as `documents_missing:` on every turn, and
 * it was invisible to the people it describes. It explains the complaint that
 * started this surface: an answer calling a document missing that had been
 * uploaded and read. Read is not the same as KNOWN AS — until a file is bound
 * to the role, Piloti cannot tell that this PDF is the Energieausweis.
 */
function MissingSection({ missing }: { missing: readonly MissingDocument[] }) {
  const t = useTranslations(filesCopy)
  const shown = missing.slice(0, MAX_MISSING_SHOWN)
  const more = missing.length - shown.length
  const name = (entry: MissingDocument) => (entry.buildingName ? `${entry.label} · ${entry.buildingName}` : entry.label)
  return (
    <BriefDisclosure id="folder-brief-missing" title={t('brief.missingTitle')} summary={missing.map(name).join(', ')}>
      <p className="text-foreground text-[13px] leading-snug">{t('brief.missingLead')}</p>
      <ul className="flex min-w-0 flex-wrap gap-1.5 pointer-coarse:gap-2">
        {shown.map((entry) => (
          <li key={`${entry.role}@${entry.buildingName ?? ''}`} className="min-w-0 max-w-full">
            <Chip variant="secondary" size="sm" title={name(entry)}>
              <ToneSwatch tone="muted" />
              <ChipLabel>{name(entry)}</ChipLabel>
            </Chip>
          </li>
        ))}
        {more > 0 && (
          <li>
            <Chip variant="muted" size="sm">
              {t('brief.missingMore', { count: more })}
            </Chip>
          </li>
        )}
      </ul>
      <p className="text-muted-foreground text-xs leading-relaxed">{t('brief.missingHint')}</p>
    </BriefDisclosure>
  )
}

/** „12 Fotos vom 3.–20. Sept. 2026“ — the span the camera clocks say, not the upload dates. */
function photoLine(photos: PhotoSpan, locale: string, t: Translate): string {
  return t('brief.photos', { count: photos.count, span: formatDayRange(photos.from, photos.to, locale) })
}
