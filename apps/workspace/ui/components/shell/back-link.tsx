'use client'

import type { JSX } from 'react'
import { useEffect, useState, type MouseEvent } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslations } from '@/i18n'
import { collaborationCopy } from '@/i18n/namespaces/collaboration'
import { commonCopy } from '@/i18n/namespaces/common'
import { navCopy } from '@/i18n/namespaces/nav'
import { describeAppPath } from '@/lib/navigation/describe-path'
import { backReaches, previousVisit, readTrail, type TrailEntry } from '@/lib/navigation/return-trail'

export interface BackLinkProps {
  fallbackHref: string
  fallbackLabel: string
  className?: string
}

export function BackLink({ fallbackHref, fallbackLabel, className }: BackLinkProps): JSX.Element {
  const pathname = usePathname()
  const router = useRouter()
  const tNav = useTranslations(navCopy)
  const tCollaboration = useTranslations(collaborationCopy)
  const tCommon = useTranslations(commonCopy)

  const [previous, setPrevious] = useState<TrailEntry | null>(null)
  useEffect(() => {
    setPrevious(pathname ? previousVisit(readTrail(), pathname) : null)
  }, [pathname])

  const described = previous ? describeAppPath(previous.path) : null
  const label = !previous
    ? fallbackLabel
    : previous.label
      ? // The page named itself while the reader was on it — a project name, not
        tNav('backTo', { label: previous.label })
      : described
        ? tNav('backTo', {
            label:
              described.namespace === 'collaboration'
                ? tCollaboration(described.key)
                : tNav(described.key),
          })
        : // A real page we cannot name (a route with no nav entry): go back to
          tCommon('actions.back')

  const handleClick = (event: MouseEvent<HTMLAnchorElement | HTMLButtonElement>): void => {
    if (!previous) return
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return
    }
    if (typeof window !== 'undefined' && window.history.length <= 1) return
    if (!pathname || !backReaches(readTrail(), pathname, previous.path)) return
    event.preventDefault()
    router.back()
  }

  return (
    <BackControl
      href={previous?.path ?? fallbackHref}
      label={label}
      onClick={handleClick}
      className={className}
      testId="back-link"
    />
  )
}

export function BackControl({
  href,
  label,
  onClick,
  className,
  testId,
}: {
  href?: string
  label: string
  onClick?: (event: MouseEvent<HTMLAnchorElement | HTMLButtonElement>) => void
  className?: string
  testId?: string
}): JSX.Element {
  const shell = cn(
    'text-muted-foreground hover:bg-hover hover:text-foreground group inline-flex w-fit items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3.5 text-sm pointer-coarse:py-2.5 pointer-coarse:pl-2.5 pointer-coarse:pr-4',
    'transition-[color,background-color,scale] [transition-duration:var(--motion-quick),var(--motion-quick),var(--motion-snap)] ease-out active:scale-[0.98] motion-reduce:transition-none',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    className
  )

  const body = (
    <>
      <span
        aria-hidden
        className="bg-card border-border/80 flex size-6 shrink-0 items-center justify-center rounded-full border"
      >
        <ArrowLeft className="size-3.5" />
      </span>
      {label}
    </>
  )

  if (href === undefined) {
    return (
      <button type="button" onClick={onClick} data-testid={testId} className={shell}>
        {body}
      </button>
    )
  }

  return (
    <Link href={href} onClick={onClick} data-testid={testId} className={shell}>
      {body}
    </Link>
  )
}
