import { type AgentCard, AgentCard as AgentCardCodec } from '@a2a-js/sdk'
import { duplicateInterfacesForLegacy } from '@a2a-js/sdk/compat/v0_3'
import { a2aResourceUrl, authkitIssuer, MCP_SCOPES_SUPPORTED, mcpResourceUrl } from '@/lib/agent-api/mcp-config'
import { PRODUCT_NAME } from '@/lib/brand'
import { ASK_WAIT_SECONDS } from '@/lib/agent-asks/ask-wire'

export const A2A_SECURITY_SCHEME = 'workos-authkit'

export const A2A_VERSIONS = ['1.0', '0.3'] as const

type Env = Record<string, string | undefined>

export function a2aEndpointUrl(env: Env = process.env): URL | null {
  return a2aResourceUrl(env)
}

export function buildAgentCard(env: Env = process.env): AgentCard | null {
  const issuer = authkitIssuer(env)
  const mcpResource = mcpResourceUrl(env)
  const endpoint = a2aEndpointUrl(env)
  if (!issuer || !mcpResource || !endpoint) return null
  const scopes = Object.fromEntries(MCP_SCOPES_SUPPORTED.map((scope) => [scope, scope]))
  return {
    name: PRODUCT_NAME,
    description:
      `${PRODUCT_NAME} is the workspace for architects: a planning office runs its projects and processes in it, and ` +
      `${PRODUCT_NAME}, the agent, is a colleague in that office. Ask it what you would ask a colleague who knows the ` +
      'office’s documents, the project’s files and building law; it answers as the person you act for, with ' +
      'their rights, and may file a document.',
    supportedInterfaces: duplicateInterfacesForLegacy(
      [{ url: endpoint.href, protocolBinding: 'JSONRPC', tenant: '', protocolVersion: '1.0' }],
      ['JSONRPC'],
    ),
    provider: { organization: PRODUCT_NAME, url: endpoint.origin },
    version: '1.0.0',
    capabilities: { streaming: true, pushNotifications: false, extensions: [], extendedAgentCard: false },
    securitySchemes: {
      [A2A_SECURITY_SCHEME]: {
        scheme: {
          $case: 'oauth2SecurityScheme',
          value: {
            description:
              `Sign in to ${PRODUCT_NAME} with WorkOS AuthKit (authorization code with PKCE). Request the token ` +
              `for the resource ${endpoint.href} (RFC 8707); a token for ${mcpResource.href}, the MCP door, is ` +
              'accepted too.',
            oauth2MetadataUrl: `${issuer}/.well-known/oauth-authorization-server`,
            flows: {
              flow: {
                $case: 'authorizationCode',
                value: {
                  authorizationUrl: `${issuer}/oauth2/authorize`,
                  tokenUrl: `${issuer}/oauth2/token`,
                  refreshUrl: `${issuer}/oauth2/token`,
                  scopes,
                  pkceRequired: true,
                },
              },
            },
          },
        },
      },
    },
    securityRequirements: [{ schemes: { [A2A_SECURITY_SCHEME]: { list: [] } } }],
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain', 'application/json'],
    skills: [
      {
        id: 'consult',
        name: `Ask ${PRODUCT_NAME}`,
        description:
          `A question or request for ${PRODUCT_NAME}, in German or English. ${PRODUCT_NAME} answers from the office’s documents, ` +
          'the project’s files and building law, as the signed-in person. To ask about a project, put its id in ' +
          `the message metadata as "projectId" (project-list on the MCP door names the ids): without it ${PRODUCT_NAME} ` +
          `answers for the office as a whole and reads no project's files. Send the task's contextId to follow up. A blocking ` +
          `call waits for the answer; with returnImmediately the task is "working" after at most ${ASK_WAIT_SECONDS} ` +
          `seconds and GetTask reads it later. An answer is an artifact of text; a document ${PRODUCT_NAME} filed is an ` +
          'artifact naming it.',
        tags: ['architecture', 'building law', 'project documents', 'planning office'],
        examples: [
          'Welche Brandschutzanforderungen stellt die OIB-Richtlinie 2 an ein Stiegenhaus der Gebäudeklasse 4?',
          'Summarize the open review comments in this project. (with metadata.projectId set to the project’s id)',
        ],
        inputModes: ['text/plain'],
        outputModes: ['text/plain', 'application/json'],
        securityRequirements: [],
      },
    ],
    signatures: [],
  }
}

export function agentCardJson(card: AgentCard): unknown {
  return AgentCardCodec.toJSON(card)
}

export function agentCardResponse(env: Env = process.env): Response {
  const card = buildAgentCard(env)
  if (!card) {
    return Response.json(
      { error: 'The agent door is not configured on this deployment (WORKOS_AUTHKIT_DOMAIN)' },
      { status: 503 },
    )
  }
  return Response.json(agentCardJson(card), {
    headers: { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=300' },
  })
}
