import { z } from 'zod'
import {
  modelDefaultsPutSchema,
  pricingPutSchema,
  reasoningEffortsPutSchema,
  retrievalSettingsPutSchema,
} from '@/lib/platform/platform-wire'
import type { AgentOperation } from '../operation'

export const platformFleetSettingsOperations = [
  {
    name: 'platform-model-defaults-get',
    domain: 'platform',
    summary: 'Read the fleet-wide default models',
    description:
      'The model each agent group runs by default for every organization, who set it, whether it is zero-data-retention safe, ' +
      'and the YAML fallback. Read it before platform-model-defaults-update, which replaces the whole set.',
    method: 'GET',
    path: '/api/platform/model-defaults',
    load: () => import('@/app/api/platform/model-defaults/route'),
  },
  {
    name: 'platform-model-defaults-update',
    domain: 'platform',
    summary: 'Set the fleet-wide default models',
    description:
      'Replaces the complete set of default models, one OpenRouter `author/slug` id per agent group. This moves every ' +
      'organization at once: each id is revalidated against the live catalog and the ZDR list, and the change is audited. ' +
      'Groups left out are cleared back to the YAML. Find ids with platform-model-search.',
    method: 'PUT',
    path: '/api/platform/model-defaults',
    body: modelDefaultsPutSchema,
    destructive: true,
    load: () => import('@/app/api/platform/model-defaults/route'),
  },
  {
    name: 'platform-model-search',
    domain: 'platform',
    summary: 'Search models allowed for an agent group',
    description:
      'Searches the OpenRouter catalog for models a given agent group may use under the platform’s ZDR rule. ' +
      'Agent group ids are the keys platform-model-defaults-get returns. Use the ids it returns in platform-model-defaults-update.',
    method: 'GET',
    path: '/api/platform/model-defaults/models',
    query: z.object({
      group: z.string().describe('The agent group id, from platform-model-defaults-get `agentGroups`.'),
      q: z.string().optional().describe('Search text over model names and ids.'),
    }),
    load: () => import('@/app/api/platform/model-defaults/models/route'),
  },
  {
    name: 'platform-reasoning-efforts-get',
    domain: 'platform',
    summary: 'Read the fleet-wide reasoning efforts',
    description:
      'The reasoning effort set per agent group for every organization, with the YAML fallback. ' +
      'Read it before platform-reasoning-efforts-update, which replaces the whole set.',
    method: 'GET',
    path: '/api/platform/reasoning-efforts',
    load: () => import('@/app/api/platform/reasoning-efforts/route'),
  },
  {
    name: 'platform-reasoning-efforts-update',
    domain: 'platform',
    summary: 'Set the fleet-wide reasoning efforts',
    description:
      'Replaces the complete reasoning-effort set per agent group; groups left out return to the YAML. Lowering effort is ' +
      'the lever for a run that burns tokens. Applies to every organization and is audited.',
    method: 'PUT',
    path: '/api/platform/reasoning-efforts',
    body: reasoningEffortsPutSchema,
    destructive: true,
    load: () => import('@/app/api/platform/reasoning-efforts/route'),
  },
  {
    name: 'platform-retrieval-settings-get',
    domain: 'platform',
    summary: 'Read the fleet-wide retrieval settings',
    description:
      'The retrieval depth settings (how many chunks each stage fetches): their definitions and the values currently saved. ' +
      'Read it before platform-retrieval-settings-update.',
    method: 'GET',
    path: '/api/platform/retrieval-settings',
    load: () => import('@/app/api/platform/retrieval-settings/route'),
  },
  {
    name: 'platform-retrieval-settings-update',
    domain: 'platform',
    summary: 'Set the fleet-wide retrieval settings',
    description:
      'Replaces the complete retrieval settings map `{key: count}`; omitted keys are cleared to their defaults. ' +
      'Shifts recall and token spend for every organization and is audited. Keys come from platform-retrieval-settings-get.',
    method: 'PUT',
    path: '/api/platform/retrieval-settings',
    body: retrievalSettingsPutSchema,
    destructive: true,
    load: () => import('@/app/api/platform/retrieval-settings/route'),
  },
  {
    name: 'platform-pricing-get',
    domain: 'platform',
    summary: 'Read the price list',
    description:
      'The current pricing version (margin multiplier, USD per credit, default organization allowances), its bounds and a ' +
      'reference request. Read it before platform-pricing-update.',
    method: 'GET',
    path: '/api/platform/pricing',
    load: () => import('@/app/api/platform/pricing/route'),
  },
  {
    name: 'platform-pricing-update',
    domain: 'platform',
    summary: 'Publish a new price list',
    description:
      'Saves a new pricing version: margin multiplier, USD per credit and the default daily and monthly credit allowances ' +
      '(null for none). It reprices every organization’s next generation and is audited; the previous version is kept.',
    method: 'PUT',
    path: '/api/platform/pricing',
    body: pricingPutSchema,
    destructive: true,
    idempotent: false,
    load: () => import('@/app/api/platform/pricing/route'),
  },
] as const satisfies readonly AgentOperation[]
