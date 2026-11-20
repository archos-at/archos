'use client'

import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { UserRound } from 'lucide-react'
import { BusyButton } from '@/components/ui/busy-button'
import { useLocale, useTranslations } from '@/i18n'
import { formatCalendarDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { MailThreadFollowView, MailThreadView } from '@/lib/mail-thread/mail-thread-wire'
import type { MailThreadClient } from './client'
import { FollowSwitch } from './follow-switch'
import { mayEndFollow, mayWrite, otherFollows, viewerFollow } from './mail-thread-model'
import { refusalKey } from './refusal'
import { mailThreadCopy } from '@/i18n/namespaces/mail-thread'

export interface FollowControlProps {
  projectId: string
  view: MailThreadView
  viewerUserId: string | null
  client: MailThreadClient
  onChanged: () => void
  className?: string
}

type Pending = 'follow' | 'renew' | 'unfollow' | `end:${string}` | null

export function FollowControl({ projectId, view, viewerUserId, client, onChanged, className }: FollowControlProps): JSX.Element | null {
  const t = useTranslations(mailThreadCopy)
  const { locale } = useLocale()
  const [pending, setPending] = useState<Pending>(null)
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map())
  const own = viewerFollow(view, viewerUserId)
  const others = otherFollows(view, viewerUserId)
  const manages = view.managesFollows && others.length > 0

  useEffect(() => {
    if (!manages) return
    let alive = true
    client
      .people(projectId)
      .then((people) => {
        if (alive) setNames(new Map(people.map((person) => [person.userId, person.name])))
      })
      .catch(() => {
        // Without names the rows say „Ein Projektmitglied“; „Beenden“ still works.
      })
    return () => {
      alive = false
    }
  }, [client, manages, projectId])

  const date = (iso: string) => formatCalendarDate(iso, locale)
  const fail = (error: unknown) => toast.error(t(`refusals.${refusalKey(error)}`))

  const run = async (which: Exclude<Pending, null>, action: () => Promise<void>): Promise<void> => {
    setPending(which)
    try {
      await action()
      onChanged()
    } catch (error) {
      fail(error)
    } finally {
      setPending(null)
    }
  }

  const follow = () =>
    run('follow', async () => {
      const result = await client.follow(projectId, view.id)
      toast.success(t('follow.followed', { name: view.name, date: date(result.follow.expiresAt) }), {
        action: {
          label: t('follow.undo'),
          onClick: () => void client.unfollow(projectId, view.id).then(onChanged, fail),
        },
      })
    })
  const renew = () =>
    run('renew', async () => {
      const result = await client.follow(projectId, view.id)
      toast.success(t('follow.renewed', { date: date(result.follow.expiresAt) }))
    })
  const unfollow = () =>
    run('unfollow', async () => {
      await client.unfollow(projectId, view.id)
      toast.success(t('follow.unfollowed', { name: view.name }))
    })
  const end = (follow: MailThreadFollowView, name: string) =>
    run(`end:${follow.userId}`, async () => {
      await client.unfollow(projectId, view.id, { userId: follow.userId })
      toast.success(t('follow.ended', { name }))
    })

  const canFollow = own.kind === 'none' && mayWrite(view)
  if (own.kind === 'none' && !canFollow && others.length === 0) return null
  const switchable = canFollow || own.kind === 'following'

  return (
    <section
      className={cn('bg-card rounded-surface flex flex-col gap-2.5 border p-3', className)}
      data-testid="mail-thread-follow"
      data-following={own.kind === 'following' || undefined}
    >
      {switchable && (
        <FollowSwitch
          on={own.kind === 'following'}
          until={own.kind === 'following' && own.follow ? date(own.follow.expiresAt) : null}
          disabled={pending !== null}
          onChange={(on) => void (on ? follow() : unfollow())}
          testId="mail-thread-follow-switch"
        >
          {own.kind === 'following' && own.renewable && (
            <BusyButton
              type="button"
              size="sm"
              variant="secondary"
              className="mt-1 self-start"
              busy={pending === 'renew'}
              busyLabel={t('follow.renew')}
              onClick={() => void renew()}
              data-testid="mail-thread-follow-renew"
            >
              {t('follow.renew')}
            </BusyButton>
          )}
        </FollowSwitch>
      )}

      {others.length > 0 && !view.managesFollows && (
        <p className="text-muted-foreground text-xs" data-testid="mail-thread-follow-others">
          {switchable ? t('follow.others', { count: others.length }) : t('follow.othersOnly', { count: others.length })}
        </p>
      )}

      {manages && (
        <div className={cn('flex flex-col gap-1', switchable && 'border-t pt-2.5')} data-testid="mail-thread-followers">
          <p className="text-muted-foreground text-xs font-medium">{t('follow.followers')}</p>
          <ul className="flex flex-col">
            {others.map((follow) => {
              const name = names.get(follow.userId) ?? t('follow.someone')
              return (
                <li key={follow.id} className="flex min-w-0 items-center gap-2 py-1 pointer-coarse:min-h-11" data-testid="mail-thread-follower">
                  <UserRound className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 text-xs">
                    <span className="font-medium [overflow-wrap:anywhere]">{name}</span>{' '}
                    <span className="text-muted-foreground tabular-nums">{t('follow.follower', { date: date(follow.expiresAt) })}</span>
                  </span>
                  {mayEndFollow(view, follow, viewerUserId) && (
                    <BusyButton
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="shrink-0"
                      busy={pending === `end:${follow.userId}`}
                      busyLabel={t('follow.end')}
                      aria-label={t('follow.endLabel', { name })}
                      onClick={() => void end(follow, name)}
                      data-testid="mail-thread-follower-end"
                    >
                      {t('follow.end')}
                    </BusyButton>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </section>
  )
}
