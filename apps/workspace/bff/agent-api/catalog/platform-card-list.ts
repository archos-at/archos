import type { AgentOperation } from '../operation'

export const platformCardListOperations = [
  {
    name: 'platform-card-list',
    domain: 'platform',
    summary: 'List the card types the agent can render',
    description:
      'Every card type the agent can render, with the fields each shows and a worked example, plus the link for requesting a ' +
      'card that does not exist yet. Derived from the backend, so it matches what the product renders.',
    method: 'GET',
    path: '/api/platform/cards',
    load: () => import('@/app/api/platform/cards/route'),
  },
] as const satisfies readonly AgentOperation[]
