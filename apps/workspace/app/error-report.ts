import { useSyncExternalStore } from 'react'

import { CONTACT_EMAIL } from '@/lib/brand'
import type { Translator } from '@/i18n/translate'

/**
 * The „Fehler melden“ link of the error screens (`error.tsx`, `global-error.tsx`): a mail
 * to the company's contact address with the address that failed and, for an error thrown
 * on the server, its digest, the reference `onRequestError` reported it under. No message
 * and no stack: the screen is shown to whoever hit the error, and the mail is theirs to
 * edit before it is sent.
 *
 * `t` is a translator for the `errors` namespace.
 */
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

/**
 * The address the error happened at, for the report. A server render has none,
 * and the client reads it after hydration, so the two never disagree.
 */
export function useCurrentAddress(): string {
  return useSyncExternalStore(
    () => () => {},
    () => window.location.href,
    () => '',
  )
}
