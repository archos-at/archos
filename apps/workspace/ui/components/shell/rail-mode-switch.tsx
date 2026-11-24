'use client'

import type { JSX } from 'react'
import { useRouter } from 'next/navigation'
import { LockKeyhole, Users } from 'lucide-react'

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useTranslations } from '@/i18n'
import { navCopy } from '@/i18n/namespaces/nav'
import { cn } from '@/lib/utils'
import { useRailChats } from './rail-chats'
import { readRecentProjectIds } from './recent-projects'
import { PERSONAL_CHAT_PATH, type RailMode } from './rail-mode'
import { useRailSide } from './rail-side'

export function projectModeHref(recentProjectIds: readonly string[]): string {
  const last = recentProjectIds[0]
  return last ? `/app/projects/${encodeURIComponent(last)}/chat` : '/app/projects'
}

const sideHref = (side: RailMode): string => (side === 'personal' ? PERSONAL_CHAT_PATH : projectModeHref(readRecentProjectIds()))

const ICON = { personal: LockKeyhole, project: Users } as const

const ARROW_SIDE: Record<string, RailMode> = { ArrowLeft: 'personal', ArrowUp: 'personal', ArrowRight: 'project', ArrowDown: 'project' }

const THUMB = {
  personal: 'bg-primary',
  project: 'bg-sheet shadow-xs',
} as const

export function RailModeSwitch({
  mode,
  collapsed,
  navigate,
}: {
  mode: RailMode
  collapsed: boolean
  navigate?: (href: string) => void
}): JSX.Element {
  const t = useTranslations(navCopy)
  const router = useRouter()
  const pending = useRailSide((s) => s.pending)
  const begin = useRailSide((s) => s.begin)
  const railChats = useRailChats()
  const shown = pending?.mode ?? mode
  const other: RailMode = shown === 'personal' ? 'project' : 'personal'

  const go = (next: RailMode): void => {
    if (next === shown) return
    begin({ mode: next, projectId: next === 'personal' ? null : (readRecentProjectIds()[0] ?? null) })
    ;(navigate ?? router.push)(sideHref(next))
  }
  const warmOther = (): void => {
    railChats?.onWarmOtherSide?.()
    router.prefetch(sideHref(other))
  }
  const item = (value: RailMode, label: string): JSX.Element => {
    const Icon = ICON[value]
    return (
      <ToggleGroupItem
        value={value}
        aria-label={label}
        title={collapsed ? label : undefined}
        data-testid={`rail-mode-${value}`}
        className={cn(
          'relative z-10 h-8 gap-1.5 rounded-[4px] bg-transparent px-2 text-[13px] font-normal pointer-coarse:h-11',
          'transition-colors duration-quick ease-out motion-reduce:transition-none',
          'hover:bg-transparent data-[state=on]:bg-transparent data-[state=on]:font-medium',
          value === 'personal' ? 'data-[state=on]:text-primary-foreground' : 'data-[state=on]:text-foreground',
          collapsed && 'size-8 px-0'
        )}
      >
        <Icon className="size-3.5" aria-hidden />
        {!collapsed && label}
      </ToggleGroupItem>
    )
  }
  return (
    <ToggleGroup
      type="single"
      value={shown}
      onValueChange={(value) => {
        if (value === 'personal' || value === 'project') go(value)
      }}
      onPointerEnter={warmOther}
      onFocus={warmOther}
      onKeyDown={(event) => {
        const next = ARROW_SIDE[event.key]
        if (next) go(next)
      }}
      aria-label={t('railMode')}
      data-testid="rail-mode-switch"
      data-shown={shown}
      className={cn('bg-selected relative gap-0 rounded-[6px] p-0.5', collapsed ? 'flex-col flex-nowrap' : 'grid w-full grid-cols-2')}
    >
      <span
        aria-hidden
        data-slot="rail-mode-thumb"
        className={cn(
          'absolute rounded-[4px] transition-[translate,background-color,box-shadow] duration-quick ease-entrance motion-reduce:transition-none',
          collapsed ? 'inset-x-0.5 top-0.5 h-[calc(50%-2px)]' : 'inset-y-0.5 left-0.5 w-[calc(50%-2px)]',
          shown === 'project' && (collapsed ? 'translate-y-full' : 'translate-x-full'),
          THUMB[shown]
        )}
      />
      {item('personal', t('railModePersonal'))}
      {item('project', t('railModeProject'))}
    </ToggleGroup>
  )
}
