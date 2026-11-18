import type { Exposure } from './exposure.config'
import { ARCHIVE_BYTES, HELD_MAIL, OFFERED, SENSITIVE, externalOnly, withheldAs } from './exposure-presets'

export const MAIL_EXPOSURE = {
  'inbound-mail-address-create': OFFERED,
  'inbound-mail-address-delete': OFFERED,
  'inbound-mail-address-get': OFFERED,
  'inbound-mail-address-rotate': OFFERED,
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
  'mail-thread-follow': SENSITIVE,
  'mail-thread-get': OFFERED,
  'mail-thread-list': OFFERED,
  'mail-thread-unfollow': externalOnly('a standing decision is the person’s own; the agent neither makes nor ends it'),
} as const satisfies Record<string, Exposure>
