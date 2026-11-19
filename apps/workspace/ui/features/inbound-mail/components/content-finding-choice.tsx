'use client'

import type { JSX } from 'react'
import { useId } from 'react'
import { ShieldAlert } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useTranslations } from '@/i18n'
import type { InboundMailContentFinding } from '@/lib/inbound-mail/inbound-mail-vocabulary'
import type { ContentFindingChoice as Choice } from '../lib/draft'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

const CHOICES: readonly Choice[] = ['masked', 'full']

export function ContentFindingChoice({
  findings,
  value,
  onChange,
  appendTo,
  disabled = false,
}: {
  findings: readonly InboundMailContentFinding[]
  value: Choice
  onChange: (choice: Choice) => void
  appendTo: string | null
  disabled?: boolean
}): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const id = useId()
  const kinds = [...new Set(findings)].map((kind) => t(`findings.kinds.${kind}`)).join(', ')
  const hint = (choice: Choice): string =>
    choice === 'masked' ? t('findings.maskedHint') : appendTo ? t('findings.fullHintAppend', { name: appendTo }) : t('findings.fullHintCreate')
  return (
    <div className="flex flex-col gap-2" data-testid="content-finding-choice">
      <div className="flex flex-col gap-0.5">
        <p className="text-foreground flex items-start gap-1.5 text-sm font-medium">
          <ShieldAlert aria-hidden className="text-warning mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 [overflow-wrap:anywhere]">{t('findings.title', { kinds })}</span>
        </p>
        <p className="text-muted-foreground pl-5.5 text-xs">{t('findings.explain')}</p>
      </div>
      <RadioGroup
        value={value}
        onValueChange={(next) => onChange(next as Choice)}
        aria-label={t('findings.choiceLabel')}
        disabled={disabled}
        className="gap-2 pl-5.5"
      >
        {CHOICES.map((choice) => (
          <div key={choice} className="flex items-start gap-2 pointer-coarse:min-h-11">
            <RadioGroupItem id={`${id}-${choice}`} value={choice} className="mt-0.5" data-testid={`finding-${choice}`} />
            <Label htmlFor={`${id}-${choice}`} className="flex flex-col items-start gap-0.5 font-normal">
              <span className="text-foreground text-sm">{t(`findings.${choice}`)}</span>
              <span className="text-muted-foreground text-xs leading-snug">{hint(choice)}</span>
            </Label>
          </div>
        ))}
      </RadioGroup>
    </div>
  )
}
