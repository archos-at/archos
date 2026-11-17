'use client'

import type { JSX } from 'react'
import type { QuarantineVerdict } from '@/lib/upload-screening/quarantine'
import { cn } from '@/lib/utils'
import type { TrackedFile } from '../types'
import { QuarantineFindings } from './quarantine-findings'

export interface HeldUploadReasonProps {
  verdict: QuarantineVerdict | null
  replacesHeld?: TrackedFile['replacesHeld']
  message?: string | null
  withoutSentence?: boolean
  className?: string
  testId: string
}

export function HeldUploadReason({
  verdict,
  replacesHeld,
  message,
  withoutSentence,
  className,
  testId,
}: HeldUploadReasonProps): JSX.Element {
  if (replacesHeld) {
    return (
      <p className={cn('text-muted-foreground text-xs leading-snug', className)} data-testid={`${testId}-replaces`}>
        {message}
      </p>
    )
  }
  return (
    <QuarantineFindings
      verdict={verdict}
      withoutSentence={withoutSentence}
      className={className}
      testId={testId}
    />
  )
}
