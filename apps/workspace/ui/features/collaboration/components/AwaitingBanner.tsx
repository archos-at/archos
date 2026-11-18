'use client'

import type { JSX } from 'react'
import { useState } from 'react'
import { Clock, CornerUpLeft, Hand } from 'lucide-react'

import { AvatarStack, PersonAvatar } from '@/components/ui/avatar-stack'
import { AnimatePresence, motion, motionEntrance } from '@/components/motion'
import { Button } from '@/components/ui/button'
import { useLocale, useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { formatAbsoluteTime, formatRelativeTime } from '@/lib/format'
import type { AwaitingStateResponse, PendingMentionView } from '@/lib/mentions/types'
import { cn } from '@/lib/utils'
import { Quote } from '@/components/ui/quote'

export interface AwaitingBannerProps {
  awaiting: AwaitingStateResponse | null
  onRelease: (requestId: string) => Promise<boolean> | boolean
  onAskAgent?: () => void
  onAskBack?: (asker: { userId: string; name: string }) => void
  className?: string
}

export function AwaitingBanner({
  awaiting,
  onRelease,
  onAskAgent,
  onAskBack,
  className,
}: AwaitingBannerProps): JSX.Element | null {
  const t = useTranslations(collaborationCopy)
  const { locale } = useLocale()
  const [releasing, setReleasing] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  const pending = awaiting?.pending ?? []
  if (pending.length === 0) return null

  const awaitingMe = awaiting?.awaitingMe === true
  const names = pending.map((request) => request.person.name)
  const single = pending.length === 1 ? pending[0] : null
  const oldest = pending.reduce(
    (earliest, request) => (request.createdAt < earliest.createdAt ? request : earliest),
    pending[0],
  )
  const repeatedNames = new Set(
    names.filter((name, index) => names.indexOf(name) !== index),
  )

  const headline = awaitingMe
    ? t('mentions.awaiting.awaitingYou')
    : single
      ? t('mentions.awaiting.one', { name: single.person.name })
      : t('mentions.awaiting.many', { names: names.join(', ') })

  const hint = awaitingMe
    ? t('mentions.awaiting.awaitingYouHint')
    : t('mentions.awaiting.hint')

  const release = async (requests: readonly PendingMentionView[], key: string): Promise<void> => {
    setReleasing(key)
    setFailed(false)
    try {
      let ok = true
      for (const request of requests) {
        ok = (await onRelease(request.id)) !== false && ok
      }
      if (!ok) setFailed(true)
    } catch {
      setFailed(true)
    } finally {
      setReleasing(null)
    }
  }

  return (
    <section
      data-testid="awaiting-banner"
      data-awaiting-me={awaitingMe ? 'true' : 'false'}
      aria-live="polite"
      className={cn(
        'rounded-lg border px-4 py-3',
        awaitingMe ? 'border-warning bg-warning-subtle' : 'bg-card',
        className,
      )}
    >
      <div className="flex flex-wrap items-start gap-3">
        <span
          aria-hidden
          className={cn(
            'inline-flex size-8 shrink-0 items-center justify-center rounded-full border',
            awaitingMe
              ? 'border-warning bg-card text-warning'
              : 'border-border bg-muted text-muted-foreground',
          )}
        >
          {awaitingMe ? <Hand className="size-4" /> : <Clock className="size-4" />}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {/* Who is holding the thread, at a glance — the shared avatar stack, so
                a colleague looks the same here as in the participant strip and in
                their message bubbles. */}
            <AvatarStack people={pending.map((request) => request.person)} size="sm" />
            <p
              className={cn(
                'min-w-0 text-sm font-medium',
                awaitingMe ? 'text-warning' : 'text-foreground',
              )}
            >
              {headline}
            </p>
          </div>

          <p className="mt-1 text-sm text-muted-foreground">{hint}</p>

          {/* Only stated at thread level when ONE person is awaited. With several,
              "asked by X, since Y" taken from the oldest request described somebody
              else's wait — most confusingly for the reader who is themselves
              awaited by a different person. Each row below carries both facts for
              its own request instead, so nothing is lost by narrowing this. */}
          {single && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {oldest.requestedBy && (
              <span>{t('mentions.awaiting.askedBy', { name: oldest.requestedBy.name })}</span>
            )}
            {/* "seit …" takes the EXACT moment, not a relative phrase: German
                "seit vor 15 Stunden" is broken, and precision is the house
                register anyway. The relative reading rides along on hover. */}
            <time dateTime={oldest.createdAt} title={formatRelativeTime(oldest.createdAt, locale)}>
              {t('mentions.awaiting.since', {
                time: formatAbsoluteTime(oldest.createdAt, locale),
              })}
            </time>
          </div>
          )}

          {/* The question that was asked, when there is one — far more useful than
              "you were mentioned" (MN-12). */}
          {single?.note && (
            <Quote as="p" className="mt-2 text-sm leading-relaxed">
              {single.note}
            </Quote>
          )}

          {/* Several people awaited: each one gets its own release, because the
              state resolves per person (MN-10). */}
          {!single && (
            <ul className="mt-2.5 flex flex-col divide-y rounded-lg border bg-background">
              {/* Releasing one person removes their row while the others stay. A CSS
                  `animate-in` can only play on mount, so without this the released
                  row vanished between frames and the rows below snapped upward —
                  the one moment in this banner where something the user just did
                  has a visible result. `popLayout` takes the leaving row out of
                  flow so the remainder closes the gap smoothly rather than after. */}
              <AnimatePresence initial={false} mode="popLayout">
                {pending.map((request) => (
                  <motion.li
                    key={request.id}
                    layout
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: 8 }}
                    transition={motionEntrance}
                    data-testid="awaiting-person"
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-2.5 py-1.5"
                  >
                    <span className="flex min-w-0 grow basis-48 items-center gap-2">
                      <PersonAvatar person={request.person} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{request.person.name}</span>
                        {/* Both facts per row, because the thread-level line above
                            is only shown for a single request (see there) — the
                            asker AND how long this particular person has been
                            waited on. Same absolute-time reading as up there, for
                            the same reason. */}
                        <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                          {request.requestedBy && (
                            <span className="truncate">
                              {t('mentions.awaiting.askedBy', { name: request.requestedBy.name })}
                            </span>
                          )}
                          <time
                            dateTime={request.createdAt}
                            title={formatRelativeTime(request.createdAt, locale)}
                          >
                            {t('mentions.awaiting.since', {
                              time: formatAbsoluteTime(request.createdAt, locale),
                            })}
                          </time>
                        </span>
                      </span>
                    </span>
                    {/* The question, per person. It used to render only when
                        exactly one person was awaited, so the moment two people
                        were asked the thing they were asked disappeared.

                        Before the button in the DOM, `order-last` in the layout:
                        a screen reader follows source order, and reading "release
                        this person" before the question they were asked offers the
                        way out of a wait whose reason has not been said yet. */}
                    {request.note && (
                      <Quote as="p" className="order-last w-full text-sm leading-relaxed">
                        {request.note}
                      </Quote>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 shrink-0 px-2 text-xs text-muted-foreground"
                      disabled={releasing !== null}
                      aria-label={
                        repeatedNames.has(request.person.name)
                          ? t('mentions.awaiting.releaseOneSince', {
                              name: request.person.name,
                              time: formatAbsoluteTime(request.createdAt, locale),
                            })
                          : undefined
                      }
                      onClick={() => void release([request], request.id)}
                    >
                      {t('mentions.awaiting.releaseOne', { name: request.person.name })}
                    </Button>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {/* The reader's own move, so it leads. Only when THEY are the one
                being asked and there is a single asker to send it back to — with
                two askers "Rückfrage an wen?" has no honest answer, and the
                composer's own `@` is the right tool then. */}
            {awaitingMe && onAskBack && single?.requestedBy && (
              <Button
                variant="secondary"
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => onAskBack(single.requestedBy!)}
              >
                <CornerUpLeft className="size-3.5" aria-hidden />
                {t('mentions.awaiting.askBack', { name: single.requestedBy.name })}
              </Button>
            )}
            {onAskAgent && (
              <Button
                variant="secondary"
                size="sm"
                className="h-8 gap-1.5"
                onClick={onAskAgent}
              >
                {t('mentions.awaiting.askAgent')}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-muted-foreground hover:text-foreground"
              disabled={releasing !== null}
              onClick={() => void release(pending, 'all')}
            >
              {/* "Continue without Anna" only makes sense about someone ELSE. When
                  the thread is waiting on the reader, the neutral wording is the
                  honest one — they are still allowed to release it. */}
              {single && !awaitingMe
                ? t('mentions.awaiting.releaseOne', { name: single.person.name })
                : t('mentions.awaiting.release')}
            </Button>
          </div>

          {failed && (
            <p role="alert" className="mt-2 text-xs text-error">
              {t('mentions.errors.releaseFailed')}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
