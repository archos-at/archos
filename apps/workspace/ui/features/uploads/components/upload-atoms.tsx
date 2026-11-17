'use client'

import type { JSX } from 'react'
import {
  Archive,
  CircleCheck,
  CircleX,
  Clock3,
  Equal,
  FilePen,
  Folder,
  Lock,
  MonitorOff,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react'

import { Chip, ChipCount } from '@/components/ui/chip'
import { CountPill } from '@/components/ui/count-pill'
import { StatCardIcon } from '@/components/ui/stat-card'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { uploadBatchesCopy } from '@/i18n/namespaces/upload-batches'
import { surfaceStateLabel } from '@/lib/documents/surface-state'
import type { CountKey } from '../lib/upload-summary'

type Tone = 'success' | 'info' | 'warning' | 'destructive' | 'muted'

const TALLY_LOOK: Record<CountKey, { icon: LucideIcon; tone: Tone }> = {
  ready: { icon: CircleCheck, tone: 'success' },
  reading: { icon: Clock3, tone: 'info' },
  quarantined: { icon: ShieldAlert, tone: 'warning' },
  failed: { icon: CircleX, tone: 'destructive' },
  stored: { icon: Archive, tone: 'muted' },
  unchanged: { icon: Equal, tone: 'muted' },
  excluded: { icon: MonitorOff, tone: 'muted' },
  changed: { icon: FilePen, tone: 'info' },
  protected: { icon: Lock, tone: 'muted' },
}

export function useTallyLabel(): (key: CountKey) => string {
  const tFiles = useTranslations(filesCopy)
  const t = useTranslations(uploadBatchesCopy)
  return (key) => {
    switch (key) {
      case 'ready':
        return surfaceStateLabel('citable', tFiles)
      case 'reading':
        return surfaceStateLabel('reading', tFiles)
      case 'quarantined':
        return surfaceStateLabel('held', tFiles)
      case 'failed':
        return surfaceStateLabel('unreadable', tFiles)
      case 'stored':
        return surfaceStateLabel('stored', tFiles)
      case 'unchanged':
        return t('summary.counts.unchanged')
      case 'excluded':
        return t('summary.counts.excluded')
      case 'changed':
        return t('summary.counts.changed')
      case 'protected':
        return t('summary.counts.protected')
    }
  }
}

export function TallyTile({ tally, count, label }: { tally: CountKey; count: number; label: string }): JSX.Element {
  const look = TALLY_LOOK[tally]
  return (
    <li
      className="bg-card flex min-w-0 items-center gap-2.5 rounded-md border px-3 py-2"
      data-testid={`upload-tally-${tally}`}
    >
      <StatCardIcon icon={look.icon} tone={look.tone} size="sm" />
      <div className="min-w-0">
        <p className="text-foreground text-lg leading-tight font-medium tabular-nums">{count}</p>
        <p className="text-muted-foreground text-xs leading-tight hyphens-auto">{label}</p>
      </div>
    </li>
  )
}

export function TallyPill({ tally, count, label }: { tally: CountKey; count: number; label: string }): JSX.Element {
  const look = TALLY_LOOK[tally]
  const Icon = look.icon
  return (
    <Chip variant={look.tone} size="sm" data-testid={`upload-pill-${tally}`}>
      <Icon aria-hidden />
      {label}
      <ChipCount count={count} />
    </Chip>
  )
}

export function FacetChip({ facet, label, hint }: { facet: 'changed' | 'protected'; label: string; hint: string }): JSX.Element {
  const look = TALLY_LOOK[facet]
  const Icon = look.icon
  return (
    <Chip variant={look.tone} size="sm" title={hint} data-testid={`upload-facet-${facet}`}>
      <Icon aria-hidden />
      {label}
      <span className="sr-only">: {hint}</span>
    </Chip>
  )
}

export function NamedCount({ name, count }: { name: string; count: number }): JSX.Element {
  return (
    <Chip variant="muted" className="max-w-full">
      <span className="truncate">{name}</span>
      <ChipCount count={count} />
    </Chip>
  )
}

export function FolderHeading({ label, count }: { label: string; count: number }): JSX.Element {
  return (
    <h4 className="text-foreground flex min-w-0 items-center gap-1.5 text-xs font-medium">
      <Folder className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 truncate" title={label}>
        {label}
      </span>
      <CountPill count={count} />
    </h4>
  )
}
