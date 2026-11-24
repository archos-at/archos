'use client'

import type { JSX } from 'react'
import { useRouter } from 'next/navigation'
import { LockKeyhole, Users } from 'lucide-react'

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useTranslations } from '@/i18n'
import { navCopy } from '@/i18n/namespaces/nav'
import { cn } from '@/lib/utils'
import { readRecentProjectIds } from './recent-projects'
import { PERSONAL_CHAT_PATH, type RailMode } from './rail-mode'

export function projectModeHref(recentProjectIds: readonly string[]): string {
  const last = recentProjectIds[0]
  return last ? `/app/projects/${encodeURIComponent(last)}/chat` : '/app/projects'
}

const SIDE = {
  personal: { icon: LockKeyhole, on: 'data-[state=on]:bg-primary data-[state=on]:text-primary-foreground' },
  project: { icon: Users, on: 'data-[state=on]:bg-sheet data-[state=on]:text-foreground data-[state=on]:shadow-xs' },
} as const

export function RailModeSwitch({ mode, collapsed }: { mode: RailMode; collapsed: boolean }): JSX.Element {
  const t = useTranslations(navCopy)
  const router = useRouter()
  const go = (next: string): void => {
    if (next === mode) return
    router.push(next === 'personal' ? PERSONAL_CHAT_PATH : projectModeHref(readRecentProjectIds()))
  }
  const item = (value: RailMode, label: string): JSX.Element => {
    const { icon: Icon, on } = SIDE[value]
    return (
      <ToggleGroupItem
        value={value}
        aria-label={label}
        title={collapsed ? label : undefined}
        data-testid={`rail-mode-${value}`}
        className={cn(
          'h-8 gap-1.5 rounded-[6px] px-2 text-[13px] font-normal hover:bg-transparent data-[state=on]:font-medium',
          on,
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
      value={mode}
      onValueChange={(value) => {
        if (value === 'personal' || value === 'project') go(value)
      }}
      aria-label={t('railMode')}
      data-testid="rail-mode-switch"
      className={cn('bg-selected gap-0 rounded-control p-0.5', collapsed ? 'flex-col flex-nowrap' : 'grid w-full grid-cols-2')}
    >
      {item('personal', t('railModePersonal'))}
      {item('project', t('railModeProject'))}
    </ToggleGroup>
  )
}
