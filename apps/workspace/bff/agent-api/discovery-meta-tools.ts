import 'server-only'

import { isAgentKind } from '@/lib/agent-kind'
import type { JsonSchemaNode } from '@/lib/api/zod-json-schema'
import { PRODUCT_NAME } from '@/lib/brand'
import { FRICTION_CATEGORIES } from './discovery-missing-report'
import { DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT, MAX_SEARCH_QUERY_LENGTH } from './discovery-search'
import { type AgentDoor, doorOfPrincipal, visibleDomains } from './policy'
import type { AgentPrincipal } from './principal'

export interface MetaTool {
  readonly title: string
  readonly description: string
  readonly inputSchema: JsonSchemaNode
  readonly readOnly: boolean
}

export type MetaToolName = 'search-operations' | 'describe-operation' | 'call-operation' | 'report-missing-operation'

const SEARCH_SCOPE: Readonly<Record<AgentDoor, { area: string; example: string; operation: string }>> = {
  office: {
    area:
      'the ' + PRODUCT_NAME + ' workspace (projects, members, documents and their versions, review, the inbox, tasks, building-law ' +
      'knowledge, BIM models)',
    example: 'add project member',
    operation: 'project-list',
  },
  platform: {
    area:
      'the ' + PRODUCT_NAME + ' platform console (organizations and their limits, fleet-wide models, reasoning, retrieval and pricing, ' +
      'the base knowledge corpus, platform skills, lessons, feedback and quality views, maintenance)',
    example: 'set default models',
    operation: 'platform-overview-get',
  },
}

export function metaToolsFor(principal: Pick<AgentPrincipal, 'actor' | 'door'>): Record<MetaToolName, MetaTool> {
  const piloti = isAgentKind(principal.actor)
  const door = doorOfPrincipal(principal)
  const scope = SEARCH_SCOPE[door]
  const flatTools =
    piloti || door !== 'office' ? '' : '; the agent read tools such as knowledge-search take their own arguments flat in `input` instead'
  const writes = piloti
    ? 'A write is never run: the result says "Proposed" and nothing changed, because the person decides on a card. Say in one ' +
      'sentence what is proposed, and never claim it is done.'
    : 'Destructive operations are marked in search and describe results; confirm those with the person first.'
  return {
    'search-operations': {
      title: 'Search operations',
      description:
        `Find what can be done in ${scope.area} by plain words, ranked over each operation's name, summary and description. Start here. Answers ` +
        'operation names with one line each and whether each reads, writes or destroys. Then call-operation.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            maxLength: MAX_SEARCH_QUERY_LENGTH,
            description: `The goal in a few plain words, e.g. "${scope.example}". Empty lists everything, or a whole domain.`,
          },
          domain: { type: 'string', enum: [...visibleDomains(door)], description: 'Only operations of this area.' },
          limit: { type: 'integer', minimum: 1, maximum: MAX_SEARCH_LIMIT, description: `At most this many (default ${DEFAULT_SEARCH_LIMIT}).` },
        },
        required: ['query'],
        additionalProperties: false,
      },
      readOnly: true,
    },
    'describe-operation': {
      title: 'Describe an operation',
      description:
        'One operation\'s description, annotations and input JSON Schema ({ params, query, body }), by the exact name ' +
        'search-operations returned. Call it before the first call of an operation whose input you do not know. An unknown ' +
        'name comes back with similar names. A very large input comes back as an outline; pass field to open one part.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: `An operation name, e.g. ${scope.operation}.` },
          field: {
            type: 'string',
            maxLength: 200,
            description: 'Dot path into the input schema, e.g. "body.files": returns just that part. For an outline\'s large fields.',
          },
        },
        required: ['name'],
        additionalProperties: false,
      },
      readOnly: true,
    },
    'call-operation': {
      title: 'Call an operation',
      description:
        'Run one operation as the signed-in person, with that person\'s rights. `input` is { params, query, body } as ' +
        `describe-operation shows it (params: path ids; query: the query string; body: the JSON body)${flatTools}. ` +
        'Input that does not fit comes back with the reason. A refusal names the reason and the next step; do not repeat ' +
        `the same call. ${writes}`,
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'An operation name from search-operations.' },
          input: { type: 'object', description: 'The operation\'s input, as describe-operation shows it.' },
        },
        required: ['name'],
        additionalProperties: false,
      },
      readOnly: false,
    },
    'report-missing-operation': {
      title: 'Report a missing operation',
      description:
        'Count a gap: the person wants something done in the workspace and search-operations found no operation for it with ' +
        'two different phrasings. Also for friction with an operation you did find: set category to tool_description, ' +
        'input_schema, error_message or result_shape when one was confusing. The ' + PRODUCT_NAME + ' team sees that a report was made ' +
        'and its category, never your words, so describe the goal or the confusion without names or document contents. ' +
        'For a gap, then tell the person it cannot be done here yet.',
      inputSchema: {
        type: 'object',
        properties: {
          description: { type: 'string', minLength: 1, maxLength: 2000, description: 'The goal that has no operation, or what was confusing.' },
          category: { type: 'string', enum: [...FRICTION_CATEGORIES], description: 'What the report is about (default missing_operation).' },
        },
        required: ['description'],
        additionalProperties: false,
      },
      readOnly: false,
    },
  }
}
