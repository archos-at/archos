'use client'

/**
 * "Add a document" on a country's Works and editions tab: one PDF, from the
 * publisher's URL or an upload, into the country's open draft change request
 * (or a new one), as the text of an edition of a work. One call to the BFF
 * (`platform-knowledge-document-add` / `-document-add-upload`), the same an agent makes on
 * the platform door. What the platform can tell from the name is prefilled and
 * stays editable; a refusal says what to do.
 */

import type { JSX } from 'react'
import { useState } from 'react'
import { FilePlus2 } from 'lucide-react'
import { BusyButton } from '@/components/ui/busy-button'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import { type AddDocumentResult, type CountryWorkView, guessFromName } from '@/lib/base-knowledge/platform/document-add-wire'
import { KNOWLEDGE_WORK_KINDS, type KnowledgeWorkKind } from '@/lib/base-knowledge/wire/vocab'
import { usePlatformJson } from './use-platform-json'

const BASE = '/api/platform/knowledge/countries'
/** The refusals the dialog words itself; anything else shows the server's detail. */
const KNOWN_CODES = ['EDITION_EXISTS', 'HOST_NOT_ON_SOURCE', 'EGRESS_REFUSED', 'NOT_A_PDF', 'NOT_PRINTED'] as const

type From = 'url' | 'upload'
type WorkChoice = 'existing' | 'new'

export interface AddDocumentDraft {
  from: From
  url: string
  file: File | null
  publishedAt: string
  titleText: string
  choice: WorkChoice
  workKey: string
  title: string
  designation: string
  kind: KnowledgeWorkKind
  label: string
  inForceFrom: string
}

const EMPTY: AddDocumentDraft = {
  from: 'url',
  url: '',
  file: null,
  publishedAt: '',
  titleText: '',
  choice: 'existing',
  workKey: '',
  title: '',
  designation: '',
  kind: 'statute',
  label: '',
  inForceFrom: '',
}

/** Fill what the name tells and the person has not written yet. */
function prefilled(draft: AddDocumentDraft, name: string, works: readonly CountryWorkView[]): AddDocumentDraft {
  const guess = guessFromName(name, works)
  return {
    ...draft,
    workKey: draft.workKey || (guess.workKey ?? ''),
    choice: guess.workKey || works.length > 0 ? draft.choice : 'new',
    title: draft.title || (guess.workKey ? '' : guess.title),
    label: draft.label || (guess.label ?? ''),
  }
}

function requestOf(countryId: string, draft: AddDocumentDraft): { url: string; init: RequestInit } {
  const work = draft.choice === 'existing' ? { workKey: draft.workKey } : { title: draft.title, designation: draft.designation || null, kind: draft.kind }
  if (draft.from === 'url') {
    const body = { url: draft.url, work, label: draft.label, inForceFrom: draft.inForceFrom || null }
    return { url: `${BASE}/${countryId}/documents`, init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } }
  }
  const form = new FormData()
  if (draft.file) form.set('file', draft.file)
  form.set('work', JSON.stringify(work))
  form.set('label', draft.label)
  form.set('inForceFrom', draft.inForceFrom)
  form.set('publishedAt', draft.publishedAt)
  form.set('titleText', draft.titleText)
  return { url: `${BASE}/${countryId}/documents/upload`, init: { method: 'POST', body: form } }
}

/** Whether the draft says enough to send; the server checks the rest. */
function complete(draft: AddDocumentDraft): boolean {
  const source = draft.from === 'url' ? draft.url.trim() !== '' : draft.file !== null && draft.publishedAt.trim() !== '' && draft.titleText.trim() !== ''
  const work = draft.choice === 'existing' ? draft.workKey !== '' : draft.title.trim() !== ''
  return source && work && draft.label.trim() !== ''
}

export function AddDocumentDialog({
  countryId,
  open,
  onOpenChange,
  onAdded,
  onReview,
  initial = EMPTY,
}: {
  countryId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdded: () => void
  onReview: (changeRequestId: string) => void
  initial?: AddDocumentDraft
}): JSX.Element {
  const t = useTranslations(platformCopy)
  const works = usePlatformJson<{ works: CountryWorkView[] }>(open ? `${BASE}/${countryId}/works` : null)
  const known = works.load.state === 'ready' ? works.load.value.works : []
  const [draft, setDraft] = useState<AddDocumentDraft>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<AddDocumentResult | null>(null)
  const set = (patch: Partial<AddDocumentDraft>): void => setDraft((current) => ({ ...current, ...patch }))

  const close = (next: boolean): void => {
    onOpenChange(next)
    if (!next) {
      setDraft(initial)
      setDone(null)
      setError(null)
    }
  }

  const pickFile = (file: File | null): void => {
    if (file && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError(t('countryPages.addDocument.errors.NOT_A_PDF'))
      return
    }
    setError(null)
    setDraft((current) => (file ? prefilled({ ...current, file }, file.name, known) : { ...current, file: null }))
  }

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const { url, init } = requestOf(countryId, draft)
    const response = await fetch(url, init).catch(() => null)
    setBusy(false)
    if (response?.ok) {
      setDone((await response.json()) as AddDocumentResult)
      onAdded()
      return
    }
    const problem = ((await response?.json().catch(() => null)) ?? {}) as { code?: string; detail?: string; message?: string }
    const code = KNOWN_CODES.find((one) => one === problem.code)
    setError(code ? t(`countryPages.addDocument.errors.${code}`) : (problem.detail ?? problem.message ?? t('countryPages.addDocument.errors.failed')))
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent fullScreenOnMobile className="max-h-[85dvh] overflow-y-auto sm:max-w-xl" data-testid="add-document-dialog" closeLabel={t('countryKnowledge.close')}>
        <DialogHeader className="text-left">
          <DialogTitle>{t('countryPages.addDocument.title')}</DialogTitle>
          <DialogDescription>{t('countryPages.addDocument.description')}</DialogDescription>
        </DialogHeader>
        {done ? (
          <div className="flex flex-col gap-4" data-testid="add-document-done">
            <p className="text-sm">
              {t(done.opened ? 'countryPages.addDocument.doneOpened' : 'countryPages.addDocument.doneAdded', { title: done.changeRequestTitle })}
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => close(false)}>
                {t('countryKnowledge.close')}
              </Button>
              <Button onClick={() => (close(false), onReview(done.changeRequestId))}>{t('countryPages.addDocument.reviewNow')}</Button>
            </DialogFooter>
          </div>
        ) : (
          <FieldGroup>
            <Field>
              <FieldLabel>{t('countryPages.addDocument.from')}</FieldLabel>
              <ToggleGroup type="single" size="sm" segmented value={draft.from} onValueChange={(value) => (value === 'url' || value === 'upload' ? set({ from: value }) : null)}>
                <ToggleGroupItem value="url">{t('countryPages.addDocument.fromUrl')}</ToggleGroupItem>
                <ToggleGroupItem value="upload">{t('countryPages.addDocument.fromUpload')}</ToggleGroupItem>
              </ToggleGroup>
            </Field>
            {draft.from === 'url' ? (
              <Field>
                <FieldLabel htmlFor="add-document-url">{t('countryPages.addDocument.url')}</FieldLabel>
                <Input
                  id="add-document-url"
                  type="url"
                  value={draft.url}
                  placeholder="https://"
                  onChange={(event) => set({ url: event.target.value })}
                  onBlur={() => (draft.url ? setDraft((current) => prefilled(current, current.url, known)) : null)}
                />
                <FieldDescription>{t('countryPages.addDocument.urlWhy')}</FieldDescription>
              </Field>
            ) : (
              <>
                <Field>
                  <FieldLabel htmlFor="add-document-file">{t('countryPages.addDocument.file')}</FieldLabel>
                  <Input id="add-document-file" type="file" accept="application/pdf,.pdf" onChange={(event) => pickFile(event.target.files?.[0] ?? null)} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="add-document-published">{t('countryPages.addDocument.publishedAt')}</FieldLabel>
                  <Input id="add-document-published" type="url" value={draft.publishedAt} onChange={(event) => set({ publishedAt: event.target.value })} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="add-document-title-text">{t('countryPages.addDocument.titleText')}</FieldLabel>
                  <Textarea id="add-document-title-text" rows={3} value={draft.titleText} onChange={(event) => set({ titleText: event.target.value })} />
                  <FieldDescription>{t('countryPages.addDocument.titleTextWhy')}</FieldDescription>
                </Field>
              </>
            )}
            <Field>
              <FieldLabel>{t('countryPages.addDocument.work')}</FieldLabel>
              <ToggleGroup type="single" size="sm" segmented value={draft.choice} onValueChange={(value) => (value === 'existing' || value === 'new' ? set({ choice: value }) : null)}>
                <ToggleGroupItem value="existing" disabled={known.length === 0}>
                  {t('countryPages.addDocument.existingWork')}
                </ToggleGroupItem>
                <ToggleGroupItem value="new">{t('countryPages.addDocument.newWork')}</ToggleGroupItem>
              </ToggleGroup>
            </Field>
            {draft.choice === 'existing' && known.length > 0 ? (
              <Select value={draft.workKey} onValueChange={(workKey) => set({ workKey })}>
                <SelectTrigger className="w-full" aria-label={t('countryPages.addDocument.work')} data-testid="add-document-work">
                  <SelectValue placeholder={t('countryPages.addDocument.pickWork')} />
                </SelectTrigger>
                <SelectContent>
                  {known.map((work) => (
                    <SelectItem key={work.workKey} value={work.workKey}>
                      {work.designation ? `${work.designation} – ${work.title}` : work.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <>
                <Field>
                  <FieldLabel htmlFor="add-document-work-title">{t('countryPages.addDocument.workTitle')}</FieldLabel>
                  <Input id="add-document-work-title" value={draft.title} onChange={(event) => set({ title: event.target.value })} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="add-document-designation">{t('countryPages.addDocument.designation')}</FieldLabel>
                  <Input id="add-document-designation" value={draft.designation} onChange={(event) => set({ designation: event.target.value })} />
                </Field>
                <Field>
                  <FieldLabel>{t('countryPages.addDocument.kind')}</FieldLabel>
                  <Select value={draft.kind} onValueChange={(kind) => set({ kind: kind as KnowledgeWorkKind })}>
                    <SelectTrigger className="w-full" aria-label={t('countryPages.addDocument.kind')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {KNOWLEDGE_WORK_KINDS.map((kind) => (
                        <SelectItem key={kind} value={kind}>
                          {t(`countryPages.addDocument.kinds.${kind}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldDescription>{t('countryPages.addDocument.kindWhy')}</FieldDescription>
                </Field>
              </>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="add-document-label">{t('countryPages.addDocument.label')}</FieldLabel>
                <Input id="add-document-label" value={draft.label} onChange={(event) => set({ label: event.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="add-document-from-date">{t('countryPages.addDocument.inForceFrom')}</FieldLabel>
                <Input id="add-document-from-date" type="date" value={draft.inForceFrom} onChange={(event) => set({ inForceFrom: event.target.value })} />
              </Field>
            </div>
            {error ? <FieldError data-testid="add-document-error">{error}</FieldError> : null}
            <DialogFooter>
              <BusyButton
                busy={busy}
                busyLabel={t('countryPages.addDocument.adding')}
                icon={<FilePlus2 className="size-3.5" aria-hidden />}
                disabled={!complete(draft)}
                onClick={() => void submit()}
                data-testid="add-document-submit"
              >
                {t('countryPages.addDocument.confirm')}
              </BusyButton>
            </DialogFooter>
          </FieldGroup>
        )}
      </DialogContent>
    </Dialog>
  )
}
