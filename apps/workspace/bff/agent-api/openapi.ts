import type { z } from 'zod'
import { type JsonSchemaNode, toJsonSchema } from '@/lib/api/zod-json-schema'
import { isExposedTo } from './exposure'
import { MCP_PATH } from './mcp-config'
import { type AgentOperation, annotationsOf, pathParams } from './operation'
import { PRODUCT_NAME } from '@/lib/brand'

export type OpenApiDocument = Record<string, unknown>

const ERROR_RESPONSES = {
  '400': 'The input failed the route’s own validation (bad JSON, schema violation, invalid parameter).',
  '401': 'No valid session.',
  '403': 'Signed in, but the person may not do this here.',
  '404': 'The resource does not exist, or the person may not see it.',
  '429': 'Rate limited. Wait for the `Retry-After` header before calling again.',
} as const

const ERROR_ENVELOPE: JsonSchemaNode = {
  type: 'object',
  description:
    'The error body every route answers with (`errorResponse` in lib/api/handler.ts). ' +
    'The same request id is sent in the `x-request-id` header.',
  properties: {
    error: { type: 'string', description: 'A human-readable message.' },
    code: { type: 'string', description: 'A machine-readable code such as BAD_REQUEST, FORBIDDEN or NOT_FOUND.' },
    details: { description: 'Optional machine-readable details; the shape depends on the code.' },
    requestId: { type: 'string', description: 'The request id, for support and log correlation.' },
  },
  required: ['error', 'code', 'requestId'],
  additionalProperties: true,
}

const UNDESCRIBABLE: JsonSchemaNode = {
  description: 'Shape not describable here; the route validates it.',
}

function schemaOf(schema: z.ZodType): JsonSchemaNode {
  try {
    return toJsonSchema(schema)
  } catch {
    return UNDESCRIBABLE
  }
}

export function openApiPath(path: string): string {
  return path.replace(/\[(?:\.\.\.)?([^\]]+)\]/g, '{$1}')
}

interface ParameterObject {
  name: string
  in: 'path' | 'query'
  required: boolean
  description?: string
  schema: JsonSchemaNode
}

function fieldsOf(schema: z.ZodObject | undefined): Array<[string, z.ZodType]> {
  return schema ? (Object.entries(schema.shape) as Array<[string, z.ZodType]>) : []
}

function pathParameters(op: AgentOperation): ParameterObject[] {
  const declared = new Map(fieldsOf(op.params))
  return pathParams(op.path).map((name) => {
    const field = declared.get(name)
    const parameter: ParameterObject = {
      name,
      in: 'path',
      required: true,
      schema: field ? schemaOf(field) : { type: 'string' },
    }
    if (field?.description) parameter.description = field.description
    return parameter
  })
}

function queryParameters(op: AgentOperation): ParameterObject[] {
  if (!op.query) return []
  const node = schemaOf(op.query)
  const required = new Set(Array.isArray(node.required) ? (node.required as string[]) : [])
  const properties = (node.properties ?? {}) as Record<string, JsonSchemaNode>
  return fieldsOf(op.query).map(([name, field]) => {
    const parameter: ParameterObject = {
      name,
      in: 'query',
      required: required.has(name),
      schema: properties[name] ?? UNDESCRIBABLE,
    }
    if (field.description) parameter.description = field.description
    return parameter
  })
}

function errorResponseComponents(): Record<string, JsonSchemaNode> {
  return Object.fromEntries(
    Object.entries(ERROR_RESPONSES).map(([status, description]) => [
      `Error${status}`,
      {
        description,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
      },
    ]),
  )
}

function errorResponses(): Record<string, JsonSchemaNode> {
  return Object.fromEntries(
    Object.keys(ERROR_RESPONSES).map((status) => [status, { $ref: `#/components/responses/Error${status}` }]),
  )
}

function formFieldsOf(body: z.ZodType): Record<string, JsonSchemaNode> {
  const node = schemaOf(body)
  const fields = (node.properties as Record<string, JsonSchemaNode> | undefined)?.fields
  return { ...((fields?.properties as Record<string, JsonSchemaNode> | undefined) ?? {}) }
}

function requestBodyOf(op: AgentOperation, body: z.ZodType): JsonSchemaNode {
  const required = !body.isOptional()
  if (op.bodyEncoding === 'multipart') {
    const fields = formFieldsOf(body)
    const requiredFields = (schemaOf(body).properties as Record<string, JsonSchemaNode> | undefined)?.fields?.required
    return {
      required,
      description:
        'A multipart form: the file in the `file` part, the route’s text fields as their own parts. ' +
        'Over MCP send body.files[0] = { name, mimeType, contentBase64 } and body.fields instead.',
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            properties: { file: { type: 'string', format: 'binary' }, ...fields },
            required: ['file', ...(Array.isArray(requiredFields) ? requiredFields : [])],
          },
        },
      },
    }
  }
  if (op.bodyEncoding === 'raw') {
    return {
      required,
      description: 'The raw bytes of the request. Over MCP send them as body.contentBase64.',
      content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
    }
  }
  return { required, content: { 'application/json': { schema: schemaOf(body) } } }
}

function successResponse(op: AgentOperation): JsonSchemaNode {
  if (op.binaryResponse) {
    return {
      description:
        'Success. The body is a file; the media type depends on the request (a text format such as Markdown or CSV is returned as ' +
        'text). Over MCP it arrives as an embedded resource up to 5 MiB and is described, not sent, above that. ' +
        'A redirect to a time-limited link is handed on as a resource link and never followed.',
      content: Object.fromEntries(
        [...op.binaryResponse, 'text/plain'].map((type) => [type, { schema: { type: 'string', format: 'binary' } }]),
      ),
    }
  }
  return {
    description:
      'Success. The body is the route’s JSON answer; no response schema is declared for it yet, ' +
      'so read the operation description for what it contains.',
    content: { 'application/json': { schema: {} } },
  }
}

function operationObject(op: AgentOperation): JsonSchemaNode {
  const operation: JsonSchemaNode = {
    operationId: op.name,
    summary: op.summary,
    description: op.description,
    tags: [op.domain],
  }
  const parameters = [...pathParameters(op), ...queryParameters(op)]
  if (parameters.length > 0) operation.parameters = parameters
  if (op.body) {
    operation.requestBody = requestBodyOf(op, op.body)
  }
  operation.responses = {
    '200': successResponse(op),
    ...errorResponses(),
  }
  if (op.sensitivity) operation['x-sensitivity'] = op.sensitivity
  operation['x-mcp-annotations'] = annotationsOf(op)
  return operation
}

function pathsOf(operations: readonly AgentOperation[]): Record<string, Record<string, JsonSchemaNode>> {
  const paths: Record<string, Record<string, JsonSchemaNode>> = {}
  for (const op of operations) {
    const path = openApiPath(op.path)
    const item = (paths[path] ??= {})
    item[op.method.toLowerCase()] = operationObject(op)
  }
  return paths
}

export function documentedOperations(
  operations: readonly AgentOperation[],
  { platformStaff }: { platformStaff: boolean },
): readonly AgentOperation[] {
  return operations.filter((op) => isExposedTo('external', op.name) || (platformStaff && isExposedTo('platform', op.name)))
}

const SESSION_COOKIE = 'wos-session'

export function buildOpenApiDocument(
  operations: readonly AgentOperation[],
  { serverUrl }: { serverUrl: string },
): OpenApiDocument {
  const domains = [...new Set(operations.map((op) => op.domain))]
  return {
    openapi: '3.1.0',
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    info: {
      title: PRODUCT_NAME + ' workspace API',
      version: '1',
      description:
        PRODUCT_NAME + ' is the workspace for architects: a planning office runs its projects, documents and ' +
        'processes in it, and ' + PRODUCT_NAME + ', the agent, works in that office as a colleague. This document ' +
        'describes what an agent or a script can do there, acting as a signed-in person: every ' +
        'operation is a route the ' + PRODUCT_NAME + ' app itself calls, under the same permissions. These paths ' +
        'accept the app\u2019s signed-in session; an agent calls every operation as an MCP tool at ' +
        `${MCP_PATH}, by the same name as its operationId, with an OAuth token.`,
    },
    servers: [{ url: serverUrl }],
    security: [{ sessionCookie: [] }],
    tags: domains.map((name) => ({ name })),
    paths: pathsOf(operations),
    components: {
      securitySchemes: {
        sessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: SESSION_COOKIE,
          description:
            'The ' + PRODUCT_NAME + ' app\u2019s signed-in session (WorkOS AuthKit), as a browser holds it. A session too large for one ' +
            `cookie is split into ${SESSION_COOKIE}.0, ${SESSION_COOKIE}.1 and so on; send every one. A bearer token is not accepted ` +
            `here: an agent holds an OAuth token for the MCP server at ${MCP_PATH} and calls the operations there.`,
        },
      },
      schemas: { ErrorEnvelope: ERROR_ENVELOPE },
      responses: errorResponseComponents(),
    },
  }
}
