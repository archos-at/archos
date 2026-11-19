import type { InboundMailView } from '@/lib/inbound-mail/inbound-mail-wire'

export interface Landing {
  view: InboundMailView
  filed: string[]
  failed: string[]
  quota: boolean
  pending: boolean
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export async function awaitLanding(
  sent: InboundMailView,
  partIds: readonly string[],
  read: () => Promise<InboundMailView | null>,
  { pollMs = 1500, rounds = 40, wait = sleep }: { pollMs?: number; rounds?: number; wait?: (ms: number) => Promise<void> } = {},
): Promise<Landing> {
  const wanted = new Set(partIds)
  const filing = (view: InboundMailView) => view.parts.some((part) => wanted.has(part.id) && part.state === 'filing')
  let current = sent
  let delay = pollMs
  for (let round = 0; round < rounds && filing(current); round += 1) {
    await wait(delay)
    delay = Math.min(delay * 1.5, 5000)
    current = (await read().catch(() => null)) ?? current
  }
  const parts = current.parts.filter((part) => wanted.has(part.id))
  const failed = parts.filter((part) => part.state === 'waiting' && part.lastFailure !== null)
  return {
    view: current,
    filed: parts.filter((part) => part.state === 'filed').map((part) => part.id),
    failed: failed.map((part) => part.id),
    quota: failed.some((part) => part.lastFailure === 'quota'),
    pending: filing(current),
  }
}
