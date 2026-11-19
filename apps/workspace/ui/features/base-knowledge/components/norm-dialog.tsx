'use client'

import { useState, type JSX } from 'react'
import { toast } from 'sonner'
import { settleNorms, type NormRecognition, type SettleProposalsResult } from '@/adapters/api/base-knowledge-client'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTranslations } from '@/i18n'
import { baseKnowledgeCopy } from '@/i18n/namespaces/base-knowledge'
import type { NormProposal, SettleProposalsBody } from '@/lib/base-knowledge/wire'
import { OFFICE_WORK_KINDS, type OfficeWorkKind } from '@/lib/base-knowledge/wire/vocab'
import { cn } from '@/lib/utils'
import { onePlace, placeOf } from '../hooks/use-norm-recognition'

type Translate = ReturnType<typeof useTranslations>

const NOT_NORM = 'none'
const NO_TOPIC = 'root'
const NORM_COLUMNS = '@2xl:grid-cols-[9rem_minmax(0,1fr)_8rem_11rem]'
const NORM_ROW = `grid grid-cols-1 gap-x-3 gap-y-2 border-b border-hairline py-3 last:border-b-0 ${NORM_COLUMNS} @2xl:items-start`

interface Row {
  kind: OfficeWorkKind | typeof NOT_NORM
  designation: string
  editionLabel: string
  topicId: string | null
}

const rowOf = (proposal: NormProposal): Row => ({
  kind: proposal.kind,
  designation: proposal.designation ?? '',
  editionLabel: proposal.editionLabel ?? '',
  topicId: proposal.topicId,
})

export function settleRows(proposals: readonly NormProposal[], rows: Readonly<Record<string, Row>>): SettleProposalsBody['rows'] {
  return proposals.map((proposal) => {
    const row = rows[proposal.entryId] ?? rowOf(proposal)
    if (row.kind === NOT_NORM) return { entryId: proposal.entryId, notNorm: true }
    const editionLabel = row.editionLabel.trim() || null
    if (proposal.editionOf) return { entryId: proposal.entryId, editionLabel }
    return {
      entryId: proposal.entryId,
      kind: row.kind,
      designation: row.designation.trim() || null,
      editionLabel,
      topicId: row.topicId,
    }
  })
}

const counted = (t: Translate, key: string, count: number, values: Record<string, string | number> = {}) =>
  t(count === 1 ? `${key}One` : key, { count, ...values })

export function settledSummary(t: Translate, { results }: SettleProposalsResult, proposals: readonly NormProposal[]): string {
  const of = (outcome: string) => results.filter((result) => result.outcome === outcome)
  const named = (entryId: string) => {
    const proposal = proposals.find((candidate) => candidate.entryId === entryId)
    return [proposal?.designation, proposal?.editionLabel].filter(Boolean).join(' ')
  }
  const failed = of('failed')
  const parts = [
    of('confirmed').length > 0 ? counted(t, 'norms.result.confirmed', of('confirmed').length) : null,
    of('edition_added').length > 0 ? t('norms.result.editionAdded', { names: of('edition_added').map((result) => named(result.entryId)).join(', ') }) : null,
    of('edition_missing').length > 0 ? counted(t, 'norms.result.missing', of('edition_missing').length) : null,
    of('not_norm').length > 0 ? counted(t, 'norms.result.notNorm', of('not_norm').length) : null,
    of('duplicate_removed').length > 0 ? counted(t, 'norms.result.duplicate', of('duplicate_removed').length) : null,
    failed.length > 0 ? t('norms.result.failed', { count: failed.length, reason: failed[0].error ?? '' }) : null,
  ].filter((part): part is string => part !== null)
  return parts.length > 0 ? parts.join(', ') : t('norms.result.saved')
}

function topicLabel(path: string): string {
  return path.split('/').slice(1).join(' › ') || path
}

function ProposalRow({
  proposal,
  row,
  topics,
  disabled,
  onChange,
}: {
  proposal: NormProposal
  row: Row
  topics: NormRecognition['topics']
  disabled: boolean
  onChange: (row: Row) => void
}): JSX.Element {
  const t = useTranslations(baseKnowledgeCopy)
  const off = row.kind === NOT_NORM
  const missing = !off && row.editionLabel.trim() === '' && !proposal.duplicate
  const workTopic = proposal.editionOf ? topics.folders.find((folder) => folder.id === proposal.topicId) : undefined
  const info = proposal.duplicate
    ? t('norms.duplicate')
    : proposal.editionOf
      ? t('norms.newEdition', { designation: proposal.editionOf.designation ?? '', edition: proposal.editionOf.editionLabel })
      : null
  const infoId = `norm-dialog-info-${proposal.entryId}`
  return (
    <div role="row" className={NORM_ROW} data-testid="norm-dialog-row">
      <div role="cell" className="min-w-0">
        <Select value={row.kind} disabled={disabled} onValueChange={(kind) => onChange({ ...row, kind: kind as Row['kind'] })}>
          <SelectTrigger size="sm" className="w-full" aria-label={`${t('norms.column.kind')}: ${proposal.fileName}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OFFICE_WORK_KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {t(`kind.${kind}`)}
              </SelectItem>
            ))}
            <SelectItem value={NOT_NORM}>{t('norms.notNorm')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div role="cell" className={cn('flex min-w-0 flex-col gap-1', off && 'opacity-60')}>
        <Input
          value={row.designation}
          disabled={disabled || off || proposal.editionOf !== null}
          onChange={(event) => onChange({ ...row, designation: event.target.value })}
          aria-label={`${t('norms.column.designation')}: ${proposal.fileName}`}
          aria-describedby={info ? infoId : undefined}
          className="h-8 w-full min-w-0"
        />
        <span className="truncate text-xs text-muted-foreground" title={proposal.fileName}>
          {proposal.fileName}
        </span>
      </div>
      {info && (
        <p id={infoId} role="cell" aria-colspan={4} className="col-span-full text-xs font-medium text-warning @2xl:order-last" data-testid="norm-dialog-info">
          {info}
        </p>
      )}
      <div role="cell" className="min-w-0">
        <Input
          value={row.editionLabel}
          disabled={disabled || off}
          placeholder={t('norms.editionMissing')}
          aria-invalid={missing || undefined}
          onChange={(event) => onChange({ ...row, editionLabel: event.target.value })}
          aria-label={`${t('norms.column.edition')}: ${proposal.fileName}`}
          className={cn('h-8 w-full min-w-0 tabular-nums', off && 'opacity-60')}
        />
      </div>
      <div role="cell" className="min-w-0">
        {proposal.editionOf ? (
          <span className="block text-xs text-muted-foreground @2xl:pt-2">
            {t('norms.topicOfWork')}: {workTopic ? topicLabel(workTopic.path) : t('norms.noTopic')}
          </span>
        ) : (
          <Select
            value={row.topicId ?? NO_TOPIC}
            disabled={disabled || off}
            onValueChange={(topicId) => onChange({ ...row, topicId: topicId === NO_TOPIC ? null : topicId })}
          >
            <SelectTrigger size="sm" className={cn('w-full', off && 'opacity-60')} aria-label={`${t('norms.column.topic')}: ${proposal.fileName}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_TOPIC}>{t('norms.noTopic')}</SelectItem>
              {topics.folders.map((folder) => (
                <SelectItem key={folder.id} value={folder.id}>
                  {topicLabel(folder.path)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  )
}

function PlainLine({ recognition }: { recognition: NormRecognition }): JSX.Element | null {
  const t = useTranslations(baseKnowledgeCopy)
  const { plain } = recognition
  if (plain.length === 0) return null
  const place = onePlace(plain)
  const where = place
    ? counted(t, 'norms.plain', plain.length, { place: placeOf(t, place) })
    : t('norms.plainScattered', { count: plain.length })
  return (
    <p className="text-sm text-muted-foreground" data-testid="norm-dialog-plain">
      {where}
      {plain.some((file) => file.platformHeld) ? ` ${t('norms.platformHeld')}` : ''}
    </p>
  )
}

export interface NormDialogProps {
  recognition: NormRecognition | null
  onClose: () => void
  onSettled: () => void
}

export function NormDialog({ recognition, onClose, onSettled }: NormDialogProps): JSX.Element {
  return (
    <Dialog open={recognition !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      {recognition && <NormDialogBody key={recognition.proposals.map((proposal) => proposal.entryId).join()} recognition={recognition} onClose={onClose} onSettled={onSettled} />}
    </Dialog>
  )
}

function NormDialogBody({ recognition, onClose, onSettled }: NormDialogProps & { recognition: NormRecognition }): JSX.Element {
  const t = useTranslations(baseKnowledgeCopy)
  const { proposals } = recognition
  const [rows, setRows] = useState<Record<string, Row>>(() => Object.fromEntries(proposals.map((proposal) => [proposal.entryId, rowOf(proposal)])))
  const [busy, setBusy] = useState(false)

  const later = () => {
    if (busy) return
    toast(t('norms.laterDone'))
    onClose()
  }
  const confirm = async () => {
    setBusy(true)
    try {
      const result = await settleNorms({ rows: settleRows(proposals, rows) })
      const summary = settledSummary(t, result, proposals)
      if (result.results.some((row) => row.outcome === 'failed')) toast.warning(summary)
      else toast.success(summary)
      onSettled()
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : t('saveError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogContent
      className="sm:max-w-4xl"
      showCloseButton={false}
      onEscapeKeyDown={(event) => {
        event.preventDefault()
        later()
      }}
      onInteractOutside={(event) => {
        event.preventDefault()
        later()
      }}
      data-testid="norm-dialog"
    >
      <DialogHeader>
        <DialogTitle>{counted(t, 'norms.title', proposals.length)}</DialogTitle>
        <DialogDescription>{t('norms.body')}</DialogDescription>
      </DialogHeader>
      <div className="@container flex min-h-0 flex-col gap-3 overflow-y-auto">
        <div role="table" aria-label={counted(t, 'norms.title', proposals.length)} className="flex flex-col">
          <div role="row" className={`hidden gap-x-3 pb-1 text-xs font-medium text-muted-foreground @2xl:grid ${NORM_COLUMNS}`}>
            <span role="columnheader">{t('norms.column.kind')}</span>
            <span role="columnheader">{t('norms.column.designation')}</span>
            <span role="columnheader">{t('norms.column.edition')}</span>
            <span role="columnheader">{t('norms.column.topic')}</span>
          </div>
          {proposals.map((proposal) => (
            <ProposalRow
              key={proposal.entryId}
              proposal={proposal}
              row={rows[proposal.entryId] ?? rowOf(proposal)}
              topics={recognition.topics}
              disabled={busy}
              onChange={(row) => setRows((current) => ({ ...current, [proposal.entryId]: row }))}
            />
          ))}
        </div>
        <PlainLine recognition={recognition} />
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" disabled={busy} onClick={later} data-testid="norm-dialog-later">
          {t('norms.later')}
        </Button>
        <Button type="button" disabled={busy} onClick={() => void confirm()} data-testid="norm-dialog-confirm">
          {busy ? t('norms.confirming') : t('norms.confirm')}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
