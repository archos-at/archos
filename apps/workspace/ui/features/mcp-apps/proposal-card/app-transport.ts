import type { App } from '@modelcontextprotocol/ext-apps/react-with-deps'
import type { CallToolResult } from '@modelcontextprotocol/client'
import { PROPOSAL_CARD_TOOLS_BY_ROLE } from './tool-names'
import { ProposalRequestError } from '@/lib/proposals/client'
import { proposalResponseSchema, type ApplyProposalRequest, type ProposalResponse } from '@/lib/proposals/types'
import type { ProposalTransport } from '@/features/cards/hooks/proposal-transport'

export function proposalOfResult(result: Partial<Pick<CallToolResult, 'structuredContent' | 'isError'>> | null | undefined): ProposalResponse | null {
  if (!result || result.isError) return null
  const parsed = proposalResponseSchema.safeParse(result.structuredContent)
  return parsed.success ? parsed.data : null
}

function refusalOf(result: CallToolResult): ProposalRequestError {
  const content = (result.structuredContent ?? {}) as { status?: unknown; code?: unknown }
  const status = typeof content.status === 'number' ? content.status : 500
  const code = typeof content.code === 'string' ? content.code : 'UNKNOWN'
  const text = result.content?.find((item: CallToolResult['content'][number]) => item.type === 'text')
  return new ProposalRequestError(status, code, text && 'text' in text ? text.text : `The call was refused (${status}).`)
}

type ToolCaller = Pick<App, 'callServerTool'>

async function call(app: ToolCaller, name: string, args: Record<string, unknown>): Promise<ProposalResponse> {
  const result = await app.callServerTool({ name, arguments: args })
  if (result.isError) throw refusalOf(result)
  const proposal = proposalOfResult(result)
  if (!proposal) throw new ProposalRequestError(502, 'UNREADABLE', `${name} answered without a proposal.`)
  return proposal
}

export function appProposalTransport(app: ToolCaller, initial: ProposalResponse | null): ProposalTransport {
  let seed = initial
  return {
    live: false,
    get: (id) => {
      if (seed && seed.proposal.id === id) {
        const first = seed
        seed = null
        return Promise.resolve(first)
      }
      return call(app, PROPOSAL_CARD_TOOLS_BY_ROLE.get, { params: { id } })
    },
    apply: (id, body?: ApplyProposalRequest) => {
      seed = null
      return call(app, PROPOSAL_CARD_TOOLS_BY_ROLE.apply, { id, ...(body?.memoryScope ? { memoryScope: body.memoryScope } : {}) })
    },
    dismiss: (id) => {
      seed = null
      return call(app, PROPOSAL_CARD_TOOLS_BY_ROLE.dismiss, { id })
    },
  }
}
