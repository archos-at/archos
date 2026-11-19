'use client'

import type { JSX } from 'react'
import { useEffect, useId, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Alert, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useUnsavedEditGuard } from '@/components/ui/unsaved-edit-confirm'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTranslations } from '@/i18n'
import type {
  MailThreadEntryDetachBody,
  MailThreadEntryDetachResultView,
  MailThreadEntryView,
  MailThreadSummaryView,
  MailThreadView,
} from '@/lib/mail-thread/mail-thread-wire'
import type { MailThreadClient } from './client'
import { detachKeeps } from './mail-thread-model'
import { refusalKey, type MailThreadRefusalKey } from './refusal'
import { mailThreadCopy } from '@/i18n/namespaces/mail-thread'

const NEW_THREAD_NAME_MAX = 240

type Targets = { kind: 'loading' } | { kind: 'ready'; threads: MailThreadSummaryView[] } | { kind: 'failed' }

export interface DetachDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  thread: MailThreadView
  entry: MailThreadEntryView
  currentVersion: number | null
  folderId: string | null
  client: MailThreadClient
  onDetached: (result: MailThreadEntryDetachResultView, targetName: string | null) => void
}

export function DetachDialog({ open, onOpenChange, projectId, thread, entry, currentVersion, folderId, client, onDetached }: DetachDialogProps): JSX.Element {
  const t = useTranslations(mailThreadCopy)
  const id = useId()
  const [targets, setTargets] = useState<Targets>({ kind: 'loading' })
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [threadId, setThreadId] = useState<string>('')
  const [name, setName] = useState('')
  const [refusal, setRefusal] = useState<MailThreadRefusalKey | null>(null)
  const [pending, setPending] = useState(false)
  const landed = useRef(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => void (alive.current = false)
  }, [])

  useEffect(() => {
    if (!open) return
    let current = true
    landed.current = false
    setRefusal(null)
    setName('')
    setThreadId('')
    setTargets({ kind: 'loading' })
    client
      .list(projectId)
      .then((page) => {
        if (!current) return
        const threads = page.items.filter((candidate) => candidate.id !== thread.id)
        setTargets({ kind: 'ready', threads })
        setMode(threads.length > 0 ? 'existing' : 'new')
      })
      .catch(() => {
        if (!current) return
        setTargets({ kind: 'failed' })
        setMode('new')
      })
    return () => {
      current = false
    }
  }, [client, open, projectId, thread.id])

  const keeps = detachKeeps(entry, currentVersion)
  const threads = targets.kind === 'ready' ? targets.threads : []
  const noOther = targets.kind !== 'loading' && threads.length === 0
  const trimmed = name.trim()
  const ready = mode === 'existing' ? threadId !== '' : trimmed !== ''
  const guard = useUnsavedEditGuard({ dirty: mode === 'new' && trimmed !== '', onOpenChange })

  const confirm = async (): Promise<void> => {
    const body: MailThreadEntryDetachBody =
      mode === 'existing'
        ? { target: { action: 'append', mailThreadId: threadId } }
        : { target: { action: 'create', name: trimmed, ...(folderId ? { folderId } : {}) } }
    setRefusal(null)
    try {
      const result = await client.detach(projectId, thread.id, entry.id, body)
      landed.current = true
      onDetached(result, mode === 'existing' ? (threads.find((candidate) => candidate.id === threadId)?.name ?? null) : trimmed)
    } catch (error) {
      setRefusal(refusalKey(error))
      throw error
    }
  }

  const submit = async (): Promise<void> => {
    if (!ready || pending) return
    setPending(true)
    try {
      await confirm()
      if (alive.current) onOpenChange(false)
    } catch {
      // The refusal is said in the dialog, which stays open.
    } finally {
      if (alive.current) setPending(false)
    }
  }

  return (
    <>
      {/* A form, so the kit's form dialog: the title and what happens, the choice, then „Abbrechen“ as the raised press
          beside the primary, as in every dialog that asks for input. The confirm dialog's bare „Abbrechen“ and its
          red primary, near unreadable while disabled, were the shape of a destructive question, and this is none. */}
      <Dialog open={open} onOpenChange={(next) => (pending ? undefined : landed.current ? onOpenChange(next) : guard.onOpenChange(next))}>
        <DialogContent
          className="sm:max-w-lg"
          closeLabel={t('detach.cancel')}
          aria-busy={pending || undefined}
          onOpenAutoFocus={(event) => {
            // Onto the dialog itself, never onto a radio: a focus ring round the unchosen one read as a second ring.
            event.preventDefault()
            ;(event.currentTarget as HTMLElement | null)?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-base leading-snug [overflow-wrap:anywhere]">
              {t('detach.title')}
            </DialogTitle>
            <DialogDescription>{t('detach.description', { heading: entry.heading })}</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4 text-sm"
            data-testid="mail-thread-detach"
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
          >
            <div className="text-muted-foreground flex flex-col gap-1.5">
              {keeps && (
                <p className="text-foreground" data-testid="mail-thread-detach-keeps">
                  {keeps.first === keeps.last
                    ? t('detach.keepsOne', { first: keeps.first, next: keeps.next })
                    : t('detach.keeps', { first: keeps.first, last: keeps.last, next: keeps.next })}
                </p>
              )}
              {thread.follows.length > 0 && <p>{t('detach.followsEnd')}</p>}
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">{t('detach.target')}</legend>
              <RadioGroup value={mode} onValueChange={(value) => setMode(value === 'new' ? 'new' : 'existing')} className="gap-1">
                <div className="flex min-h-8 items-center gap-2 pointer-coarse:min-h-11">
                  <RadioGroupItem id={`${id}-existing`} value="existing" disabled={noOther} className="peer" />
                  <Label htmlFor={`${id}-existing`} className="flex-1 cursor-pointer self-stretch font-normal peer-disabled:cursor-not-allowed peer-disabled:opacity-60">
                    {t('detach.toExisting')}
                  </Label>
                </div>
                {mode === 'existing' && (
                  <div className="pb-1 pl-6">
                    {targets.kind === 'loading' ? (
                      <p className="text-muted-foreground text-xs" role="status">
                        {t('detach.loadingTargets')}
                      </p>
                    ) : (
                      <Select value={threadId} onValueChange={setThreadId}>
                        <SelectTrigger aria-label={t('detach.existing')} className="w-full pointer-coarse:text-base" data-testid="mail-thread-detach-target">
                          <SelectValue placeholder={t('detach.choose')} />
                        </SelectTrigger>
                        <SelectContent>
                          {threads.map((candidate) => (
                            <SelectItem key={candidate.id} value={candidate.id} className="[overflow-wrap:anywhere]">
                              {candidate.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                )}
                {noOther && targets.kind === 'ready' && <p className="text-muted-foreground pl-6 text-xs">{t('detach.noOther')}</p>}
                <div className="flex min-h-8 items-center gap-2 pointer-coarse:min-h-11">
                  <RadioGroupItem id={`${id}-new`} value="new" />
                  <Label htmlFor={`${id}-new`} className="flex-1 cursor-pointer self-stretch font-normal">
                    {t('detach.toNew')}
                  </Label>
                </div>
                {mode === 'new' && (
                  <Field className="pl-6">
                    <FieldLabel htmlFor={`${id}-name`}>{t('detach.name')}</FieldLabel>
                    <Input
                      id={`${id}-name`}
                      value={name}
                      maxLength={NEW_THREAD_NAME_MAX}
                      onChange={(event) => setName(event.target.value)}
                      autoComplete="off"
                      enterKeyHint="done"
                      className="pointer-coarse:text-base"
                      aria-describedby={`${id}-name-hint`}
                      data-testid="mail-thread-detach-name"
                    />
                    <p id={`${id}-name-hint`} className="text-muted-foreground text-xs">
                      {t('detach.nameHint')}
                    </p>
                  </Field>
                )}
              </RadioGroup>
            </fieldset>

            {refusal && (
              <Alert data-testid="mail-thread-detach-refusal" data-reason={refusal}>
                <AlertTriangle aria-hidden className="text-warning" />
                <AlertTitle className="line-clamp-none font-normal">{t(`refusals.${refusal}`)}</AlertTitle>
              </Alert>
            )}

            <DialogFooter>
              <Button type="button" variant="secondary" disabled={pending} onClick={() => guard.onOpenChange(false)} data-testid="mail-thread-detach-cancel">
                {t('detach.cancel')}
              </Button>
              <Button type="submit" loading={pending} disabled={!ready} data-testid="mail-thread-detach-confirm">
                {t('detach.confirm')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {guard.question}
    </>
  )
}
