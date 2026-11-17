import type { platformKnowledgeOperations } from '../catalog/platform-knowledge'
import type { platformSourceOperations } from '../catalog/platform-sources'
import { PLATFORM_PUBLIC, type PlatformExposure } from './platform'

type PlatformKnowledgeOperationName = (typeof platformKnowledgeOperations | typeof platformSourceOperations)[number]['name']

export const PLATFORM_KNOWLEDGE_EXPOSURE = {
  'platform-knowledge-change-request-create': PLATFORM_PUBLIC,
  'platform-knowledge-citation-capture': PLATFORM_PUBLIC,
  'platform-knowledge-change-request-decide': PLATFORM_PUBLIC,
  'platform-knowledge-change-request-get': PLATFORM_PUBLIC,
  'platform-knowledge-change-request-list': PLATFORM_PUBLIC,
  'platform-knowledge-change-request-review': PLATFORM_PUBLIC,
  'platform-knowledge-change-request-submit': PLATFORM_PUBLIC,
  'platform-knowledge-golden-run': PLATFORM_PUBLIC,
  'platform-knowledge-golden-run-advance': PLATFORM_PUBLIC,
  'platform-knowledge-golden-run-get': PLATFORM_PUBLIC,
  'platform-knowledge-index-status': PLATFORM_PUBLIC,
  'platform-knowledge-overview-get': PLATFORM_PUBLIC,
  'platform-knowledge-publish': PLATFORM_PUBLIC,
  'platform-knowledge-records-propose': PLATFORM_PUBLIC,
  'platform-knowledge-release-export': PLATFORM_PUBLIC,
  'platform-knowledge-release-import': PLATFORM_PUBLIC,
  'platform-knowledge-rollback': PLATFORM_PUBLIC,
  'platform-knowledge-schema-get': PLATFORM_PUBLIC,
  'platform-knowledge-source-credential-set': PLATFORM_PUBLIC,
  'platform-knowledge-source-status': PLATFORM_PUBLIC,
  'platform-knowledge-source-test': PLATFORM_PUBLIC,
  'platform-knowledge-base-get': PLATFORM_PUBLIC,
  'platform-knowledge-document-get': PLATFORM_PUBLIC,
  'platform-knowledge-document-add': PLATFORM_PUBLIC,
  'platform-knowledge-document-add-upload': PLATFORM_PUBLIC,
  'platform-knowledge-work-list': PLATFORM_PUBLIC,
  'platform-knowledge-text-get': PLATFORM_PUBLIC,
  'platform-knowledge-text-import': PLATFORM_PUBLIC,
  'platform-knowledge-text-list': PLATFORM_PUBLIC,
  'platform-knowledge-text-upload': PLATFORM_PUBLIC,
  'platform-knowledge-validate': PLATFORM_PUBLIC,
  'platform-org-countries-list': PLATFORM_PUBLIC,
  'platform-org-country-entitle': PLATFORM_PUBLIC,
  'platform-organization-home-country-set': PLATFORM_PUBLIC,
  'platform-territory-import': PLATFORM_PUBLIC,
} as const satisfies Record<PlatformKnowledgeOperationName, PlatformExposure>
