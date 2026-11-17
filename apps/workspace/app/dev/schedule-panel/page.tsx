'use client'

import type { JSX } from 'react'
import { notFound } from 'next/navigation'
import { I18nProvider } from '@/i18n'
import { TasksPanel } from '@/features/tasks/components/tasks-panel'
import { installScheduleShim } from '../_fixtures/schedules'

installScheduleShim('__schedulePanelShim')

export default function SchedulePanelPreview(): JSX.Element {
  if (process.env.NODE_ENV !== 'development') notFound()

  return (
    <I18nProvider initialLocale="de" fixedLocale>
      {/* `min-h-dvh`, not `h-dvh`: the real pane scrolls internally, and a
          screenshot of an internal scroller can only ever show its first
          screen. Letting the page grow puts the grid and the cards in one shot. */}
      <main
        data-testid="schedule-panel-preview"
        className="bg-background text-foreground flex min-h-dvh flex-col"
      >
        <TasksPanel
          projectId="p1"
          canManageJobs
          initialView="timetable"
        />
      </main>
    </I18nProvider>
  )
}
