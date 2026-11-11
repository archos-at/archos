/**
 * Who sees each operation of the platform's base knowledge (ADR-0165): all of
 * it is the platform's own data and settings, so the platform door offers it
 * (`PLATFORM_PUBLIC`, ADR-0160), and an operator's agent brings a country in
 * through it: the guide, schema-get, captures, dry runs and validate are what
 * make that door agent-grade (ADR-0170). Approve, publish, rollback and entitlement run only on the
 * person's own yes (`personDecides` on the operation, held at the route).
 */

import type { platformKnowledgeOperations } from '../catalog/platform-knowledge'
import type { platformSourceOperations } from '../catalog/platform-sources'
import { PLATFORM_PUBLIC, type PlatformExposure } from './platform'

type PlatformKnowledgeOperationName = (typeof platformKnowledgeOperations | typeof platformSourceOperations)[number]['name']

export const PLATFORM_KNOWLEDGE_EXPOSURE = {
  'platform-knowledge-change-request-create': PLATFORM_PUBLIC,
  // A public page, fetched through the sandboxed fetcher into a draft: platform content, never a tenant's (ADR-0170).
  'platform-knowledge-citation-capture': PLATFORM_PUBLIC,
  'platform-knowledge-change-request-decide': PLATFORM_PUBLIC,
  'platform-knowledge-change-request-get': PLATFORM_PUBLIC,
  'platform-knowledge-change-request-list': PLATFORM_PUBLIC,
  'platform-knowledge-change-request-review': PLATFORM_PUBLIC,
  'platform-knowledge-change-request-submit': PLATFORM_PUBLIC,
  'platform-knowledge-index-status': PLATFORM_PUBLIC,
  'platform-knowledge-overview-get': PLATFORM_PUBLIC,
  'platform-knowledge-publish': PLATFORM_PUBLIC,
  'platform-knowledge-records-propose': PLATFORM_PUBLIC,
  'platform-knowledge-rollback': PLATFORM_PUBLIC,
  'platform-knowledge-schema-get': PLATFORM_PUBLIC,
  // A country's public sources (ADR-0174): platform configuration of public pages, never a tenant's content.
  // The key is the person's own yes (`personDecides`) and is never returned.
  'platform-knowledge-source-credential-set': PLATFORM_PUBLIC,
  'platform-knowledge-source-status': PLATFORM_PUBLIC,
  'platform-knowledge-source-test': PLATFORM_PUBLIC,
  // An edition's public text, attached in its draft: fetched by the sandboxed fetcher or uploaded, platform content only.
  'platform-knowledge-base-get': PLATFORM_PUBLIC,
  'platform-knowledge-document-get': PLATFORM_PUBLIC,
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
