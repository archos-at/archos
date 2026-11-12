'use client'

/**
 * "Add a document" on a country's Works and editions tab: one PDF, from the
 * publisher's URL or an upload, into the country's open draft change request
 * (or a new one), as the text of an edition of a work. One call to the BFF
 * (`platform-knowledge-document-add` / `-document-add-upload`), the same an agent makes on
 * the platform door. What the file's name tells is prefilled and stays editable.
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
import { type AddDocumentResult, type CountryWorkView, keyPart } from '@/lib/base-knowledge/platform/document-add-wire'
import { KNOWLEDGE_WORK_KINDS } from '@/lib/base-knowledge/wire/vocab'
import { usePlatformJson } from './use-platform-json'

const BASE = '/api/platform/knowledge/countries'
/** The refusals the dialog words itself; anything else shows the server's detail. */
const KNOWN_CODES = ['EDITION_EXISTS', 'HOST_NOT_ON_SOURCE', 'EGRESS_REFUSED', 'NOT_A_PDF', 'NOT_PRINTED'] as const

/** The work picker's value for a work not yet in the country. */
const NEW = '+new'
const TEXT_KEYS = ['url', 'publishedAt', 'titleText', 'title', 'designation', 'label', 'inForceFrom'] as const
type TextKey = (typeof TEXT_KEYS)[number]
const EMPTY = {
  from: 'url',
  file: null as File | null,
  workKey: '',
  kind: 'statute',
  ...(Object.fromEntries(TEXT_KEYS.map((key) => [key, ''])) as Record<TextKey, string>),
}
type Draft = typeof EMPTY

/** What a file name or URL tells before anything is read: the work it names (the longest match) and the edition's date or year. */
export function guessFromName(name: string, works: readonly CountryWorkView[]): { workKey: string | null; label: string | null; title: string } {
  const stem = decodeURIComponent(name.split(/[?#]/)[0].split('/').pop() ?? '').replace(/\.pdf$/i, '')
  const slug = keyPart(stem, 200)
  const label = /(\d{4}-\d{2}-\d{2})/.exec(stem)?.[1] ?? /(?:^|\D)((?:19|20)\d{2})(?:\D|$)/.exec(stem)?.[1] ?? null
  const named = works
    .map((work) => ({ work, part: keyPart(work.designation ?? work.title, 200) }))
    .filter(({ part }) => part.length > 0 && slug.includes(part))
    .sort((a, b) => b.part.length - a.part.length)[0]
  return { workKey: named?.work.workKey ?? null, label, title: stem.replace(/[_-]+/g, ' ').trim() }
}

/** Fill what the name tells and the person has not written yet; with no work to pick, the work is a new one. */
function prefilled(draft: Draft, name: string, works: readonly CountryWorkView[]): Draft {
  const guess = guessFromName(name, works)
  const workKey = draft.workKey || guess.workKey || (works.length === 0 ? NEW : '')
  return { ...draft, workKey, title: draft.title || (workKey === NEW ? guess.title : ''), label: draft.label || (guess.label ?? '') }
}

function requestOf(countryId: string, draft: Draft): [string, RequestInit] {
  const work = draft.workKey === NEW ? { title: draft.title, designation: draft.designation || null, kind: draft.kind } : { workKey: draft.workKey }
  if (draft.from === 'url') {
    const body = JSON.stringify({ url: draft.url, work, label: draft.label, inForceFrom: draft.inForceFrom || null })
    return [`${BASE}/${countryId}/documents`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }]
  }
  const form = new FormData()
  if (draft.file) form.set('file', draft.file)
  for (const key of ['label', 'inForceFrom', 'publishedAt', 'titleText'] as const) form.set(key, draft[key])
  form.set('work', JSON.stringify(work))
  return [`${BASE}/${countryId}/documents/upload`, { method: 'POST', body: form }]
}

/** Whether the draft says enough to send; the server checks the rest. */
function complete(draft: Draft): boolean {
  const source = draft.from === 'url' ? draft.url.trim() !== '' : draft.file !== null && draft.publishedAt.trim() !== '' && draft.titleText.trim() !== ''
  return source && draft.workKey !== '' && (draft.workKey !== NEW || draft.title.trim() !== '') && draft.label.trim() !== ''
}

function Picker(props: {
  label: string
  value: string
  options: [string, string][]
  onChange: (value: string) => void
  placeholder?: string
  why?: string
  testId?: string
}): JSX.Element {
  return (
    <Field>
      <FieldLabel>{props.label}</FieldLabel>
      <Select value={props.value} onValueChange={props.onChange}>
        <SelectTrigger className="w-full" aria-label={props.label} data-testid={props.testId}>
          <SelectValue placeholder={props.placeholder} />
        </SelectTrigger>
        <SelectContent>
          {props.options.map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {props.why ? <FieldDescription>{props.why}</FieldDescription> : null}
    </Field>
  )
}

export function AddDocumentDialog(props: {
  countryId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdded: () => void
  onReview: (changeRequestId: string) => void
}): JSX.Element {
  const { countryId, open, onAdded, onReview } = props
  const t = useTranslations(platformCopy)
  const works = usePlatformJson<{ works: CountryWorkView[] }>(open ? `${BASE}/${countryId}/works` : null)
  const known = works.load.state === 'ready' ? works.load.value.works : []
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<AddDocumentResult | null>(null)
  const set = (patch: Partial<Draft>): void => setDraft((current) => ({ ...current, ...patch }))
  const a = (key: string): string => t(`countryPages.addDocument.${key}`)

  /** One labelled text field; the URL's prefills what its name tells when the person leaves it. */
  const field = (key: TextKey, type = 'text', why?: string): JSX.Element => {
    const control = { id: `add-document-${key}`, value: draft[key], onChange: (event: { target: { value: string } }) => set({ [key]: event.target.value }) }
    const leave = key === 'url' ? () => (draft.url ? setDraft((current) => prefilled(current, current.url, known)) : null) : undefined
    return (
      <Field>
        <FieldLabel htmlFor={control.id}>{a(key === 'title' ? 'workTitle' : key)}</FieldLabel>
        {key === 'titleText' ? (
          <Textarea rows={3} {...control} />
        ) : (
          <Input type={type} placeholder={type === 'url' ? 'https://' : undefined} onBlur={leave} {...control} />
        )}
        {why ? <FieldDescription>{a(why)}</FieldDescription> : null}
      </Field>
    )
  }

  const close = (next: boolean): void => {
    props.onOpenChange(next)
    if (next) return
    setDraft(EMPTY)
    setDone(null)
    setError(null)
  }

  const pickFile = (file: File | null): void => {
    const pdf = !file || file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    setError(pdf ? null : a('errors.NOT_A_PDF'))
    if (pdf) setDraft((current) => (file ? prefilled({ ...current, file }, file.name, known) : { ...current, file: null }))
  }

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const response = await fetch(...requestOf(countryId, draft)).catch(() => null)
    setBusy(false)
    if (response?.ok) return void (setDone((await response.json()) as AddDocumentResult), onAdded())
    const problem = ((await response?.json().catch(() => null)) ?? {}) as { code?: string; detail?: string }
    const code = KNOWN_CODES.find((one) => one === problem.code)
    setError(code ? a(`errors.${code}`) : (problem.detail ?? a('errors.failed')))
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        fullScreenOnMobile
        className="max-h-[85dvh] overflow-y-auto sm:max-w-xl"
        data-testid="add-document-dialog"
        closeLabel={t('countryKnowledge.close')}
      >
        <DialogHeader className="text-left">
          <DialogTitle>{a('title')}</DialogTitle>
          <DialogDescription>{a('description')}</DialogDescription>
        </DialogHeader>
        {done ? (
          <div className="flex flex-col gap-4" data-testid="add-document-done">
            <p className="text-sm">
              {t(done.opened ? 'countryPages.addDocument.doneOpened' : 'countryPages.addDocument.doneAdded', { title: done.changeRequestTitle })}
            </p>
            <DialogFooter>
              <Button variant="secondary" onClick={() => close(false)}>
                {t('countryKnowledge.close')}
              </Button>
              <Button onClick={() => (close(false), onReview(done.changeRequestId))}>{a('reviewNow')}</Button>
            </DialogFooter>
          </div>
        ) : (
          <FieldGroup>
            <Field>
              <FieldLabel>{a('from')}</FieldLabel>
              <ToggleGroup type="single" size="sm" segmented value={draft.from} onValueChange={(from) => (from ? set({ from }) : null)}>
                <ToggleGroupItem value="url">{a('fromUrl')}</ToggleGroupItem>
                <ToggleGroupItem value="upload">{a('fromUpload')}</ToggleGroupItem>
              </ToggleGroup>
            </Field>
            {draft.from === 'url' ? (
              field('url', 'url', 'urlWhy')
            ) : (
              <>
                <Field>
                  <FieldLabel htmlFor="add-document-file">{a('file')}</FieldLabel>
                  <Input id="add-document-file" type="file" accept="application/pdf,.pdf" onChange={(event) => pickFile(event.target.files?.[0] ?? null)} />
                </Field>
                {field('publishedAt', 'url')}
                {field('titleText', 'text', 'titleTextWhy')}
              </>
            )}
            <Picker
              label={a('work')}
              value={draft.workKey}
              placeholder={a('pickWork')}
              testId="add-document-work"
              options={[
                ...known.map((work): [string, string] => [work.workKey, work.designation ? `${work.designation} – ${work.title}` : work.title]),
                [NEW, a('newWork')],
              ]}
              onChange={(workKey) => set({ workKey })}
            />
            {draft.workKey === NEW ? (
              <>
                {field('title')}
                {field('designation')}
                <Picker
                  label={a('kind')}
                  why={a('kindWhy')}
                  value={draft.kind}
                  options={KNOWLEDGE_WORK_KINDS.map((kind) => [kind, a(`kinds.${kind}`)])}
                  onChange={(kind) => set({ kind })}
                />
              </>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              {field('label')}
              {field('inForceFrom', 'date')}
            </div>
            {error ? <FieldError data-testid="add-document-error">{error}</FieldError> : null}
            <DialogFooter>
              <BusyButton
                busy={busy}
                busyLabel={a('adding')}
                icon={<FilePlus2 className="size-3.5" aria-hidden />}
                disabled={!complete(draft)}
                onClick={() => void submit()}
                data-testid="add-document-submit"
              >
                {a('confirm')}
              </BusyButton>
            </DialogFooter>
          </FieldGroup>
        )}
      </DialogContent>
    </Dialog>
  )
}
