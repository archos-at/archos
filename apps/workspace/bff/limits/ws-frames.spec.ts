/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { classifyFrame, createFrameObserver } from './ws-frames.js'

interface Observed {
  opcode: number
  peek: string
  fragmented: boolean
  truncated: boolean
}

function frame(opcode: number, payload: string | Buffer = '', fin = true): Buffer {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8')
  const mask = Buffer.from([0x37, 0xfa, 0x21, 0x3d])
  const first = (fin ? 0x80 : 0x00) | opcode

  let header: Buffer
  if (body.length < 126) {
    header = Buffer.from([first, 0x80 | body.length])
  } else if (body.length < 65536) {
    header = Buffer.alloc(4)
    header[0] = first
    header[1] = 0x80 | 126
    header.writeUInt16BE(body.length, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = first
    header[1] = 0x80 | 127
    header.writeBigUInt64BE(BigInt(body.length), 2)
  }

  const masked = Buffer.from(body)
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4]
  return Buffer.concat([header, mask, masked])
}

function collect(chunks: Buffer[]): Observed[] {
  const seen: Observed[] = []
  const observer = createFrameObserver((f: Observed) => seen.push(f))
  for (const chunk of chunks) observer.push(chunk)
  return seen
}

const userMessage = JSON.stringify({ type: 'user_message', id: 'm1', content: { messages: [] } })
const interaction = JSON.stringify({ type: 'user_interaction_message', id: 'm2' })

describe('createFrameObserver', () => {
  it('reads a single text frame and unmasks enough to classify it', () => {
    const seen = collect([frame(0x1, userMessage)])

    expect(seen).toHaveLength(1)
    expect(seen[0].opcode).toBe(0x1)
    expect(seen[0].peek).toContain('"type":"user_message"')
  })

  it('reads several frames arriving in ONE chunk', () => {
    const seen = collect([
      Buffer.concat([frame(0x1, userMessage), frame(0x1, interaction), frame(0x9)]),
    ])

    expect(seen.map((f) => f.opcode)).toEqual([0x1, 0x1, 0x9])
    expect(seen[1].peek).toContain('user_interaction_message')
  })

  it('reads one frame split byte-by-byte across chunks', () => {
    const bytes = frame(0x1, userMessage)
    const seen = collect([...bytes].map((b) => Buffer.from([b])))

    expect(seen).toHaveLength(1)
    expect(seen[0].peek).toContain('"type":"user_message"')
  })

  it('stays in sync across a 126-byte extended length', () => {
    const long = 'x'.repeat(300)
    const seen = collect([Buffer.concat([frame(0x1, long), frame(0x1, userMessage)])])

    expect(seen).toHaveLength(2)
    expect(seen[1].peek).toContain('"type":"user_message"')
  })

  it('stays in sync across a 127-byte extended length', () => {
    const huge = 'y'.repeat(70_000)
    const seen = collect([Buffer.concat([frame(0x1, huge), frame(0x1, userMessage)])])

    expect(seen).toHaveLength(2)
    expect(seen[1].peek).toContain('"type":"user_message"')
  })

  it('caps how much of a payload it inspects', () => {
    const seen = collect([frame(0x1, 'z'.repeat(4000))])

    expect(seen[0].peek.length).toBeLessThanOrEqual(512)
    expect(seen[0].truncated).toBe(true)
  })

  it('reports a message that fit entirely in the window as untruncated', () => {
    const seen = collect([frame(0x1, userMessage)])

    expect(seen[0].truncated).toBe(false)
  })

  it('charges a padded SINGLE frame as a chat turn', () => {
    const padded = '{"padding":"' + 'p'.repeat(600) + '","type":"user_message"}'
    const seen = collect([frame(0x1, padded)])

    expect(seen).toHaveLength(1)
    expect(seen[0].peek).not.toContain('user_message')
    expect(classifyFrame(seen[0])).toBe('chat-turn')
  })

  it('still charges an honest small control message as cheap', () => {
    const seen = collect([frame(0x1, interaction)])

    expect(seen[0].truncated).toBe(false)
    expect(classifyFrame(seen[0])).toBe('control')
  })

  it('reports zero-length control frames', () => {
    const seen = collect([Buffer.concat([frame(0x9), frame(0xa), frame(0x8)])])

    expect(seen.map((f) => f.opcode)).toEqual([0x9, 0xa, 0x8])
  })
})

describe('classifyFrame', () => {
  it('charges a user message as a chat turn', () => {
    expect(
      classifyFrame({ opcode: 0x1, peek: userMessage, fragmented: false, truncated: false })
    ).toBe('chat-turn')
  })

  it('charges a message it read IN FULL and ruled out as cheap', () => {
    const cheap = { fragmented: false, truncated: false }
    expect(classifyFrame({ opcode: 0x1, peek: interaction, ...cheap })).toBe('control')
    expect(classifyFrame({ opcode: 0x1, peek: '{"typ', ...cheap })).toBe('control')
    expect(classifyFrame({ opcode: 0x2, peek: '', ...cheap })).toBe('control')
    expect(classifyFrame({ opcode: 0x9, peek: '', ...cheap })).toBe('control')
  })

  it('charges a message it could NOT read in full as a chat turn', () => {
    expect(
      classifyFrame({ opcode: 0x1, peek: '{"padding":"ppp', fragmented: false, truncated: true })
    ).toBe('chat-turn')
  })

  it('never throttles the close handshake', () => {
    expect(classifyFrame({ opcode: 0x8, peek: '', fragmented: false, truncated: false })).toBe(
      'ignore'
    )
  })
})

describe('fragmented messages', () => {
  it('classifies a message whose type only appears in a continuation', () => {
    const head = '{"padding":"' + 'p'.repeat(600) + '",'
    const tail = '"type":"user_message","id":"m1"}'
    const seen = collect([
      Buffer.concat([frame(0x1, head, false), frame(0x0, tail, true)]),
    ])

    expect(seen).toHaveLength(2)
    expect(seen.map(classifyFrame)).toEqual(['chat-turn', 'chat-turn'])
  })

  it('reports a continuation under its message opcode, not as opcode 0', () => {
    const seen = collect([
      Buffer.concat([frame(0x1, '{"type":', false), frame(0x0, '"user_message"}', true)]),
    ])

    expect(seen[1].opcode).toBe(0x1)
    expect(classifyFrame(seen[1])).toBe('chat-turn')
  })

  it('does not let a control frame between fragments reset the accumulator', () => {
    const seen = collect([
      Buffer.concat([
        frame(0x1, '{"type":', false),
        frame(0x9),
        frame(0x0, '"user_message"}', true),
      ]),
    ])

    expect(seen.map((f) => f.opcode)).toEqual([0x1, 0x9, 0x1])
    expect(classifyFrame(seen[2])).toBe('chat-turn')
  })

  it('starts a fresh message after FIN', () => {
    const seen = collect([
      Buffer.concat([
        frame(0x1, '{"type":"user_message"}', true),
        frame(0x1, '{"type":"user_interaction_message"}', true),
      ]),
    ])

    expect(classifyFrame(seen[0])).toBe('chat-turn')
    expect(classifyFrame(seen[1])).toBe('control')
  })

  it('stays in sync when a frame declares a huge 127-encoded length', () => {
    const header = Buffer.alloc(10)
    header[0] = 0x81
    header[1] = 0x80 | 127
    header.writeBigUInt64BE(BigInt(1_000_000), 2)
    const seen = collect([
      Buffer.concat([header, Buffer.from([0, 0, 0, 0]), Buffer.from('short')]),
    ])

    expect(seen).toHaveLength(0)
  })
})
