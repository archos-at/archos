'use client'

import type { JSX, ReactNode } from 'react'
import Link from 'next/link'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLocale, useTranslations } from '@/i18n'
import { lawMapCopy } from '@/i18n/namespaces/law-map'

export function OutlineRow({
  name,
  meta,
  value,
  exceptions,
  coming,
  attention = false,
  confirmed = false,
  expanded,
  onClick,
  muted = false,
  size = 'md',
  testId,
}: {
  name: ReactNode
  meta?: ReactNode
  value?: ReactNode
  exceptions?: ReactNode
  coming?: ReactNode
  attention?: boolean
  confirmed?: boolean
  expanded?: boolean
  onClick?: () => void
  muted?: boolean
  size?: 'lg' | 'md' | 'sm'
  testId?: string
}): JSX.Element {
  const t = useTranslations(lawMapCopy)
  const body = (
    <>
      <span className="flex min-w-0 items-baseline gap-2.5">
        <span className={cn('min-w-0 break-words', size === 'lg' ? 'text-2xl font-semibold' : size === 'md' ? 'font-medium' : '', muted && 'text-muted-foreground font-normal')}>{name}</span>
        {meta ? <span className="text-muted-foreground truncate text-xs max-sm:hidden">{meta}</span> : null}
      </span>
      <span className="flex items-baseline justify-end gap-2.5 whitespace-nowrap">
        {exceptions ? <span className="text-muted-foreground text-xs max-sm:hidden">{exceptions}</span> : null}
        {value ? <span className={cn('tabular-nums', muted ? 'text-muted-foreground' : 'font-semibold')}>{value}</span> : null}
        {coming ? <span className="text-warning text-xs font-medium">{coming}</span> : null}
        {confirmed ? <Check className="text-success size-3.5 self-center" aria-hidden /> : null}
        {attention ? <span className="bg-warning size-2 self-center rounded-full" aria-hidden /> : null}
        {/* The marks are drawn for the eye; a screen reader hears the same state in words. */}
        {confirmed || attention ? <span className="sr-only">{t(attention ? 'rowWaits' : 'rowConfirmed')}</span> : null}
      </span>
    </>
  )
  const className = cn('grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4 border-b py-3 text-left', size === 'sm' && 'py-2.5', size === 'lg' && 'border-b-0 pb-1.5')
  return onClick ? (
    <button type="button" onClick={onClick} aria-expanded={expanded} className={cn(className, 'hover:bg-hover')} data-testid={testId}>
      {body}
    </button>
  ) : (
    <div className={className} data-testid={testId}>
      {body}
    </div>
  )
}

export function Branch({ children }: { children: ReactNode }): JSX.Element {
  return <div className="ml-5 border-l pl-4 max-sm:ml-2 max-sm:pl-3">{children}</div>
}

export function Unfold({ children }: { children: ReactNode }): JSX.Element {
  return <div className="bg-muted my-2 flex flex-col gap-3 rounded-lg px-5 py-4 text-sm">{children}</div>
}

export function SourceQuote({ url, quote, note }: { url: string; quote: string | null; note: string | null }): JSX.Element {
  let host = url
  try {
    host = new URL(url).hostname
  } catch {
    // keep the address as given
  }
  return (
    <div className="text-muted-foreground border-l-2 border-current/40 py-0.5 pl-3">
      {quote ? <q className="text-foreground block">{quote}</q> : null}
      <a href={url} target="_blank" rel="noreferrer" className="text-xs underline underline-offset-2">
        {host}
      </a>
      {note ? <span className="text-xs"> · {note}</span> : null}
    </div>
  )
}

export function AddLine({ label, onClick, testId }: { label: string; onClick: () => void; testId?: string }): JSX.Element {
  return (
    <button type="button" onClick={onClick} className="text-muted-foreground hover:text-foreground w-full border-b py-2.5 text-left text-sm" data-testid={testId}>
      + {label}
    </button>
  )
}

export function QuietLinks({ links }: { links: { href: string; label: string }[] }): JSX.Element | null {
  if (links.length === 0) return null
  return (
    <p className="text-muted-foreground flex flex-wrap gap-x-4 text-sm">
      {links.map((link) => (
        <Link key={link.href} href={link.href} className="underline underline-offset-2">
          {link.label}
        </Link>
      ))}
    </p>
  )
}

export function useDate(): (iso: string | null) => string {
  const { locale } = useLocale()
  return (iso) => (iso ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`)) : '–')
}
