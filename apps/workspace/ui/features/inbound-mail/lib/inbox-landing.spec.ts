import { describe, expect, it, vi } from 'vitest'
import { mail, messagePart, part } from '@/app/dev/inbound-mail/fixtures'
import { awaitLanding } from './inbox-landing'

const message = messagePart({ id: 'm' })
const file = part({ name: 'Plan.pdf', id: 'f' })
const sent = mail({ key: 'landing', parts: [{ ...message, state: 'filing' }, { ...file, state: 'filing' }] })
const wait = () => Promise.resolve()

describe('awaitLanding', () => {
  it('reads the mail again until its parts land, and says which did', async () => {
    const landed = { ...sent, parts: [{ ...message, state: 'filed' as const }, { ...file, state: 'filed' as const }] }
    const read = vi.fn().mockResolvedValueOnce(sent).mockResolvedValueOnce(landed)
    const result = await awaitLanding(sent, ['m', 'f'], read, { wait })
    expect(read).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ filed: ['m', 'f'], failed: [], pending: false })
  })

  it('reports a part that came back with a failure, and a full store', async () => {
    const failed = { ...sent, parts: [{ ...message, state: 'filed' as const }, { ...file, state: 'waiting' as const, lastFailure: 'quota' as const }] }
    const result = await awaitLanding(sent, ['m', 'f'], () => Promise.resolve(failed), { wait })
    expect(result).toMatchObject({ filed: ['m'], failed: ['f'], quota: true, pending: false })
  })

  it('gives up after its rounds and says it is still on its way', async () => {
    const result = await awaitLanding(sent, ['m'], () => Promise.reject(new Error('down')), { wait, rounds: 3 })
    expect(result.pending).toBe(true)
  })
})
