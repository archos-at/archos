/**
 * Who sees each base-knowledge operation (ADR-0163). Spread into `EXPOSURE`
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
  'base-knowledge-edition-as-of': OFFERED,
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
  // A read of the project's own facts under the platform's classification records: domain knowledge the door offers.
  'classification-evaluate': OFFERED,
  'organization-countries-get': OFFERED,
  // The knowledge context (ADR-0173): how far the base goes, and a project's base, are domain knowledge the door offers.
  'coverage-get': OFFERED,
  'project-base-get': OFFERED,
  // A report changes nothing an answer reads: it opens a draft a platform reviewer decides.
  'base-knowledge-report': OFFERED,
  'project-base-confirm': externalOnly(
    'which base a project’s answers rest on is the person’s confirmation; the agent shows the base, the person confirms it',
  ),
} as const satisfies Record<string, Exposure>
