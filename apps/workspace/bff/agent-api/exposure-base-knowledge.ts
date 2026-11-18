import type { Exposure } from './exposure.config'
import { OFFERED, externalOnly } from './exposure-presets'

export const BASE_KNOWLEDGE_EXPOSURE = {
  'base-knowledge-bulk': OFFERED,
  'base-knowledge-check-record': OFFERED,
  'base-knowledge-edition-add': OFFERED,
  'base-knowledge-folder-create': OFFERED,
  'base-knowledge-folder-list': OFFERED,
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
  'classification-evaluate': OFFERED,
  'organization-countries-get': OFFERED,
  'coverage-get': OFFERED,
  'project-base-get': OFFERED,
  'base-knowledge-report': OFFERED,
  'project-base-confirm': externalOnly(
    'which base a project’s answers rest on is the person’s confirmation; the agent shows the base, the person confirms it',
  ),
} as const satisfies Record<string, Exposure>
