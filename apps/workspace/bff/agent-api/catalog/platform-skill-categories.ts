import { z } from 'zod'
import { createCategorySchema, patchCategorySchema } from '@/lib/skills/types'
import type { AgentOperation } from '../operation'

const categoryParams = z.object({
  categoryId: z.string().describe('The platform skill category id, from platform-skill-category-list.'),
})

export const platformSkillCategoryOperations = [
  {
    name: 'platform-skill-category-list',
    domain: 'platform',
    summary: 'List the platform skill categories',
    description: 'The categories that group platform skills, with ids and sort order. Ids feed the `categoryId` of a skill.',
    method: 'GET',
    path: '/api/platform/skill-categories',
    load: () => import('@/app/api/platform/skill-categories/route'),
  },
  {
    name: 'platform-skill-category-create',
    domain: 'platform',
    summary: 'Create a platform skill category',
    description: 'Adds a category for grouping platform skills. Returns it with its id; assign skills to it with platform-skill-update.',
    method: 'POST',
    path: '/api/platform/skill-categories',
    body: createCategorySchema,
    load: () => import('@/app/api/platform/skill-categories/route'),
  },
  {
    name: 'platform-skill-category-update',
    domain: 'platform',
    summary: 'Edit a platform skill category',
    description:
      'Renames a category or changes its description or sort order. Send only the fields to change. ' +
      'Category ids come from platform-skill-category-list.',
    method: 'PATCH',
    path: '/api/platform/skill-categories/[categoryId]',
    params: categoryParams,
    body: patchCategorySchema,
    idempotent: true,
    load: () => import('@/app/api/platform/skill-categories/[categoryId]/route'),
  },
  {
    name: 'platform-skill-category-delete',
    domain: 'platform',
    summary: 'Delete a platform skill category',
    description:
      'Removes a skill category. Category ids come from platform-skill-category-list; check which skills use it first.',
    method: 'DELETE',
    path: '/api/platform/skill-categories/[categoryId]',
    params: categoryParams,
    destructive: true,
    load: () => import('@/app/api/platform/skill-categories/[categoryId]/route'),
  },
] as const satisfies readonly AgentOperation[]
