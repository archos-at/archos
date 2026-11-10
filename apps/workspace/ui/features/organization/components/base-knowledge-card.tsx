'use client'

/**
 * Organisation → Grundlagen des Büros (ADR-0158): the office's licensed
 * standards, commentaries and directives. Each entry shows what it is, its
 * edition, where it applies, its licence and when it was last checked, with a
 * warning once the check is overdue. A proposal shows what was read from the
 * document as a short form the person corrects and confirms; nothing reaches
 * an answer before that.
 *
 * Every action is an operation of `/api/base-knowledge` (`base-knowledge-*` on
 * the agent door), so an agent can do the same without this card.
 */

import { type FC, useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import {
  confirmBaseKnowledge,
  listBaseKnowledge,
  listShelfCandidates,
  proposeBaseKnowledge,
  uploadBaseKnowledge,
  recordBaseKnowledgeCheck,
  removeBaseKnowledge,
  setBaseKnowledgeLicence,
  type BaseKnowledgeEntry,
  type BaseKnowledgeList,
  type ShelfCandidate,
} from '@/adapters/api/base-knowledge-client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { EmptyState } from '@/components/ui/empty-state'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useTranslations } from '@/i18n'
import { organizationCopy } from '@/i18n/namespaces/organization'
import { KNOWLEDGE_WORK_KINDS, LICENCE_CLASSES } from '@/lib/base-knowledge/wire/vocab'
import type { EntryValues } from '@/lib/base-knowledge/wire'

type Translate = ReturnType<typeof useTranslations>

const day = (iso: string) => new Date(iso).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })

/** The one line under an entry's name: kind, edition, where it applies, a directive's authority. */
function entryFacts(t: Translate, values: EntryValues): string {
  const parts = [t(`baseKnowledge.kind.${values.kind}`), t('baseKnowledge.edition', { label: values.editionLabel })]
  if (values.territoryIds.length > 0) parts.push(t('baseKnowledge.appliesIn', { territories: values.territoryIds.join(', ') }))
  if (values.addressees.length > 0) {
    parts.push(t('baseKnowledge.addressedTo', { authorities: values.addressees.map((a) => a.name).join(', ') }))
  }
  return parts.join(' · ')
}

const Freshness: FC<{ entry: BaseKnowledgeEntry }> = ({ entry }) => {
  const t = useTranslations(organizationCopy)
  const { lastCheck, overdue } = entry.freshness
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {lastCheck ? t('baseKnowledge.checkedAt', { date: day(lastCheck.checkedAt) }) : t('baseKnowledge.neverChecked')}
      {overdue && <Badge variant="warning">{t('baseKnowledge.overdue')}</Badge>}
    </span>
  )
}

interface RowProps {
  entry: BaseKnowledgeEntry
  canManage: boolean
  busy: boolean
  onCheck: (entry: BaseKnowledgeEntry) => void
  onAllowAi: (entry: BaseKnowledgeEntry) => void
  onRemove: (entry: BaseKnowledgeEntry) => void
}

const ConfirmedRow: FC<RowProps> = ({ entry, canManage, busy, onCheck, onAllowAi, onRemove }) => {
  const t = useTranslations(organizationCopy)
  const { values } = entry
  return (
    <li className="flex flex-col gap-2 py-3" data-testid="base-knowledge-entry">
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium">
          {values.designation ?? values.title}
          {values.designation && <span className="font-normal text-muted-foreground"> · {values.title}</span>}
        </p>
        <p className="text-xs text-muted-foreground">{entryFacts(t, values)}</p>
        <Freshness entry={entry} />
        {entry.textUse === 'metadata_only' && (
          <p className="text-xs text-muted-foreground">{t('baseKnowledge.metadataOnlyHint')}</p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {values.licenceClass === 'licensed' && <Badge variant="info">{t('baseKnowledge.licensed')}</Badge>}
        {entry.textUse === 'metadata_only' && <Badge variant="secondary">{t('baseKnowledge.metadataOnly')}</Badge>}
        {canManage && entry.textUse === 'metadata_only' && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onAllowAi(entry)}>
            {t('baseKnowledge.allowAi')}
          </Button>
        )}
        {canManage && (
          <>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onCheck(entry)}>
              {t('baseKnowledge.check')}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onRemove(entry)}>
              {t('baseKnowledge.remove')}
            </Button>
          </>
        )}
      </div>
    </li>
  )
}

interface ProposalProps {
  entry: BaseKnowledgeEntry
  canManage: boolean
  busy: boolean
  onConfirm: (entry: BaseKnowledgeEntry, values: EntryValues, attested: { licence: boolean; ai: boolean }) => void
  onRemove: (entry: BaseKnowledgeEntry) => void
}

const ProposalRow: FC<ProposalProps> = ({ entry, canManage, busy, onConfirm, onRemove }) => {
  const t = useTranslations(organizationCopy)
  const [values, setValues] = useState<EntryValues>(entry.values)
  const [attested, setAttested] = useState(false)
  const [aiAttested, setAiAttested] = useState(false)
  const set = <K extends keyof EntryValues>(key: K, value: EntryValues[K]) => setValues((v) => ({ ...v, [key]: value }))
  const authority = values.addressees[0]?.name ?? ''
  const needsAttestation = values.licenceClass === 'licensed'
  return (
    <li className="space-y-3 py-3" data-testid="base-knowledge-proposal">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{t('baseKnowledge.proposed')}</Badge>
        <span className="truncate text-sm font-medium">{entry.fileName}</span>
      </div>
      <p className="text-xs text-muted-foreground">{t('baseKnowledge.proposedHint')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel>{t('baseKnowledge.field.kind')}</FieldLabel>
          <Select value={values.kind} onValueChange={(kind) => set('kind', kind as EntryValues['kind'])} disabled={!canManage}>
            <SelectTrigger aria-label={t('baseKnowledge.field.kind')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KNOWLEDGE_WORK_KINDS.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {t(`baseKnowledge.kind.${kind}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel>{t('baseKnowledge.field.designation')}</FieldLabel>
          <Input
            value={values.designation ?? ''}
            disabled={!canManage}
            onChange={(event) => set('designation', event.target.value.trim() ? event.target.value : null)}
          />
        </Field>
        <Field>
          <FieldLabel>{t('baseKnowledge.field.title')}</FieldLabel>
          <Input value={values.title} disabled={!canManage} onChange={(event) => set('title', event.target.value)} />
        </Field>
        <Field>
          <FieldLabel>{t('baseKnowledge.field.editionLabel')}</FieldLabel>
          <Input value={values.editionLabel} disabled={!canManage} onChange={(event) => set('editionLabel', event.target.value)} />
        </Field>
        <Field>
          <FieldLabel>{t('baseKnowledge.field.territoryIds')}</FieldLabel>
          <Input
            value={values.territoryIds.join(', ')}
            disabled={!canManage}
            onChange={(event) =>
              set('territoryIds', event.target.value.split(',').map((part) => part.trim().toUpperCase()).filter(Boolean))
            }
          />
        </Field>
        {values.kind === 'authority_directive' && (
          <Field>
            <FieldLabel>{t('baseKnowledge.field.authority')}</FieldLabel>
            <Input
              value={authority}
              disabled={!canManage}
              onChange={(event) =>
                set(
                  'addressees',
                  event.target.value.trim()
                    ? [{ name: event.target.value, territoryId: values.territoryIds[0] ?? values.addressees[0]?.territoryId ?? 'AT' }]
                    : [],
                )
              }
            />
          </Field>
        )}
        <Field>
          <FieldLabel>{t('baseKnowledge.field.licenceClass')}</FieldLabel>
          <Select
            value={values.licenceClass}
            onValueChange={(licence) => set('licenceClass', licence as EntryValues['licenceClass'])}
            disabled={!canManage}
          >
            <SelectTrigger aria-label={t('baseKnowledge.field.licenceClass')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LICENCE_CLASSES.map((licence) => (
                <SelectItem key={licence} value={licence}>
                  {t(`baseKnowledge.licence.${licence}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      {canManage && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {needsAttestation ? (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={attested} onCheckedChange={(checked) => setAttested(checked === true)} />
                {t('baseKnowledge.attest')}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={aiAttested} onCheckedChange={(checked) => setAiAttested(checked === true)} />
                {t('baseKnowledge.attestAi')}
              </label>
            </div>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onRemove(entry)}>
              {t('baseKnowledge.remove')}
            </Button>
            <Button size="sm" disabled={busy || (needsAttestation && !attested)} onClick={() => onConfirm(entry, values, { licence: attested, ai: aiAttested })}>
              {t('baseKnowledge.confirm')}
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}

const UploadCopy: FC<{ busy: boolean; onUpload: (file: File) => void }> = ({ busy, onUpload }) => {
  const t = useTranslations(organizationCopy)
  return (
    <Field>
      <FieldLabel htmlFor="base-knowledge-upload">{t('baseKnowledge.upload')}</FieldLabel>
      <Input
        id="base-knowledge-upload"
        type="file"
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) onUpload(file)
        }}
      />
      <p className="text-xs text-muted-foreground">{t('baseKnowledge.uploadHint')}</p>
    </Field>
  )
}

const AddFromShelf: FC<{ recorded: ReadonlySet<string>; busy: boolean; onPropose: (documentId: string) => void }> = ({
  recorded,
  busy,
  onPropose,
}) => {
  const t = useTranslations(organizationCopy)
  const [candidates, setCandidates] = useState<ShelfCandidate[] | null>(null)
  const [chosen, setChosen] = useState<string>('')
  useEffect(() => {
    let cancelled = false
    listShelfCandidates()
      .then((list) => !cancelled && setCandidates(list))
      .catch(() => !cancelled && setCandidates([]))
    return () => {
      cancelled = true
    }
  }, [])
  const open = useMemo(() => (candidates ?? []).filter((candidate) => !recorded.has(candidate.id)), [candidates, recorded])
  if (candidates === null) return <Skeleton className="h-9 w-full" />
  if (open.length === 0) return <p className="text-xs text-muted-foreground">{t('baseKnowledge.noCandidates')}</p>
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <Field className="flex-1">
        <FieldLabel>{t('baseKnowledge.add')}</FieldLabel>
        <Select value={chosen} onValueChange={setChosen}>
          <SelectTrigger aria-label={t('baseKnowledge.pick')}>
            <SelectValue placeholder={t('baseKnowledge.pick')} />
          </SelectTrigger>
          <SelectContent>
            {open.map((candidate) => (
              <SelectItem key={candidate.id} value={candidate.id}>
                {candidate.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Button size="sm" disabled={busy || !chosen} onClick={() => onPropose(chosen)}>
        {t('baseKnowledge.propose')}
      </Button>
    </div>
  )
}

export const BaseKnowledgeCard: FC = () => {
  const t = useTranslations(organizationCopy)
  const [list, setList] = useState<BaseKnowledgeList | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    try {
      setList(await listBaseKnowledge())
    } catch {
      setFailed(true)
    }
  }, [])
  useEffect(() => {
    void reload()
  }, [reload])

  const act = useCallback(
    async (action: () => Promise<unknown>) => {
      setBusy(true)
      try {
        await action()
        await reload()
      } catch {
        toast.error(t('baseKnowledge.saveError'))
      } finally {
        setBusy(false)
      }
    },
    [reload, t],
  )

  if (failed) return <EmptyState variant="bare" title={t('baseKnowledge.loadError')} />
  if (!list) return <Skeleton className="h-24 w-full" />
  if (!list.enabled) return <EmptyState variant="bare" title={t('baseKnowledge.off')} />
  const recorded = new Set(list.entries.map((entry) => entry.documentId))
  return (
    <div className="space-y-4">
      {list.entries.length === 0 ? (
        <EmptyState variant="bare" title={t('baseKnowledge.empty')} />
      ) : (
        <ul className="divide-y divide-border">
          {list.entries.map((entry) =>
            entry.status === 'proposed' ? (
              <ProposalRow
                key={entry.id}
                entry={entry}
                canManage={list.canManage}
                busy={busy}
                onConfirm={(e, values, attested) =>
                  void act(() =>
                    confirmBaseKnowledge(e.id, { ...values, licenceAttested: attested.licence, aiProcessingAttested: attested.ai }),
                  )
                }
                onRemove={(e) => window.confirm(t('baseKnowledge.removeConfirm')) && void act(() => removeBaseKnowledge(e.id))}
              />
            ) : (
              <ConfirmedRow
                key={entry.id}
                entry={entry}
                canManage={list.canManage}
                busy={busy}
                onCheck={(e) => void act(() => recordBaseKnowledgeCheck(e.id, { result: 'current' }))}
                onAllowAi={(e) => void act(() => setBaseKnowledgeLicence(e.id, { aiProcessingAttested: true }))}
                onRemove={(e) => window.confirm(t('baseKnowledge.removeConfirm')) && void act(() => removeBaseKnowledge(e.id))}
              />
            ),
          )}
        </ul>
      )}
      {list.canManage && <UploadCopy busy={busy} onUpload={(file) => void act(() => uploadBaseKnowledge(file))} />}
      {list.canManage && <AddFromShelf recorded={recorded} busy={busy} onPropose={(id) => void act(() => proposeBaseKnowledge(id))} />}
    </div>
  )
}
