/**
 * @vitest-environment node
 */

import { afterEach, describe, expect, it } from 'vitest'
import { conversationFramesAvailable, decodeConversationFrame } from './conversation-frames'

const EVENT = {
  v: 2,
  type: 'TEXT_MESSAGE_CONTENT',
  conversation_id: 'conv_1',
  turn_id: 'msg_1',
  seq: 7,
  ts: 1759000000100,
  message_id: 'a1',
  delta: 'Hi',
}

function envelope(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    v: 1,
    conv: 'conv_1',
    seq: 7,
    origin: 'aiq-agent-0:abc123',
    type: 'frame',
    payload: EVENT,
    ...overrides,
  })
}

describe('decodeConversationFrame', () => {
  it('unwraps a frame envelope into the v2 event, verbatim', () => {
    expect(decodeConversationFrame(envelope())).toEqual({ payload: EVENT })
  })

  it('relays a terminal envelope too', () => {
    expect(decodeConversationFrame(envelope({ type: 'turn_end' }))?.payload).toEqual(EVENT)
  })

  it('drops anything that is not a v2 event: there is no second reader', () => {
    for (const payload of [
      { type: 'system_response_message', status: 'in_progress', content: { text: 'Hi' } },
      { ...EVENT, v: 1 },
      ['not', 'an', 'object'],
      'a string',
    ]) {
      expect(decodeConversationFrame(envelope({ payload }))).toBeNull()
    }
  })

  it('drops control envelopes that are not frames', () => {
    for (const type of ['hitl_answer', 'cancel', 'supersede', 'reconnect']) {
      expect(decodeConversationFrame(envelope({ type }))).toBeNull()
    }
  })

  it('drops malformed input rather than throwing', () => {
    for (const raw of ['', 'not json', '[]', 'null', '"a string"', '{}']) {
      expect(decodeConversationFrame(raw)).toBeNull()
    }
  })

  it('drops an envelope with no payload', () => {
    expect(decodeConversationFrame(envelope({ payload: null }))).toBeNull()
  })
})

describe('conversationFramesAvailable', () => {
  const original = process.env.REDIS_URL

  afterEach(() => {
    if (original === undefined) delete process.env.REDIS_URL
    else process.env.REDIS_URL = original
  })

  it('is false with no shared cache tier, so the route can say so once', () => {
    delete process.env.REDIS_URL
    expect(conversationFramesAvailable()).toBe(false)
  })

  it('is true when one is configured', () => {
    process.env.REDIS_URL = 'redis://dragonfly:6379'
    expect(conversationFramesAvailable()).toBe(true)
  })
})
