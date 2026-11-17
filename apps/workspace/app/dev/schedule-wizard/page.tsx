'use client'

import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { notFound, useSearchParams } from 'next/navigation'
import { I18nProvider } from '@/i18n'
import { ScheduleWizard } from '@/features/jobs/components/schedule-wizard'
import { SCHEDULES, installScheduleShim } from '../_fixtures/schedules'

installScheduleShim('__scheduleWizardShim')

const EDITING = SCHEDULES[1]

export default function ScheduleWizardPreview(): JSX.Element {
  if (process.env.NODE_ENV !== 'development') notFound()

  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <main
        data-testid="schedule-wizard-preview"
        className="bg-background text-foreground flex min-h-dvh flex-col p-6"
      >
        <WizardAtStep />
      </main>
    </I18nProvider>
  )
}

function WizardAtStep(): JSX.Element {
  const params = useSearchParams()
  const target = Number(params?.get('step') ?? '1')
  const [advanced, setAdvanced] = useState(0)

  useEffect(() => {
    if (!Number.isFinite(target) || advanced >= target - 1) return
    let stopped = false
    const tick = (): void => {
      if (stopped) return
      const next = document.querySelector<HTMLButtonElement>('[data-testid="wizard-next"]')
      if (next && !next.disabled) {
        next.click()
        setAdvanced((count) => count + 1)
        return
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    return () => {
      stopped = true
    }
  }, [target, advanced])

  return (
    <ScheduleWizard
      projectId="p1"
      job={EDITING}
      onSaved={() => {}}
      onCancel={() => {}}
    />
  )
}
