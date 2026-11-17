export const SEARCH_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    total: { type: 'integer', description: 'How many operations matched; operations holds the best of them.' },
    operations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          summary: { type: 'string' },
          domain: { type: 'string' },
          readOnly: { type: 'boolean' },
          destructive: { type: 'boolean' },
        },
        required: ['name', 'summary', 'domain', 'readOnly', 'destructive'],
      },
    },
    next: { type: 'string', description: 'What to do next.' },
  },
  required: ['total', 'operations', 'next'],
} as const

export const DESCRIBE_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    domain: { type: 'string' },
    summary: { type: 'string' },
    description: { type: 'string' },
    annotations: { type: 'object', description: 'The MCP tool annotations: readOnlyHint, destructiveHint, idempotentHint, openWorldHint.' },
    sensitivity: { type: ['string', 'null'], description: 'Why a call needs the person’s confirmation, or null.' },
    inputSchema: {
      type: 'object',
      description: 'JSON Schema of the `input` call-operation takes; an outline of the large fields when layered, or the subtree at `field`.',
    },
    field: { type: 'string', description: 'Set when the request named a field: inputSchema is that part of the input.' },
    layered: { type: 'boolean', description: 'True when inputSchema is an outline: each large field names its own describe-operation call.' },
  },
  required: ['name', 'domain', 'summary', 'description', 'annotations', 'sensitivity', 'inputSchema'],
} as const

export const REPORT_OUTPUT_SCHEMA = {
  type: 'object',
  properties: { status: { type: 'string', enum: ['recorded'] } },
  required: ['status'],
} as const

export const META_OUTPUT_SCHEMAS = {
  'search-operations': SEARCH_OUTPUT_SCHEMA,
  'describe-operation': DESCRIBE_OUTPUT_SCHEMA,
  'report-missing-operation': REPORT_OUTPUT_SCHEMA,
} as const
