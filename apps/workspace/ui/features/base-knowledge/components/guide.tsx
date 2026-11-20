'use client'

import type { JSX } from 'react'
import { CircleHelp, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SectionLabel } from '@/components/ui/section-label'
import { useTranslations } from '@/i18n'
import { baseKnowledgeCopy } from '@/i18n/namespaces/base-knowledge'
import { commonCopy } from '@/i18n/namespaces/common'
import { cn } from '@/lib/utils'
import { ASK_FOR_LICENCE } from '@/lib/base-knowledge/wire'

const STEPS = ASK_FOR_LICENCE ? (['upload', 'confirm', 'check', 'licence'] as const) : (['upload', 'confirm', 'check'] as const)

export function Guide({ onClose }: { onClose: () => void }): JSX.Element {
  const t = useTranslations(baseKnowledgeCopy)
  const tCommon = useTranslations(commonCopy)
  return (
    <section aria-label={t('guide.toggle')} className="border-edge border-l-2 py-0.5 pl-3" data-testid="base-knowledge-guide">
      <div className="flex min-h-8 items-center justify-between gap-2">
        <SectionLabel as="h2" icon={CircleHelp} className="px-0">
          {t('guide.toggle')}
        </SectionLabel>
        <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={tCommon('actions.close')} onClick={onClose} data-testid="base-knowledge-guide-close">
          <X aria-hidden />
        </Button>
      </div>
      <ol className={cn('grid max-w-5xl gap-4 pt-1 sm:grid-cols-2', STEPS.length === 4 ? 'xl:grid-cols-4' : 'xl:grid-cols-3')}>
        {STEPS.map((step) => (
          <li key={step} className="space-y-1">
            <SectionLabel as="h3" className="px-0">
              {t(`guide.${step}.title`)}
            </SectionLabel>
            <p className="text-muted-foreground text-sm">{t(`guide.${step}.body`)}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}
