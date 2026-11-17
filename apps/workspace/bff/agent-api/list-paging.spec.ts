/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { AGENT_OPERATIONS } from './catalog'

function unpaged(): string[] {
  return AGENT_OPERATIONS.filter((op) => op.name.endsWith('-list'))
    .filter((op) => {
      const keys = Object.keys(op.query?.shape ?? {})
      return !keys.includes('limit') || !keys.includes('cursor')
    })
    .map((op) => op.name)
    .sort()
}

const BASELINE: readonly string[] = [
  'annotation-list',
  'answer-feedback-list',
  'assignment-candidate-list',
  'assignment-list',
  'bim-check-list',
  'bim-model-list',
  'conversation-mention-candidate-list',
  'deletion-list',
  'document-role-list',
  'document-version-list',
  'document-version-reviewer-list',
  'hold-list',
  'inbox-unread-anchor-list',
  'office-conventions-list',
  'office-shelf-folder-list',
  'organization-llm-credential-list',
  'organization-member-list',
  'organization-model-config-version-list',
  'organization-role-list',
  'platform-card-list',
  'platform-lesson-list',
  'platform-profiler-conversation-list',
  'platform-skill-category-list',
  'platform-skill-list',
  'project-folder-list',
  'project-list',
  'project-same-address-list',
  'project-upload-list',
  'push-device-list',
  'quarantine-list',
  'session-document-list',
  'sharing-candidate-list',
  'skill-category-list',
  'skill-invocable-list',
  'skill-list',
]

describe('list operations page', () => {
  it('take limit and cursor, except the shrinking baseline', () => {
    expect(unpaged()).toEqual([...BASELINE].sort())
  })
})
