'use client'

/**
 * The yes or no under an opened row: one review verdict on every claim the
 * unit holds, sent through the existing review route (`POST …/review`) in
 * calls of at most 500. Four eyes is the server's: an author's verdict is
 * refused unless the deployment runs one operator alone, and the refusal is
 * shown as "waits for a second person". A page nobody fetched needs the
 * reviewer's own check first.
 */

import type { JSX } from 'react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { useTranslations } from '@/i18n'
import { lawMapCopy } from '@/i18n/namespaces/law-map'
import { verdictCalls, type ReviewUnit } from '@/lib/base-knowledge/platform/law-map-review'

const BASE = '/api/platform/knowledge/change-requests'

async function refusal(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null
  return body?.error ?? String(response.status)
}

export interface ConfirmContext {
  requestId: string
  /** Verdicts are taken while the request is submitted. */
  open: boolean
  canReview: boolean
  me: string | null
  /** Read the request again, then open what comes next. */
  onDone: () => void
}

export function ConfirmBar({ unit, context, yes }: { unit: ReviewUnit; context: ConfirmContext; yes: string }): JSX.Element | null {
  const t = useTranslations(lawMapCopy)
  const [busy, setBusy] = useState(false)
  const [checked, setChecked] = useState(false)
  const [wrong, setWrong] = useState<string | null>(null)
  const [waits, setWaits] = useState(false)
  if (unit.review === 'accepted') return <p className="text-success text-sm">{t('review.accepted')}</p>
  if (!context.canReview || !context.open) return <p className="text-muted-foreground text-xs">{t(context.open ? 'cannotReview' : 'notSubmitted')}</p>

  const send = async (decision: 'accepted' | 'rejected', note?: string): Promise<void> => {
    setBusy(true)
    try {
      for (const call of verdictCalls(unit, decision, { note, sourceChecked: decision === 'accepted' && unit.needsSourceCheck })) {
        const response = await fetch(`${BASE}/${context.requestId}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(call) })
        if (response.status === 409 && context.me && unit.authors.includes(context.me)) return setWaits(true)
        if (!response.ok) {
          toast.error(t('failed', { reason: await refusal(response) }))
          return
        }
      }
      toast.success(t(decision === 'accepted' ? 'confirmed' : 'sentBack'))
      setWrong(null)
      context.onDone()
    } finally {
      setBusy(false)
    }
  }

  if (waits) return <p className="text-muted-foreground text-sm">{t('waitsForSecond')}</p>
  const mine = Boolean(context.me && unit.authors.includes(context.me))
  return (
    <div className="flex flex-col gap-3">
      {unit.needsSourceCheck ? (
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={checked} onCheckedChange={(value) => setChecked(value === true)} aria-label={t('sourceCheck')} />
          <span>{t('sourceCheck')}</span>
        </label>
      ) : null}
      {wrong !== null ? (
        <div className="flex flex-col gap-2">
          <Textarea value={wrong} onChange={(event) => setWrong(event.target.value)} placeholder={t('wrongPlaceholder')} aria-label={t('wrongPlaceholder')} rows={2} />
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="outline" disabled={busy || wrong.trim().length === 0} onClick={() => void send('rejected', wrong.trim())}>
              {t('sendBack')}
            </Button>
            <button type="button" className="text-muted-foreground text-sm underline underline-offset-2" onClick={() => setWrong(null)}>
              {t('cancel')}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={busy || (unit.needsSourceCheck && !checked)} onClick={() => void send('accepted')} data-testid={`confirm-${unit.key}`}>
            {yes}
          </Button>
          <button type="button" className="text-muted-foreground text-sm underline underline-offset-2" onClick={() => setWrong('')} disabled={busy}>
            {t('somethingWrong')}
          </button>
          {mine ? <span className="text-muted-foreground text-xs">{t('youWroteThis')}</span> : null}
        </div>
      )}
    </div>
  )
}
