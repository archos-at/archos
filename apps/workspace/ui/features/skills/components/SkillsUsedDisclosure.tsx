'use client'

import { useState, type FC } from 'react'
import { ChevronDown, Sparkles } from 'lucide-react'
import { ClampedText } from '@/components/ui/clamped-text'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useTranslations } from '@/i18n'
import { skillsCopy } from '@/i18n/namespaces/skills'
import { cn } from '@/lib/utils'
import { useInvocableSkills } from '../hooks/use-invocable-skills'
import { skillLabel } from '../lib/skill-activity'
import { findSkillNamed } from '@/lib/skills/legacy-names'

export interface SkillsUsedDisclosureProps {
  skillsActivated?: string[]
  hiddenSkills?: string[]
  showReasoning?: boolean
  className?: string
}

export const SkillsUsedDisclosure: FC<SkillsUsedDisclosureProps> = ({
  skillsActivated,
  hiddenSkills,
  showReasoning = false,
  className,
}) => {
  const t = useTranslations(skillsCopy)
  const [open, setOpen] = useState(false)
  const { skills } = useInvocableSkills(open)

  if (!skillsActivated || skillsActivated.length === 0) return null

  const hiddenSet = new Set(hiddenSkills ?? [])
  const count = skillsActivated.length
  const summary = count === 1 ? t('composer.activated.one') : t('composer.activated.other', { count })

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn('mt-1.5', className)}>
      <CollapsibleTrigger
        className={cn(
          'text-muted-foreground hover:text-foreground focus-visible:ring-ring/60 flex items-center gap-1.5',
          'rounded-md text-xs leading-relaxed transition-colors duration-quick ease-out',
          'focus-visible:outline-none focus-visible:ring-2',
          'touch-target',
        )}
        data-testid="skills-used-trigger"
      >
        <Sparkles className="size-3 shrink-0" aria-hidden />
        <span>{summary}</span>
        <ChevronDown
          className={cn(
            'size-3 shrink-0 transition-transform duration-quick ease-out motion-reduce:transition-none',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </CollapsibleTrigger>

      <CollapsibleContent className="mt-1.5">
        <div
          className="bg-muted animate-in fade-in-0 flex flex-col gap-2 rounded-lg border px-3 py-2.5 duration-base ease-out motion-reduce:animate-none"
          data-testid="skills-used-panel"
        >
          <p className="text-foreground text-xs font-medium">{t('composer.activated.title')}</p>

          <ul className="flex flex-col gap-1.5">
            {skillsActivated.map((name) => {
              const known = findSkillNamed(skills, name)
              const label = skillLabel({ name })
              if (!label) return null
              const hidden = hiddenSet.has(name)
              const deEmphasised = hidden && !showReasoning
              return (
                <li
                  key={name}
                  className={cn(
                    'flex flex-col gap-0.5 transition-opacity duration-quick ease-out',
                    deEmphasised && 'opacity-60',
                  )}
                  data-hidden={hidden ? 'true' : undefined}
                  data-testid={hidden ? 'skills-used-hidden-row' : undefined}
                >
                  <span
                    className={cn('text-foreground text-xs', label.mono && 'font-mono')}
                  >
                    {label.text}
                  </span>
                  {/* Absent when the descriptions have not arrived yet, or when
                      the skill has since been deleted or renamed. The name alone
                      is still true, so the row stays rather than disappearing. */}
                  {known?.description ? (
                    <ClampedText
                      lines={2}
                      moreLabel={t('composer.activated.descriptionMore')}
                      lessLabel={t('composer.activated.descriptionLess')}
                      className="text-muted-foreground text-xs leading-snug"
                    >
                      {known.description}
                    </ClampedText>
                  ) : (
                    <span className="min-h-[1.375rem]" aria-hidden />
                  )}
                </li>
              )
            })}
          </ul>

          {/* The mechanism, stated once at the bottom: it is the same for every
              answer, so it belongs under the specifics rather than above them. */}
          <p className="text-muted-foreground text-xs leading-snug">
            {t('composer.activated.explainer')}
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
