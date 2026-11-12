'use client'

/**
 * The yes or no under an opened row: one review verdict on every claim the
 * unit holds, sent through the existing review route (`POST …/review`) in
 * calls of at most 500. Four eyes is the server's: an author of any revision
 * in the request has their verdicts refused unless the deployment runs one
 * operator alone, and that refusal reads "waits for a second person". A page
 * or text nobody fetched is shown here, and only its records carry the
 * reviewer's source check.
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
  /** Verdicts are taken here while the request is submitted. */
  open: boolean
  canReview: boolean
  /** The viewer wrote a revision anywhere in the request: the server refuses their verdicts unless one operator runs alone. */
  authored: boolean
  /** Read the request again; `advance` also opens what comes next. */
  onDone: (advance: boolean) => void
}

export function ConfirmBar({ unit, context, yes }: { unit: ReviewUnit; context: ConfirmContext; yes: string }): JSX.Element | null {
  const t = useTranslations(lawMapCopy)
  const [busy, setBusy] = useState(false)
  const [checked, setChecked] = useState(false)
  const [wrong, setWrong] = useState<string | null>(null)
  const [waits, setWaits] = useState(false)
  if (unit.review === 'accepted') return <p className="text-success text-sm">{t('review.accepted')}</p>
  if (!context.canReview || !context.open) return <p className="text-muted-foreground text-xs">{t(context.open ? 'cannotReview' : 'notSubmitted')}</p>
  if (waits) return <p className="text-muted-foreground text-sm">{t('waitsForSecond')}</p>
  const needsCheck = unit.uncheckedRevisionIds.length > 0

  const send = async (decision: 'accepted' | 'rejected', note?: string): Promise<void> => {
    setBusy(true)
    let saved = 0
    try {
      const calls = verdictCalls(unit, decision, { note, sourceChecked: checked })
      for (const call of calls) {
        const response = await fetch(`${BASE}/${context.requestId}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(call) })
        if (response.status === 409 && context.authored && saved === 0) {
          setWaits(true)
          return
        }
        if (!response.ok) {
          toast.error(t(saved > 0 ? 'partlySaved' : 'failed', { reason: await refusal(response) }))
          // A refusal may mean the request moved on (approved, rejected): read it again either way.
          context.onDone(false)
          return
        }
        saved += 1
      }
      toast.success(t(decision === 'accepted' ? 'confirmed' : 'sentBack'))
      setWrong(null)
      context.onDone(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {needsCheck ? (
        <div className="flex flex-col gap-1.5 text-sm">
          {/* The tick, and right under it what it is about and the pages to compare. */}
          <label className="flex items-start gap-2">
            <Checkbox checked={checked} onCheckedChange={(value) => setChecked(value === true)} aria-describedby={`why-${unit.key}`} />
            <span className="flex flex-col gap-0.5">
              <span>{t('sourceCheck')}</span>
              <span id={`why-${unit.key}`} className="text-muted-foreground text-xs">
                {t('sourceCheckWhy')}
              </span>
            </span>
          </label>
          <ul className="text-muted-foreground flex flex-col gap-1 pl-6 text-xs">
            {unit.uncheckedSources.map((source) => (
              <li key={`${source.url}|${source.quote ?? ''}`} className="break-words">
                {/^https?:\/\//.test(source.url) ? (
                  <a href={source.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                    {source.url}
                  </a>
                ) : (
                  source.url
                )}
                {source.quote ? <q className="ml-1">{source.quote}</q> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {wrong !== null ? (
        <div className="flex flex-col gap-2">
          <Textarea value={wrong} onChange={(event) => setWrong(event.target.value)} placeholder={t('wrongPlaceholder')} aria-label={t('wrongPlaceholder')} rows={2} />
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="secondary" disabled={busy || wrong.trim().length === 0} onClick={() => void send('rejected', wrong.trim())}>
              {t('sendBack')}
            </Button>
            <Button size="sm" variant="link" disabled={busy} onClick={() => setWrong(null)}>
              {t('cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={busy || (needsCheck && !checked)} onClick={() => void send('accepted')} data-testid={`confirm-${unit.key}`}>
            {yes}
          </Button>
          <Button size="sm" variant="link" disabled={busy} onClick={() => setWrong('')}>
            {t('somethingWrong')}
          </Button>
          {context.authored ? <span className="text-muted-foreground text-xs">{t('youWroteThis')}</span> : null}
        </div>
      )}
    </div>
  )
}
