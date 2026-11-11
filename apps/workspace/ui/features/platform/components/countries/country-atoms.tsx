'use client'

/** The words the country list and a country's page share: its stage, and its next step. */

import type { JSX } from 'react'
import { Badge } from '@/components/ui/badge'
import { useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import type { CountryNextStep, CountryStage } from './country-state'

const STAGE_VARIANT = { not_started: 'outline', in_progress: 'info', published: 'success' } as const

export function StageBadge({ stage }: { stage: CountryStage }): JSX.Element {
  const t = useTranslations(platformCopy)
  return <Badge variant={STAGE_VARIANT[stage]}>{t(`countryPages.stage.${stage}`)}</Badge>
}

/** The next step as a sentence (`short`: the list's few words). */
export function NextStepText({ step, short = false }: { step: CountryNextStep; short?: boolean }): JSX.Element {
  const t = useTranslations(platformCopy)
  const form = short ? 'short' : 'long'
  const count = 'count' in step ? step.count : 0
  return <>{t(`countryPages.next.${step.kind}.${form}`, { count })}</>
}
