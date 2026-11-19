'use client'

import { useRef, useState, type JSX } from 'react'
import { toast } from 'sonner'
import { FileText, Upload } from 'lucide-react'
import {
  addBaseKnowledgeEdition,
  bulkBaseKnowledge,
  confirmBaseKnowledge,
  recordBaseKnowledgeCheck,
  removeBaseKnowledge,
  setBaseKnowledgeLicence,
  updateBaseKnowledge,
  type BaseKnowledgeRemovalReceipt,
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
import { ASK_FOR_LICENCE, type EntryValues } from '@/lib/base-knowledge/wire'
import { Chip } from '@/components/ui/chip'
import { CurrencyNote, day, StatusChip, TextUseChip } from './entry-atoms'
import { EntryForm, type TerritoryChoice } from './entry-form'
import { editionReplaced } from '@/lib/base-knowledge/office/listing'

interface EntryPageProps {
  entry: BaseKnowledgeEntry | null
  onClose?: () => void
  canManage: boolean
  rootId: string | null
  folders: readonly BaseKnowledgeFolder[]
  territories: readonly TerritoryChoice[]
  onChanged: (entry: BaseKnowledgeEntry | null) => void
  adding?: { position: number; count: number }
}

type Run = (action: () => Promise<BaseKnowledgeEntry | null>, done?: string | null) => Promise<void>

function leftBehind(receipt: BaseKnowledgeRemovalReceipt): ('search' | 'objects' | 'caches')[] {
  const { search, objects, caches } = receipt.stores
  return [
    ...(search === 'failed' ? (['search'] as const) : []),
    ...(objects !== 'removed' ? (['objects'] as const) : []),
    ...(caches !== 'removed' ? (['caches'] as const) : []),
  ]
}

function useRun(onChanged: EntryPageProps['onChanged']): { busy: boolean; run: Run } {
  const t = useTranslations(baseKnowledgeCopy)
  const [busy, setBusy] = useState(false)
  const run: Run = async (action, done) => {
    setBusy(true)
    try {
      onChanged(await action())
      if (done !== null) toast.success(done ?? t('saved'))
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
  if (values.licenceClass !== 'licensed') {
    return ASK_FOR_LICENCE && entry.status === 'confirmed' && canManage ? <BoughtAfterAll entry={entry} busy={busy} run={run} /> : null
  }
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
              variant="secondary"
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
          {canManage && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void run(() => setBaseKnowledgeLicence(entry.id, { licenceClass: 'public_open' }))}
            >
              {t('detail.markPublic')}
            </Button>
          )}
        </>
      )}
    </section>
  )
}

function BoughtAfterAll({ entry, busy, run }: { entry: BaseKnowledgeEntry; busy: boolean; run: Run }): JSX.Element {
  const t = useTranslations(baseKnowledgeCopy)
  const [open, setOpen] = useState(false)
  const [attest, setAttest] = useState({ licence: false, ai: false })
  if (!open) {
    return (
      <section className="space-y-2" data-testid="base-knowledge-licence">
        <SectionLabel as="h3">{t('detail.licenceSection')}</SectionLabel>
        <p className="text-muted-foreground text-sm">{t('detail.publicNow')}</p>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => setOpen(true)}>
          {t('detail.markLicensed')}
        </Button>
      </section>
    )
  }
  return (
    <section className="space-y-3" data-testid="base-knowledge-licence">
      <SectionLabel as="h3">{t('detail.licenceSection')}</SectionLabel>
      <p className="text-muted-foreground text-sm">{t('detail.licenceWhy')}</p>
      <label className="flex items-start gap-2 text-sm">
        <Checkbox checked={attest.licence} onCheckedChange={(on) => setAttest({ ...attest, licence: on === true })} />
        {t('detail.attest')}
      </label>
      <label className="flex items-start gap-2 text-sm">
        <Checkbox checked={attest.ai} onCheckedChange={(on) => setAttest({ ...attest, ai: on === true })} />
        <span>
          {t('detail.attestAi')}
          <span className="text-muted-foreground block text-xs">{t('detail.attestAiHint')}</span>
        </span>
      </label>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={busy || !attest.licence}
          onClick={() =>
            void run(() =>
              setBaseKnowledgeLicence(entry.id, { licenceClass: 'licensed', licenceAttested: true, aiProcessingAttested: attest.ai }),
            )
          }
        >
          {t('detail.saveLicensed')}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
          {t('detail.cancel')}
        </Button>
      </div>
    </section>
  )
}

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
      {entry.directory ? (
        <p className="text-sm">
          <CurrencyNote entry={entry} />
        </p>
      ) : (
        <>
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
        </>
      )}
      {canManage && (
        <>
          {!entry.directory && (
            <div className="flex flex-wrap gap-2">
              {/* One answer is the common one; a newer edition is answered by uploading it, which records the check itself. */}
              <Button size="sm" disabled={busy} onClick={() => void run(() => recordBaseKnowledgeCheck(entry.id, { result: 'current' }))}>
                {t('detail.checkCurrent')}
              </Button>
            </div>
          )}
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
                    () => addBaseKnowledgeEdition(entry.id, chosen),
                    t('detail.newEditionDone')
                  )
              }}
            />
            <Button
              size="sm"
              variant="secondary"
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
  adding,
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
          showLicence={proposed && ASK_FOR_LICENCE}
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
            {!proposed ? t('detail.save') : adding && adding.position < adding.count ? t('adding.confirmNext') : t('detail.confirm')}
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
            onConfirm={() =>
              run(async () => {
                const receipt = await removeBaseKnowledge(entry.id)
                const left = leftBehind(receipt)
                if (left.length === 0) toast.success(t('detail.removed'))
                else toast.warning(t('detail.removeIncomplete', { stores: left.map((store) => t(`detail.store.${store}`)).join(', ') }))
                return null
              }, null)
            }
          />
        </div>
      )}
    </div>
  )
}

function Editions({ entry, onOpen }: { entry: BaseKnowledgeEntry; onOpen: (entryId: string) => void }): JSX.Element | null {
  const t = useTranslations(baseKnowledgeCopy)
  const { locale } = useLocale()
  if (entry.editions.length < 2) return null
  return (
    <section className="space-y-2" data-testid="base-knowledge-editions">
      <SectionLabel as="h3">{t('detail.editions')}</SectionLabel>
      <p className="text-sm text-muted-foreground">{t('detail.editionsWhy')}</p>
      <ul className="divide-y rounded-surface border">
        {entry.editions.map((edition) => (
          <li key={edition.id} className="flex items-center justify-between gap-3 px-3 py-2">
            <button
              type="button"
              className="min-w-0 truncate text-left text-sm font-medium hover:underline disabled:no-underline"
              disabled={edition.id === entry.id}
              onClick={() => onOpen(edition.id)}
            >
              {t('detail.editionLine', { label: edition.editionLabel })}
              {edition.startsOn && <span className="font-normal text-muted-foreground"> · {t('detail.startsOn', { date: day(edition.startsOn, locale) })}</span>}
            </button>
            <Chip size="sm" variant={edition.status === 'proposed' ? 'info' : edition.inForceToday ? 'success' : 'muted'}>
              {edition.status === 'proposed'
                ? t('status.proposed')
                : edition.inForceToday
                  ? t('detail.inForceToday')
                  : editionReplaced(entry.editions, edition.id)
                    ? t('status.superseded')
                    : t('detail.notInForce')}
            </Chip>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function EntryPage({
  entry,
  onBack,
  onOpenEdition,
  onOpenFile,
  ...rest
}: Omit<EntryPageProps, 'onClose'> & {
  entry: BaseKnowledgeEntry
  onBack: () => void
  onOpenEdition: (entryId: string) => void
  onOpenFile?: () => void
}): JSX.Element {
  const t = useTranslations(baseKnowledgeCopy)
  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-4" data-testid="base-knowledge-entry-page">
      <BackControl label={t('detail.back')} onClick={onBack} className="self-start" testId="base-knowledge-back" />
      {rest.adding && rest.adding.count > 1 && (
        <p className="text-muted-foreground text-sm" data-testid="base-knowledge-adding">
          {t('adding.step', rest.adding)}
        </p>
      )}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="text-xl font-semibold">{entry.values.designation ?? entry.values.title}</h2>
          {entry.values.designation && <p className="text-muted-foreground">{entry.values.title}</p>}
          <Provenance entry={entry} />
        </div>
        {onOpenFile && (
          <Button variant="secondary" size="sm" onClick={onOpenFile} data-testid="base-knowledge-open-file">
            <FileText aria-hidden />
            {t('detail.openFile')}
          </Button>
        )}
      </header>
      <Editions entry={entry} onOpen={onOpenEdition} />
      {/* Keyed by id and state, so a saved change or another entry starts a fresh form. */}
      <SheetBody key={`${entry.id}:${entry.status}:${entry.freshness.lastCheck?.checkedAt ?? ''}:${entry.textUse}:${entry.values.licenceClass}`} entry={entry} {...rest} />
    </article>
  )
}
