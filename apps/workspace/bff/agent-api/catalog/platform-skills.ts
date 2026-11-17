/**
 * The platform's skills on the platform door (ADR-0016, ADR-0170). A published
 * platform skill is offered to every office at once, and an edit reaches every
 * office running it immediately, so a publish, an edit and a delete are the
 * person's own decision (`personDecides`, held at the route by
 * `requirePersonDecision`): an operator's agent drafts, the person releases.
 * Creating a draft needs no yes, as a draft change request needs none.
 */

import { z } from 'zod'
import { createPlatformSkillSchema, patchPlatformSkillSchema } from '@/lib/skills/types'
import type { AgentOperation, PersonConfirmation } from '../operation'

const skillParams = z.object({
  skillId: z.string().describe('The platform skill id, from platform-skill-list.'),
})

/** Where the person publishes, edits or deletes a platform skill themselves. */
const IN_SKILLS_VIEW: PersonConfirmation = { decideAt: () => '/app/platform/skills' }

export const platformSkillOperations = [
  {
    name: 'platform-skill-list',
    domain: 'platform',
    summary: 'List the platform skills',
    description:
      'Every skill the platform offers to organizations, published or draft, with ids. Skill ids feed ' +
      'platform-skill-update and platform-skill-delete.',
    method: 'GET',
    path: '/api/platform/skills',
    load: () => import('@/app/api/platform/skills/route'),
  },
  {
    name: 'platform-skill-create',
    domain: 'platform',
    summary: 'Draft a platform skill',
    description:
      'Adds a skill (name, description, body) to the platform catalog as a draft, which no office sees. Publishing ' +
      'offers it to every organization, so it is the person’s own decision: call platform-skill-update with ' +
      '`published: true`, which asks them. `published: true` here is refused unless the person said yes in the app. ' +
      'Category ids come from platform-skill-category-list.',
    method: 'POST',
    path: '/api/platform/skills',
    body: createPlatformSkillSchema,
    load: () => import('@/app/api/platform/skills/route'),
  },
  {
    name: 'platform-skill-update',
    domain: 'platform',
    summary: 'Edit or publish a platform skill',
    description:
      'Changes any field of a platform skill, including `published` and `categoryId` (null removes the category). ' +
      'Send only the fields to change. An edit reaches every office running the skill at once, so the person ' +
      'decides it: the door asks them. Skill ids come from platform-skill-list.',
    method: 'PATCH',
    path: '/api/platform/skills/[skillId]',
    params: skillParams,
    body: patchPlatformSkillSchema,
    idempotent: true,
    personDecides: true,
    requiresPersonConfirmation: IN_SKILLS_VIEW,
    load: () => import('@/app/api/platform/skills/[skillId]/route'),
  },
  {
    name: 'platform-skill-delete',
    domain: 'platform',
    summary: 'Delete a platform skill',
    description:
      'Removes a skill from the platform catalog for every organization; the person decides it. Skill ids come from ' +
      'platform-skill-list. Prefer platform-skill-update with `published: false` to withdraw it reversibly.',
    method: 'DELETE',
    path: '/api/platform/skills/[skillId]',
    params: skillParams,
    destructive: true,
    personDecides: true,
    requiresPersonConfirmation: IN_SKILLS_VIEW,
    load: () => import('@/app/api/platform/skills/[skillId]/route'),
  },
] as const satisfies readonly AgentOperation[]
