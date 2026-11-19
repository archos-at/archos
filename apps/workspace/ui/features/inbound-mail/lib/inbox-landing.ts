import type { InboundMailView } from '@/lib/inbound-mail/inbound-mail-wire'
import { filedLines } from './filed'

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

export interface LandedPlaces {
  mails: number
  failed: number
  pending: number
  threads: Array<{ name: string; count: number }>
  folders: Array<{ name: string; count: number }>
  documentIds: string[]
}

export function landedPlaces(landings: readonly Landing[], rootLabel: string): LandedPlaces {
  const threads = new Map<string, number>()
  const folders = new Map<string, number>()
  const documents = new Set<string>()
  for (const landing of landings) {
    for (const line of filedLines(landing.view.parts, landing.filed, rootLabel)) {
      const tally = line.kind === 'message' ? threads : folders
      const key = line.kind === 'message' ? line.place.name : line.place.folder
      tally.set(key, (tally.get(key) ?? 0) + 1)
    }
    for (const part of landing.view.parts) if (landing.filed.includes(part.id) && part.documentId) documents.add(part.documentId)
  }
  const sorted = (tally: Map<string, number>) => [...tally].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  return {
    mails: landings.filter((landing) => landing.filed.length > 0).length,
    failed: landings.filter((landing) => landing.failed.length > 0).length,
    pending: landings.filter((landing) => landing.pending).length,
    threads: sorted(threads),
    folders: sorted(folders),
    documentIds: [...documents],
  }
}
