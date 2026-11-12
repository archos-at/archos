'use client'

/**
 * The mark on a temporary chat's row in the history (ADR-0180 rule 2): the
 * glyph the composer's switch and the line under it use, in muted ink before
 * the row's time. Quiet on purpose: a temporary chat needs nothing from the
 * reader, so it takes no hue.
 *
 * Decorative to a screen reader. The row is one button whose label wins over
 * its content, so the words are in that label (`sessionsPanel.sessionLabelTemporary`,
 * set by `SessionItem`); the `title` is the same fact for a pointer.
 */

import type { JSX } from 'react'
import { MessageCircleDashed } from 'lucide-react'
import { useTranslations } from '@/i18n'
import { researchCopy } from '@/i18n/namespaces/research'

/** The row's label with the mark said in it: `{label}` is the label the row has without it. */
export const TEMPORARY_LABEL = 'sessionsPanel.sessionLabelTemporary'

export function SessionTemporaryMark(): JSX.Element {
  const t = useTranslations(researchCopy)
  return (
    <span
      className="text-muted-foreground shrink-0"
      title={t('sessionsPanel.temporaryMark')}
      data-testid="session-temporary-mark"
    >
      <MessageCircleDashed className="size-3.5" aria-hidden="true" />
    </span>
  )
}
