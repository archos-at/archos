import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { QUESTIONS_DONE, QUESTIONS_READING } from '@/app/dev/_fixtures/project-setup-questions'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { IntakeView } from '@/lib/project-intake/types'
import { QuestionsStep } from './questions-step'

vi.mock('@/shared/context', () => ({
  useAppConfig: () => ({
    fileUpload: {
      acceptedTypes: '.pdf',
      acceptedMimeTypes: ['application/pdf'],
      maxTotalSizeMB: 100,
      maxFileSize: 100 * 1024 * 1024,
      maxTotalSize: 100 * 1024 * 1024,
      maxFileCount: 10,
    },
  }),
}))

function serverMarkup(view: IntakeView): HTMLDivElement {
  const container = document.createElement('div')
  container.innerHTML = renderToString(
    <TooltipProvider>
      <QuestionsStep
        view={view}
        projectId={view.projectId}
        busy={false}
        canDecide
        canUpload
        uploading={false}
        onDecide={vi.fn()}
        onFiles={vi.fn()}
        onReread={vi.fn()}
        onNext={vi.fn()}
        onGoTo={vi.fn()}
      />
    </TooltipProvider>
  )
  return container
}

describe('the question round before the bundle boots', () => {
  it('sends the desktop actions under max-md:hidden and the phone note under md:hidden, so neither appears after the first paint', () => {
    const html = serverMarkup(QUESTIONS_READING)
    expect(html.querySelector('.max-md\\:hidden [data-testid="question-actions"]')).not.toBeNull()
    expect(html.querySelector('.md\\:hidden [data-testid="questions-reading-note"]')).not.toBeNull()
  })

  it('sends the phone note in the finished round too', () => {
    const html = serverMarkup({ ...QUESTIONS_DONE, status: 'reading' })
    expect(html.querySelector('[data-testid="questions-done"] .md\\:hidden [data-testid="questions-reading-note"]')).not.toBeNull()
  })
})
