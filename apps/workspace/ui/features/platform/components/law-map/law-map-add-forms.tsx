'use client'

/**
 * "+ Add" in the outline, unfolding in place (country-onboarding-ux.md, B):
 * an act for a region, and an edition with its text for a series. Both write
 * into the country's draft through routes the door already serves; an act is
 * checked by a dry run first, and what the kit refuses is shown as it says it.
 */

import type { JSX, ReactNode } from 'react'
import { useState } from 'react'
import { toast } from 'sonner'
import { BusyButton } from '@/components/ui/busy-button'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useTranslations } from '@/i18n'
import { lawMapCopy } from '@/i18n/namespaces/law-map'
import type { LawMap } from '@/lib/base-knowledge/platform/law-map'
import { addActRecords } from '@/lib/base-knowledge/platform/law-map-add'
import type { SourceStatusView } from '@/lib/base-knowledge/platform/source-service'
import { Unfold } from './law-map-atoms'
import { addDocument, capture, draftFor, propose, Refused, sourceFor } from './law-map-add-client'

const NEW = '__new__'

function Picker({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (value: string) => void }): JSX.Element {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([key, text]) => (
            <SelectItem key={key} value={key}>
              {text}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

function Text({ label, value, onChange, type = 'text', hint, area = false }: { label: string; value: string; onChange: (value: string) => void; type?: string; hint?: string; area?: boolean }): JSX.Element {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      {area ? <Textarea value={value} onChange={(event) => onChange(event.target.value)} rows={3} aria-label={label} /> : <Input type={type} value={value} onChange={(event) => onChange(event.target.value)} aria-label={label} />}
      {hint ? <FieldDescription>{hint}</FieldDescription> : null}
    </Field>
  )
}

function FormShell({ title, children, problems, onCancel, busy, submit, onSubmit, disabled }: { title: string; children: ReactNode; problems: string[]; onCancel: () => void; busy: boolean; submit: string; onSubmit: () => void; disabled: boolean }): JSX.Element {
  const t = useTranslations(lawMapCopy)
  return (
    <Unfold>
      <p className="text-base font-medium">{title}</p>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
      {problems.length > 0 ? (
        <FieldError>
          {problems.map((problem) => (
            <span key={problem} className="block">
              {problem}
            </span>
          ))}
        </FieldError>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <BusyButton size="sm" busy={busy} busyLabel={t('adding')} disabled={disabled} onClick={onSubmit}>
          {submit}
        </BusyButton>
        <Button size="sm" variant="link" disabled={busy} onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    </Unfold>
  )
}

/** "+ Add an act to <region>": the act, the gazette page and its adopting clause, the day and the editions. */
export function AddActForm({ map, territoryId, countryId, sources, onAdded, onCancel }: { map: LawMap; territoryId: string; countryId: string; sources: readonly SourceStatusView[]; onAdded: (requestId: string) => void; onCancel: () => void }): JSX.Element {
  const t = useTranslations(lawMapCopy)
  const region = map.territories.get(territoryId)?.name ?? territoryId
  const acts = [...new Map(map.statements.filter((statement) => statement.territoryId === territoryId).map((statement) => [statement.actWorkId, statement.actTitle])).entries()]
  const labels = [...new Set([...map.editions.values()].map((edition) => edition.label))]
  // The edition most series have, the usual one an act adopts, comes first.
  const usual = [...labels].sort((x, y) => [...map.editions.values()].filter((e) => e.label === y).length - [...map.editions.values()].filter((e) => e.label === x).length)[0] ?? ''
  const [act, setAct] = useState(acts[0]?.[0] ?? NEW)
  const [title, setTitle] = useState('')
  const [designation, setDesignation] = useState('')
  const [url, setUrl] = useState('')
  const [pasted, setPasted] = useState('')
  const [quote, setQuote] = useState('')
  const [provision, setProvision] = useState('')
  const [from, setFrom] = useState('')
  const [label, setLabel] = useState(usual)
  const [exceptTopic, setExceptTopic] = useState('')
  const [exceptLabel, setExceptLabel] = useState(labels[0] ?? '')
  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState<string[]>([])
  const sourceId = url ? sourceFor(url, sources) : null

  const editions = map.topics.flatMap((topic) => {
    const wanted = topic.workId === exceptTopic ? exceptLabel : label
    const edition = [...map.editions.values()].find((one) => one.workId === topic.workId && one.label === wanted)
    return edition ? [{ workId: topic.workId, editionId: edition.id }] : []
  })
  const ready = Boolean(url && quote.trim().length >= 15 && from && editions.length > 0 && (act !== NEW || title.trim()) && (sourceId || pasted.trim()))

  const submit = async (): Promise<void> => {
    setBusy(true)
    setProblems([])
    try {
      const requestId = await draftFor(countryId, t('draftTitle', { region }))
      const page = await capture(requestId, { url, sourceId, text: pasted })
      const actKey = act === NEW ? null : act.replace(/^work:/, '')
      const records = addActRecords({ territoryId, act: actKey ? { workKey: actKey } : { title: title.trim(), designation: designation.trim() || null }, provision: provision.trim() || null, captureId: page.captureId, quote: quote.trim(), validFrom: from, editions })
      const check = await propose(requestId, records, true)
      if (!check.valid) {
        setProblems(check.results.flatMap((result) => result.problems.map((problem) => `${problem.detail} ${problem.hint}`)))
        return
      }
      await propose(requestId, records, false)
      toast.success(t('added'))
      onAdded(requestId)
    } catch (error) {
      setProblems([error instanceof Refused ? error.message : String(error)])
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormShell title={t('addActTo', { region })} problems={problems} onCancel={onCancel} busy={busy} submit={t('add')} onSubmit={() => void submit()} disabled={!ready}>
      <Picker label={t('field.act')} value={act} onChange={setAct} options={[...acts, [NEW, t('field.newAct')]]} />
      {act === NEW ? (
        <>
          <Text label={t('field.title')} value={title} onChange={setTitle} />
          <Text label={t('field.designation')} value={designation} onChange={setDesignation} />
        </>
      ) : (
        <div />
      )}
      <Text label={t('field.url')} value={url} onChange={setUrl} type="url" hint={url ? (sourceId ? t('field.fetched', { source: sourceId }) : t('field.notFetched')) : t('field.urlHint')} />
      {url && !sourceId ? <Text label={t('field.pasted')} value={pasted} onChange={setPasted} area /> : <div />}
      <Text label={t('field.quote')} value={quote} onChange={setQuote} area hint={t('field.quoteHint')} />
      <Text label={t('field.provision')} value={provision} onChange={setProvision} hint={t('field.provisionHint')} />
      <Text label={t('field.from')} value={from} onChange={setFrom} type="date" />
      <Picker label={t('field.edition')} value={label} onChange={setLabel} options={labels.map((one) => [one, one])} />
      <Picker label={t('field.except')} value={exceptTopic || NEW} onChange={(value) => setExceptTopic(value === NEW ? '' : value)} options={[[NEW, t('field.none')], ...map.topics.map((topic): [string, string] => [topic.workId, topic.designation])]} />
      {exceptTopic ? <Picker label={t('field.exceptEdition')} value={exceptLabel} onChange={setExceptLabel} options={labels.map((one) => [one, one])} /> : <div />}
    </FormShell>
  )
}

/** "+ Add an edition": its label, the day it applies from, and its text from the publisher, fetched or uploaded. */
export function AddEditionForm({ workId, designation, countryId, onAdded, onCancel }: { workId: string; designation: string; countryId: string; onAdded: (requestId: string) => void; onCancel: () => void }): JSX.Element {
  const t = useTranslations(lawMapCopy)
  const [label, setLabel] = useState('')
  const [from, setFrom] = useState('')
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [titleText, setTitleText] = useState('')
  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState<string[]>([])
  const ready = Boolean(label.trim() && url && (!file || titleText.trim().length >= 15))

  const submit = async (): Promise<void> => {
    setBusy(true)
    setProblems([])
    try {
      const done = await addDocument(countryId, { workKey: workId.replace(/^work:/, ''), label: label.trim(), inForceFrom: from || null, url, file, titleText: titleText.trim() })
      toast.success(t('added'))
      onAdded(done.changeRequestId)
    } catch (error) {
      setProblems([error instanceof Refused ? error.message : String(error)])
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormShell title={t('addEditionOf', { designation })} problems={problems} onCancel={onCancel} busy={busy} submit={t('add')} onSubmit={() => void submit()} disabled={!ready}>
      <Text label={t('field.editionLabel')} value={label} onChange={setLabel} hint={t('field.editionLabelHint')} />
      <Text label={t('field.appliesFrom')} value={from} onChange={setFrom} type="date" />
      <Text label={t('field.pdfUrl')} value={url} onChange={setUrl} type="url" hint={t('field.pdfUrlHint')} />
      <Field>
        <FieldLabel>{t('field.upload')}</FieldLabel>
        <Input type="file" accept="application/pdf" aria-label={t('field.upload')} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        <FieldDescription>{t('field.uploadHint')}</FieldDescription>
      </Field>
      {file ? <Text label={t('field.titleText')} value={titleText} onChange={setTitleText} area hint={t('field.titleTextHint')} /> : null}
    </FormShell>
  )
}
