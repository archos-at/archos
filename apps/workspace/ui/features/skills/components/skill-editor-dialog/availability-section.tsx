import type { Dispatch, JSX, SetStateAction } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { useTranslations } from '@/i18n'
import { skillsCopy } from '@/i18n/namespaces/skills'
import { SKILL_AGENTS, type AgentScope } from '../../lib/agent-scope'
import type { SkillPersistence } from '../../lib/skill-persistence'

interface SkillAvailabilitySectionProps {
  agents: AgentScope
  setAgents: Dispatch<SetStateAction<AgentScope>>
  hidden: boolean
  setHidden: Dispatch<SetStateAction<boolean>>
  enabled: boolean
  setEnabled: Dispatch<SetStateAction<boolean>>
  persistence?: SkillPersistence
}

export function SkillAvailabilitySection({
  agents,
  setAgents,
  hidden,
  setHidden,
  enabled,
  setEnabled,
  persistence,
}: SkillAvailabilitySectionProps): JSX.Element {
  const t = useTranslations(skillsCopy)
  return (
    <section className="border-border flex flex-col gap-4 rounded-xl border p-4">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-medium">{t('editor.agents.heading')}</h3>
        <p className="text-muted-foreground text-xs">{t('editor.agents.hint')}</p>
      </div>

      <div className="flex flex-col gap-2.5">
        {SKILL_AGENTS.map((agent) => {
          const checked = agents.selected.includes(agent)
          const last = checked && agents.selected.length === 1
          const key = agent === 'researcher' ? 'chat' : 'deep'
          return (
            <Field
              key={agent}
              orientation="horizontal"
              className="justify-start gap-2.5"
            >
              <Checkbox
                id={`skill-agent-${agent}`}
                checked={checked}
                disabled={last}
                onCheckedChange={(next) =>
                  setAgents((current) => ({
                    ...current,
                    selected:
                      next === true
                        ? SKILL_AGENTS.filter(
                            (name) =>
                              name === agent || current.selected.includes(name),
                          )
                        : current.selected.filter((name) => name !== agent),
                  }))
                }
                className="mt-0.5"
              />
              <div className="flex min-w-0 flex-col gap-0.5">
                <FieldLabel
                  htmlFor={`skill-agent-${agent}`}
                  className="font-medium"
                >
                  {t(`editor.agents.${key}.label`)}
                </FieldLabel>
                <FieldDescription className="leading-snug">
                  {t(`editor.agents.${key}.hint`)}
                </FieldDescription>
              </div>
            </Field>
          )
        })}
      </div>
      <Field orientation="horizontal">
        <div className="flex min-w-0 flex-col gap-0.5">
          <FieldLabel htmlFor="skill-hidden">{t('editor.hiddenLabel')}</FieldLabel>
          <FieldDescription>{t('editor.hiddenHint')}</FieldDescription>
        </div>
        <Switch id="skill-hidden" checked={hidden} onCheckedChange={setHidden} />
      </Field>

      <Field orientation="horizontal">
        <div className="flex min-w-0 flex-col gap-0.5">
          <FieldLabel htmlFor="skill-enabled">
            {persistence?.switchLabels?.label ?? t('editor.enabledLabel')}
          </FieldLabel>
          <FieldDescription>
            {persistence?.switchLabels?.hint ?? t('editor.enabledHint')}
          </FieldDescription>
        </div>
        <Switch id="skill-enabled" checked={enabled} onCheckedChange={setEnabled} />
      </Field>
    </section>
  )
}
