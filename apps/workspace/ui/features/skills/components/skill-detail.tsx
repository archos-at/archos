'use client'

import type { JSX } from 'react'
import { BookOpen, Pencil, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Spinner } from '@/components/ui/spinner'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { skillsCopy } from '@/i18n/namespaces/skills'
import { cn } from '@/lib/utils'
import type { SkillListItem } from '@/adapters/api/skills-client'
import { agentScopeLabelKey } from '../lib/agent-scope'

interface SkillDetailProps {
  skill: SkillListItem | null
  categoryName: string | null
  open: boolean
  resolving?: boolean
  canManage: boolean
  onEdit: (skill: SkillListItem) => void
  onToggle: (skill: SkillListItem, enabled: boolean) => void
  onDelete: (skill: SkillListItem) => void
  toggling: boolean
  onClose: () => void
}

export function SkillDetail({
  skill,
  categoryName,
  open,
  resolving = false,
  canManage,
  onEdit,
  onToggle,
  onDelete,
  toggling,
  onClose,
}: SkillDetailProps): JSX.Element {
  const t = useTranslations(skillsCopy)
  const tCommon = useTranslations(commonCopy)
  const isOrg = skill !== null && skill.id !== null
  const scopeKey = skill ? agentScopeLabelKey(skill.metadata['grid-agents']) : null

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="right"
        closeLabel={t('drawer.close')}
        data-testid="skill-detail"
        className="flex flex-col"
      >
        {skill ? (
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto py-2 pr-1">
            <SheetHeader>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  aria-hidden
                  className={cn(
                    'text-muted-foreground font-mono text-sm font-medium',
                    !skill.enabled && 'opacity-45',
                  )}
                >
                  /
                </span>
                {!skill.enabled && (
                  <Badge variant="outline">{t('toolbox.origin.disabled')}</Badge>
                )}
                {scopeKey && <Badge variant="outline">{t(`toolbox.scope.${scopeKey}`)}</Badge>}
              </div>
              <SheetTitle className="mt-2 text-left font-mono">{skill.name}</SheetTitle>
              <SheetDescription className="text-left">{skill.description}</SheetDescription>
            </SheetHeader>

            <section aria-label={t('drawer.detailHeading')}>
              <dl className="flex flex-col gap-2 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground shrink-0">{t('drawer.categoryLabel')}</dt>
                  <dd className="min-w-0 truncate text-right">{categoryName ?? t('drawer.unsorted')}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground shrink-0">{t('drawer.statusLabel')}</dt>
                  <dd className="text-right">
                    {skill.enabled ? t('drawer.statusOn') : t('drawer.statusOff')}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground shrink-0">{t('drawer.originLabel')}</dt>
                  <dd className="min-w-0 truncate text-right">
                    {skill.origin === 'platform'
                      ? t('drawer.originPlatform')
                      : skill.origin === 'platform-clone' && skill.clonedFrom
                        ? t('drawer.originClone', { name: skill.clonedFrom })
                        : t('drawer.originOrg')}
                  </dd>
                </div>
              </dl>
            </section>

            <section aria-label={t('drawer.instructionHeading')}>
              <h2 className="text-foreground text-sm font-medium">
                {t('drawer.instructionHeading')}
              </h2>
              <pre className="bg-muted text-foreground mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg p-3 font-mono text-xs leading-relaxed">
                {skill.body}
              </pre>
            </section>

            {canManage && (
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
                <Switch
                  checked={skill.enabled}
                  disabled={toggling}
                  onCheckedChange={(next) => onToggle(skill, next)}
                  aria-label={t('drawer.switchAria', { name: skill.name })}
                />
                {isOrg && (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => onEdit(skill)}>
                      <Pencil className="size-3.5" aria-hidden />
                      {t('toolbox.actions.edit')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => onDelete(skill)}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                      {t('toolbox.actions.delete')}
                    </Button>
                  </>
                )}
              </div>
            )}

            {!canManage && (
              <p className="text-muted-foreground mt-auto flex items-center gap-2 pt-2 text-xs">
                <BookOpen className="size-3.5 shrink-0" aria-hidden />
                {skill.origin === 'platform' ? t('curated.origin') : t('drawer.originOrg')}
              </p>
            )}
          </div>
        ) : (
          <div className="py-8">
            <SheetHeader>
              {/* While the deep link is still being checked, the heading says
                  so: „Nicht gefunden" over a pending read is a finding before
                  there is anything to find. */}
              <SheetTitle>{resolving ? t('drawer.loadingTitle') : t('drawer.goneTitle')}</SheetTitle>
            </SheetHeader>
            {resolving ? (
              <p className="text-muted-foreground mt-2 flex items-center gap-2 text-sm">
                <Spinner size="sm" aria-hidden />
                {tCommon('states.loading')}
              </p>
            ) : (
              <p className="text-muted-foreground mt-2 text-sm">{t('drawer.gone')}</p>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
