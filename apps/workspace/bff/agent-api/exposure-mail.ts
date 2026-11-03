/**
 * Who sees each mail operation: the project address, held mail, the archive
 * import and filed threads. Spread into `EXPOSURE` (`exposure.config.ts`), the
 * one table that decides exposure; split out so that table stays readable.
 */

import type { Exposure } from './exposure.config'
import { ARCHIVE_BYTES, HELD_MAIL, OFFERED, SENSITIVE, externalOnly, withheldAs } from './exposure-presets'

export const MAIL_EXPOSURE = {
  'inbound-mail-address-create': OFFERED,
  'inbound-mail-address-delete': OFFERED,
  'inbound-mail-address-get': OFFERED,
  'inbound-mail-address-rotate': OFFERED,
  // The agent proposes these as a card that files clean, unflagged parts only (RT-S5); an
  // outside agent's call runs only on the person's own yes (`requiresPersonConfirmation`).
  'inbound-mail-dismiss': OFFERED,
  'inbound-mail-file': OFFERED,
  'inbound-mail-get': OFFERED,
  'inbound-mail-list': OFFERED,
  'inbound-mail-original-get': withheldAs(
    'evidence',
    'the original message as received, kept as proof of what was sent; no model reads it, a person downloads it in the app',
  ),
  'inbound-mail-part-content-get': externalOnly(HELD_MAIL),
  'inbound-mail-restore': OFFERED,
  'inbound-mail-text-get': externalOnly(HELD_MAIL),
  'mail-import-cancel': OFFERED,
  'mail-import-complete': ARCHIVE_BYTES,
  'mail-import-get': OFFERED,
  'mail-import-list': OFFERED,
  'mail-import-part-upload': ARCHIVE_BYTES,
  'mail-import-start': ARCHIVE_BYTES,
  'mail-thread-entry-detach': OFFERED,
  'mail-thread-entry-original-get': withheldAs(
    'evidence',
    'a filed message as received, kept as proof of what was sent; no model reads it, a person downloads it in the app',
  ),
  // A person's standing decision to let replies' text in without a click (D31):
  // it turns review down for one conversation, so it is never the agent's to make,
  // and an outside agent's only under the office's opt-in and the step-up scope.
  'mail-thread-follow': SENSITIVE,
  'mail-thread-get': OFFERED,
  'mail-thread-list': OFFERED,
  'mail-thread-unfollow': externalOnly('a standing decision is the person’s own; the agent neither makes nor ends it'),
} as const satisfies Record<string, Exposure>
