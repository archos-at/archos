import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseWireEvent, type WireEvent } from '@/adapters/api/wire-v2'

const fixtureDir = (): string => {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    const candidate = join(dir, 'contracts', 'wire', 'v2')
    if (existsSync(candidate)) return candidate
    if (dirname(dir) === dir) throw new Error(`contracts/wire/v2 not found above ${process.cwd()}`)
  }
}

const DIR = fixtureDir()

export const WIRE_TURN_FILES: string[] = readdirSync(DIR).filter((name) => /^turn-.*\.jsonl$/.test(name))

export const wireEvents = (name: string): WireEvent[] =>
  readFileSync(join(DIR, name), 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => eventOf(JSON.parse(line) as Record<string, unknown>))

export const frameOf = (seq: number, body: Record<string, unknown>, turnId = 'turn-1'): Record<string, unknown> => ({
  v: 2,
  conversation_id: 'conv_1',
  turn_id: turnId,
  seq,
  ts: 1_759_000_000_000 + seq * 10,
  ...body,
})

export const eventOf = (raw: Record<string, unknown>): WireEvent => {
  const event = parseWireEvent(raw)
  if (!event) throw new Error(`not a v2 event: ${JSON.stringify(raw).slice(0, 200)}`)
  return event
}

export const wireFixtureLines = <T>(name: string): T[] =>
  readFileSync(join(DIR, name), 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as T)
