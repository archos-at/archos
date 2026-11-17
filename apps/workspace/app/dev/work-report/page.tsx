'use client'

import type { FC } from 'react'
import { I18nProvider } from '@/i18n'
import { AnatomyBlock } from '@/features/chat/components/AnswerAnatomy'
import { WORK_REPORT_SCENARIOS } from '../_fixtures/work-report'

const Preview: FC = () => (
  <main
    data-testid="work-report-preview"
    className="text-foreground mx-auto flex w-full max-w-[680px] flex-col gap-10 p-4 sm:p-6"
  >
    {WORK_REPORT_SCENARIOS.map(({ id, title, note, work }) => (
      <section key={id} data-testid={`work-report-scenario-${id}`} className="flex flex-col gap-3">
        <div>
          <h2 className="text-foreground text-sm font-semibold">{title}</h2>
          <p className="text-muted-foreground text-xs">{note}</p>
        </div>
        <AnatomyBlock card={{ type: 'work_report', ...work }} />
      </section>
    ))}
  </main>
)

export default function WorkReportPreviewPage() {
  return (
    <I18nProvider initialLocale="de" fixedLocale>
      <Preview />
    </I18nProvider>
  )
}
