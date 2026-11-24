'use client'

import { type FC, type ReactNode } from 'react'
import { ListPlus } from 'lucide-react'
import { Chip } from '@/components/ui/chip'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { cn } from '@/lib/utils'
import { ENERGY_CLASSES } from '@/lib/text/answer-directives'

export const MarkChip: FC<{ tone?: 'success' | 'muted'; children: ReactNode }> = ({ tone = 'success', children }) => (
  <span
    data-testid="answer-mark"
    className={cn(
      'card-meta ml-1.5 inline-flex h-5 items-center rounded-full px-2 align-[1px]',
      tone === 'success' ? 'bg-success-subtle text-success' : 'bg-muted text-muted-foreground'
    )}
  >
    {children}
  </span>
)

export const EnergyClassChip: FC<{ rating: string }> = ({ rating }) => {
  const t = useTranslations(commonCopy)
  const band = (ENERGY_CLASSES as readonly string[]).indexOf(rating) + 1
  if (band <= 0) return <>{rating}</>
  return (
    <abbr
      title={t('markdown.energyClass', { rating })}
      data-testid="energy-class"
      data-class={rating}
      className="mx-0.5 inline-flex h-5 min-w-7 items-center justify-center rounded-full px-1.5 align-[1px] text-[12px] font-semibold no-underline"
      style={{
        backgroundColor: `var(--energy-band-${band})`,
        color: band === ENERGY_CLASSES.length ? 'var(--energy-band-paper)' : 'var(--energy-band-ink)',
      }}
    >
      {rating}
    </abbr>
  )
}

export const cellChipClass = '-my-0.5 align-[1px]'

export const PrefillButton: FC<{ label: string; title: string; onClick: () => void; ariaLabel?: string }> = ({
  label,
  title,
  onClick,
  ariaLabel,
}) => (
  <button
    type="button"
    data-testid="prefill-button"
    title={title}
    aria-label={ariaLabel}
    onClick={onClick}
    className={cn(
      'inline-flex h-6 shrink-0 items-center gap-1 rounded-control bg-card px-2 text-[11px] font-medium text-muted-foreground shadow-xs',
      'transition-colors duration-quick ease-out motion-reduce:transition-none hover:bg-accent hover:text-foreground',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 pointer-coarse:h-11 pointer-coarse:px-3 print:hidden'
    )}
  >
    <ListPlus aria-hidden="true" className="size-3 shrink-0" />
    <span className="whitespace-nowrap">{label}</span>
  </button>
)

export const RoleChip: FC<{ children: ReactNode }> = ({ children }) => (
  <Chip size="sm" variant="secondary" className={cellChipClass}>
    {children}
  </Chip>
)
