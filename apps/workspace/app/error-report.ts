import { useSyncExternalStore } from 'react'

import { CONTACT_EMAIL } from '@/lib/brand'
import type { Translator } from '@/i18n/translate'

export function errorReportHref(t: Translator, address: string, digest?: string): string {
  const body = [
    t('appError.reportAddress', { address }),
    ...(digest ? [t('appError.reference', { reference: digest })] : []),
    '',
    t('appError.reportPrompt'),
    '',
  ].join('\n')
  const query = `subject=${encodeURIComponent(t('appError.reportSubject'))}&body=${encodeURIComponent(body)}`
  return `mailto:${CONTACT_EMAIL}?${query}`
}

export function useCurrentAddress(): string {
  return useSyncExternalStore(
    () => () => {},
    () => window.location.href,
    () => '',
  )
}
