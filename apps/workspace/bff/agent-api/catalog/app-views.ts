import { z } from 'zod'
import type { OperationName } from './index'
import { PRODUCT_NAME } from '@/lib/brand'

export const PROPOSAL_CARD_URI = 'ui://workspace/proposal-card'

export interface AppView {
  readonly uri: string
  readonly name: string
  readonly title: string
  readonly description: string
  readonly file: string
  readonly drawsResultOf: readonly OperationName[]
}

export const APP_VIEWS = [
  {
    uri: PROPOSAL_CARD_URI,
    name: 'proposal-card',
    title: PRODUCT_NAME + ' proposal',
    description:
      PRODUCT_NAME + '’s card for one proposed change, drawn from the proposal-get result: what it would do, and Apply and Discard for the person.',
    file: 'proposal-card.html',
    drawsResultOf: ['proposal-get'],
  },
] as const satisfies readonly AppView[]

const proposalIdArgument = z.guid().describe('The proposal id, from the proposal-get result the card shows.')

export interface AppTool {
  readonly name: string
  readonly view: (typeof APP_VIEWS)[number]['uri']
  readonly operation: OperationName
  readonly title: string
  readonly description: string
  readonly input: z.ZodObject
  readonly sendsBody: boolean
}

export const APP_TOOLS = [
  {
    name: 'proposal-card-apply',
    view: PROPOSAL_CARD_URI,
    operation: 'proposal-apply',
    title: 'Apply a proposal from its card',
    description:
      'Pressed by the person on the proposal card. Applies the proposal as the person through the proposal-apply route (409 if it was decided already).',
    input: z
      .object({
        id: proposalIdArgument,
        memoryScope: z.enum(['project']).optional().describe('A note: keep it in the project memory only.'),
      })
      .strict(),
    sendsBody: true,
  },
  {
    name: 'proposal-card-dismiss',
    view: PROPOSAL_CARD_URI,
    operation: 'proposal-dismiss',
    title: 'Discard a proposal from its card',
    description:
      'Pressed by the person on the proposal card. Discards the proposal through the proposal-dismiss route; nothing in the workspace changes.',
    input: z.object({ id: proposalIdArgument }).strict(),
    sendsBody: false,
  },
] as const satisfies readonly AppTool[]

export type AppToolName = (typeof APP_TOOLS)[number]['name']

export interface AppToolRefusal {
  readonly status: number
  readonly code?: string
}
