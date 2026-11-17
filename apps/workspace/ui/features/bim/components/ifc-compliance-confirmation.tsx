'use client'

import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import { UserCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { useLocale, useTranslations } from '@/i18n'
import { bimCopy } from '@/i18n/namespaces/bim'
import { hasOpenWork } from '@/lib/bim/rules'
import type { BimRuleResultWithConfirmation } from '@/lib/bim/rules'

export function Confirmation({
  rule,
  onConfirm,
  onWithdraw,
}: {
  rule: BimRuleResultWithConfirmation
  onConfirm?: (ruleId: string, note: string) => Promise<void>
  onWithdraw?: (ruleId: string) => Promise<void>
}): JSX.Element | null {
  const t = useTranslations(bimCopy)
  const { locale } = useLocale()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const noteRef = useRef<HTMLTextAreaElement>(null)
  const openerRef = useRef<HTMLButtonElement>(null)
  const interacted = useRef(false)

  useEffect(() => {
    if (!interacted.current) return
    if (open) noteRef.current?.focus()
    else openerRef.current?.focus()
  }, [open])

  const [denied, setDenied] = useState(false)
  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false)

  const needsHuman = hasOpenWork(rule)
  if (!needsHuman && !rule.confirmation) return null

  const submit = async (): Promise<void> => {
    if (!onConfirm) return
    setBusy(true)
    setFailed(false)
    try {
      await onConfirm(rule.ruleId, note.trim())
      interacted.current = true
      setOpen(false)
      setNote('')
    } catch (error) {
      if (error instanceof Error && error.message === '403') setDenied(true)
      else setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  const withdraw = async (): Promise<void> => {
    if (!onWithdraw) return
    setBusy(true)
    setFailed(false)
    try {
      await onWithdraw(rule.ruleId)
      interacted.current = true
      setConfirmingWithdraw(false)
    } catch (error) {
      if (error instanceof Error && error.message === '403') setDenied(true)
      else setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 space-y-1 border-t pt-2">
      {rule.confirmation && (
        <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
          <span className="inline-flex items-center gap-1 font-medium text-success">
            <UserCheck className="size-3.5" aria-hidden="true" />
            {t('compliance.confirmed.by', {
              who: rule.confirmation.confirmedBy,
              when: new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
                new Date(rule.confirmation.confirmedAt)
              ),
            })}
          </span>
          {rule.confirmationStale && (
            <Badge variant="warning">{t('compliance.confirmed.stale')}</Badge>
          )}
          {rule.confirmation.note && (
            <span className="text-muted-foreground">„{rule.confirmation.note}“</span>
          )}
        </p>
      )}

      {rule.confirmationStale && (
        <p className="text-xs text-muted-foreground">{t('compliance.confirmed.staleHint')}</p>
      )}

      {onConfirm && !open && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            data-testid="bim-confirm-open"
            ref={openerRef}
            onClick={() => {
              interacted.current = true
              setOpen(true)
            }}
          >
            {rule.confirmation
              ? t('compliance.confirmed.reconfirm')
              : t('compliance.confirmed.confirm')}
          </Button>
          {rule.confirmation &&
            onWithdraw &&
            (confirmingWithdraw ? (
              <>
                <span className="text-muted-foreground text-xs">
                  {t('compliance.confirmed.withdrawConfirm')}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={() => void withdraw()}
                  disabled={busy}
                >
                  {busy ? <Spinner className="size-3" /> : null}
                  {t('compliance.confirmed.withdraw')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmingWithdraw(false)}
                  disabled={busy}
                >
                  {t('compliance.confirmed.cancel')}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setConfirmingWithdraw(true)}
                disabled={busy}
              >
                {t('compliance.confirmed.withdraw')}
              </Button>
            ))}
        </div>
      )}

      {onConfirm && open && (
        <div className="space-y-2">
          <Textarea
            ref={noteRef}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            placeholder={t('compliance.confirmed.notePlaceholder')}
            aria-label={t('compliance.confirmed.noteLabel')}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              data-testid="bim-confirm-save"
              onClick={() => void submit()}
              disabled={busy}
            >
              {busy ? <Spinner className="size-3" /> : null}
              {t('compliance.confirmed.save')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                interacted.current = true
                setOpen(false)
              }}
            >
              {t('compliance.confirmed.cancel')}
            </Button>
          </div>
        </div>
      )}

      {failed && (
        <p role="alert" data-testid="bim-confirmation-failed" className="text-xs text-destructive">
          {t('compliance.confirmed.failed')}
        </p>
      )}
      {/* A refusal, not a failure: no retry, because there is nothing to
          retry. Stated once and the form stays open with the note in it, so
          nothing the reader typed is lost. */}
      {denied && (
        <p role="alert" className="text-warning text-xs">
          {t('compliance.confirmed.denied')}
        </p>
      )}
    </div>
  )
}
