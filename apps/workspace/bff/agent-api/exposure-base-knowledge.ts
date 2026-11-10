/**
 * Who sees each base-knowledge operation (ADR-0158). Spread into `EXPOSURE`
 * (`exposure.config.ts`), the one table that decides exposure; split out so
 * that table stays readable and so the base-knowledge sessions own their rows.
 *
 * Everything is the office's own data and actions on it, so the door offers
 * it. The exceptions are confirming and the licence: what the office relies on
 * in its answers, and whether a licensed copy's text reaches a model, are the
 * person's call. The agent proposes; an outside agent's confirm or licence
 * change runs only on the person's own yes (`personDecides` on the operation).
 */

import type { Exposure } from './exposure.config'
import { OFFERED, externalOnly } from './exposure-presets'

export const BASE_KNOWLEDGE_EXPOSURE = {
  'base-knowledge-check-record': OFFERED,
  'base-knowledge-confirm': externalOnly(
    'which documents the office relies on in its answers is the person’s decision; the agent proposes, the person confirms',
  ),
  'base-knowledge-get': OFFERED,
  'base-knowledge-licence-set': externalOnly(
    'whether a licensed copy’s text may reach a model is the office’s statement about its own licence; only the person makes it',
  ),
  'base-knowledge-list': OFFERED,
  'base-knowledge-propose': OFFERED,
  'base-knowledge-remove': OFFERED,
  'base-knowledge-update': OFFERED,
  'base-knowledge-upload': OFFERED,
} as const satisfies Record<string, Exposure>
