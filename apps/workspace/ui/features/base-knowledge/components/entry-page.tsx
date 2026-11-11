'use client'

/**
 * One office standard, opened from the list as a page in place of it: what it is (the form), where it
 * is filed, what happens to its text and why, when it was last checked, and
 * every action on it: confirm or save, the licence statements, record a check,
 * upload a newer edition, move, remove. Each action is one call of
 * `/api/base-knowledge` (a `base-knowledge-*` operation), so an agent can do
 * the same without this page; the licence statements are the person's alone.
 */

import { useRef, useState, type JSX } from 'react'
import { toast } from 'sonner'
import { Upload } from 'lucide-react'
import {
  addBaseKnowledgeEdition,
  bulkBaseKnowledge,
  confirmBaseKnowledge,
  recordBaseKnowledgeCheck,
  removeBaseKnowledge,
  setBaseKnowledgeLicence,
  updateBaseKnowledge,
  type BaseKnowledgeEntry,
  type BaseKnowledgeFolder,
} from '@/adapters/api/base-knowledge-client'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { SectionLabel } from '@/components/ui/section-label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { BackControl } from '@/components/shell/back-link'
import { useLocale, useTranslations } from '@/i18n'
import { baseKnowledgeCopy } from '@/i18n/namespaces/base-knowledge'
import type { EntryValues } from '@/lib/base-knowledge/wire'
import type { KnowledgeCheckResult } from '@/lib/base-knowledge/wire/vocab'
import { day, StatusChip, TextUseChip } from './entry-atoms'
import { EntryForm, type TerritoryChoice } from './entry-form'

interface EntryPageProps {
  entry: BaseKnowledgeEntry | null
  onClose?: () => void
  canManage: boolean
  rootId: string | null
  folders: readonly BaseKnowledgeFolder[]
  /** Where an entry can apply, to pick from (`BaseKnowledgeList.territories`). */
  territories: readonly TerritoryChoice[]
  /** After a change: reload the list; `null` when the entry is gone. */
  onChanged: (entry: BaseKnowledgeEntry | null) => void
}

type Run = (action: () => Promise<BaseKnowledgeEntry | null>, done?: string) => Promise<void>

function useRun(onChanged: EntryPageProps['onChanged']): { busy: boolean; run: Run } {
  const t = useTranslations(baseKnowledgeCopy)
  const [busy, setBusy] = useState(false)
  const run: Run = async (action, done) => {
    setBusy(true)
    try {
      onChanged(await action())
      toast.success(done ?? t('saved'))
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : t('saveError'))
    } finally {
      setBusy(false)
    }
  }
  return { busy, run }
}

function Provenance({ entry }: { entry: BaseKnowledgeEntry }): JSX.Element {
  const t = useTranslations(baseKnowledgeCopy)
  return (
    <p className="text-muted-foreground text-xs">
      {t(`detail.proposedBy.${entry.proposedBy}`)}
      {entry.status === 'confirmed' &&
        ` · ${entry.confirmedByName ? t('detail.confirmedBy', { name: entry.confirmedByName }) : t('detail.confirmedByUnknown')}`}
    </p>
  )
}

function FolderField({
  entry,
  canManage,
  rootId,
  folders,
  busy,
  run,
}: Pick<EntryPageProps, 'canManage' | 'rootId' | 'folders'> & {
  entry: BaseKnowledgeEntry
  busy: boolean
  run: Run
}): JSX.Element {
  const t = useTranslations(baseKnowledgeCopy)
  const known =
    entry.folderId !== null &&
    (entry.folderId === rootId || folders.some((folder) => folder.id === entry.folderId))
  const move = (folderId: string) =>
    run(async () => {
      const [result] = (
        await bulkBaseKnowledge({ entryIds: [entry.id], action: { type: 'move', folderId } })
      ).results
      if (!result?.ok) throw new Error(result?.error ?? '')
      return { ...entry, folderId }
    })
  return (
    <Field>
      <FieldLabel htmlFor="bk-folder">{t('detail.folder')}</FieldLabel>
      <Select
        value={known ? (entry.folderId ?? undefined) : undefined}
        disabled={!canManage || busy || !rootId}
        onValueChange={(id) => void move(id)}
      >
        <SelectTrigger id="bk-folder">
          <SelectValue placeholder={t('folders.elsewhere')} />
        </SelectTrigger>
        <SelectContent>
          {rootId && <SelectItem value={rootId}>{t('detail.rootFolder')}</SelectItem>}
          {folders.map((folder) => (
            <SelectItem key={folder.id} value={folder.id}>
              {folder.path.split('/').slice(1).join(' / ')}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldDescription>
        {t('detail.file')}: {entry.fileName}
      </FieldDescription>
    </Field>
  )
}

/** The licence statements: on a proposal, the two to confirm with; on a confirmed licensed copy, the AI one to give or take back. */
function LicenceSection({
  entry,
  values,
  attest,
  setAttest,
  canManage,
  busy,
  run,
}: {
  entry: BaseKnowledgeEntry
  values: EntryValues
  attest: { licence: boolean; ai: boolean }
  setAttest: (next: { licence: boolean; ai: boolean }) => void
  canManage: boolean
  busy: boolean
  run: Run
}): JSX.Element | null {
  const t = useTranslations(baseKnowledgeCopy)
  if (values.licenceClass !== 'licensed') return null
  const aiAllowed = entry.textUse === 'used'
  return (
    <section className="space-y-3" data-testid="base-knowledge-licence">
      <SectionLabel as="h3">{t('detail.licenceSection')}</SectionLabel>
      <p className="text-muted-foreground text-sm">{t('detail.licenceWhy')}</p>
      {entry.status === 'proposed' ? (
        <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={attest.licence}
              disabled={!canManage}
              onCheckedChange={(on) => setAttest({ ...attest, licence: on === true })}
            />
            {t('detail.attest')}
          </label>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={attest.ai}
              disabled={!canManage}
              onCheckedChange={(on) => setAttest({ ...attest, ai: on === true })}
            />
            <span>
              {t('detail.attestAi')}
              <span className="text-muted-foreground block text-xs">
                {t('detail.attestAiHint')}
              </span>
            </span>
          </label>
        </div>
      ) : (
        <>
          <p className="text-sm">{aiAllowed ? t('text.usedHint') : t('text.metadataOnlyHint')}</p>
          {canManage && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  setBaseKnowledgeLicence(entry.id, { aiProcessingAttested: !aiAllowed })
                )
              }
            >
              {aiAllowed ? t('detail.withdrawAi') : t('detail.allowAi')}
            </Button>
          )}
        </>
      )}
    </section>
  )
}

const CHECKS: {
  result: KnowledgeCheckResult
  label: 'detail.checkCurrent' | 'detail.checkNewer' | 'detail.checkWithdrawn'
}[] = [
  { result: 'current', label: 'detail.checkCurrent' },
  { result: 'newer_known', label: 'detail.checkNewer' },
  { result: 'withdrawn', label: 'detail.checkWithdrawn' },
]

function CheckSection({
  entry,
  canManage,
  busy,
  run,
}: {
  entry: BaseKnowledgeEntry
  canManage: boolean
  busy: boolean
  run: Run
}): JSX.Element {
  const t = useTranslations(baseKnowledgeCopy)
  const { locale } = useLocale()
  const file = useRef<HTMLInputElement>(null)
  const { lastCheck, intervalDays } = entry.freshness
  return (
    <section className="space-y-3" data-testid="base-knowledge-check">
      <SectionLabel as="h3">{t('detail.checkSection')}</SectionLabel>
      <p className="text-muted-foreground text-sm">
        {t('detail.checkWhy', { days: intervalDays })}
      </p>
      <p className="text-sm">
        {lastCheck
          ? t('detail.lastCheck', {
              date: day(lastCheck.checkedAt, locale),
              result: t(`detail.checkResult.${lastCheck.result}`),
            })
          : t('detail.neverChecked')}
      </p>
      {canManage && (
        <>
          <div className="flex flex-wrap gap-2">
            {CHECKS.map(({ result, label }) => (
              <Button
                key={result}
                size="sm"
                variant={result === 'current' ? 'default' : 'outline'}
                disabled={busy}
                onClick={() => void run(() => recordBaseKnowledgeCheck(entry.id, { result }))}
              >
                {t(label)}
              </Button>
            ))}
          </div>
          <div className="space-y-1">
            <input
              ref={file}
              type="file"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(event) => {
                const chosen = event.target.files?.[0]
                event.target.value = ''
                if (chosen)
                  void run(
                    async () => (await addBaseKnowledgeEdition(entry.id, chosen), null),
                    t('detail.newEditionDone')
                  )
              }}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => file.current?.click()}
            >
              <Upload className="size-4" aria-hidden />
              {t('detail.newEdition')}
            </Button>
            <p className="text-muted-foreground text-xs">{t('detail.newEditionHint')}</p>
          </div>
        </>
      )}
    </section>
  )
}

function SheetBody({
  entry,
  canManage,
  rootId,
  folders,
  territories,
  onChanged,
}: Omit<EntryPageProps, 'entry' | 'onClose'> & { entry: BaseKnowledgeEntry }): JSX.Element {
  const t = useTranslations(baseKnowledgeCopy)
  const [values, setValues] = useState<EntryValues>(entry.values)
  const [attest, setAttest] = useState({ licence: false, ai: false })
  const [removing, setRemoving] = useState(false)
  const { busy, run } = useRun(onChanged)
  const proposed = entry.status === 'proposed'
  const needsAttest = proposed && values.licenceClass === 'licensed' && !attest.licence
  const save = () =>
    proposed
      ? run(() =>
          confirmBaseKnowledge(entry.id, {
            ...values,
            licenceAttested: attest.licence,
            aiProcessingAttested: attest.ai,
          })
        )
      : run(() => {
          const { licenceClass: _licence, ...descriptive } = values
          return updateBaseKnowledge(entry.id, descriptive)
        })
  return (
    <div className="flex flex-col gap-6 pb-8">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip entry={entry} />
        <TextUseChip entry={entry} />
      </div>
      {proposed && (
        <p className="text-sm" data-testid="base-knowledge-proposal-hint">
          {t('detail.proposalHint')}
        </p>
      )}
      <FolderField
        entry={entry}
        canManage={canManage}
        rootId={rootId}
        folders={folders}
        busy={busy}
        run={run}
      />
      <section className="space-y-3">
        <SectionLabel as="h3">{t('detail.values')}</SectionLabel>
        <EntryForm
          values={values}
          onChange={setValues}
          disabled={!canManage || busy}
          showLicence={proposed}
          territories={territories}
        />
      </section>
      {/* A proposal's licence statements are part of confirming it, so they come before the button; a confirmed copy's are their own action. */}
      {proposed && (
        <LicenceSection
          entry={entry}
          values={values}
          attest={attest}
          setAttest={setAttest}
          canManage={canManage}
          busy={busy}
          run={run}
        />
      )}
      {canManage && (
        <div className="flex justify-end">
          <Button
            disabled={busy || needsAttest}
            onClick={() => void save()}
            data-testid="base-knowledge-save"
          >
            {proposed ? t('detail.confirm') : t('detail.save')}
          </Button>
        </div>
      )}
      {!proposed && (
        <LicenceSection
          entry={entry}
          values={values}
          attest={attest}
          setAttest={setAttest}
          canManage={canManage}
          busy={busy}
          run={run}
        />
      )}
      {!proposed && <CheckSection entry={entry} canManage={canManage} busy={busy} run={run} />}
      {canManage && (
        <div className="border-t pt-4">
          <Button
            variant="ghost"
            size="sm"
            className="text-error"
            disabled={busy}
            onClick={() => setRemoving(true)}
          >
            {t('detail.remove')}
          </Button>
          <ConfirmDialog
            open={removing}
            onOpenChange={setRemoving}
            title={t('detail.removeTitle')}
            description={t('detail.removeBody')}
            confirmLabel={t('detail.remove')}
            cancelLabel={t('detail.cancel')}
            onConfirm={() => run(async () => (await removeBaseKnowledge(entry.id), null))}
          />
        </div>
      )}
    </div>
  )
}

/**
 * The standard as a page of its own, in place of the list (`?entry=<id>`): the
 * way back names where it leads, and the URL can be sent to a colleague.
 */
export function EntryPage({ entry, onBack, ...rest }: Omit<EntryPageProps, 'onClose'> & { entry: BaseKnowledgeEntry; onBack: () => void }): JSX.Element {
  const t = useTranslations(baseKnowledgeCopy)
  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-4" data-testid="base-knowledge-entry-page">
      <BackControl label={t('detail.back')} onClick={onBack} className="self-start" testId="base-knowledge-back" />
      <header className="space-y-1">
        <h2 className="text-xl font-semibold">{entry.values.designation ?? entry.values.title}</h2>
        {entry.values.designation && <p className="text-muted-foreground">{entry.values.title}</p>}
        <Provenance entry={entry} />
      </header>
      {/* Keyed by id and state, so a saved change or another entry starts a fresh form. */}
      <SheetBody key={`${entry.id}:${entry.status}:${entry.freshness.lastCheck?.checkedAt ?? ''}:${entry.textUse}`} entry={entry} {...rest} />
    </article>
  )
}
