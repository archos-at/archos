import { describe, expect, test } from 'vitest'
import { motionInstant, motionSheetEnter, motionSnap } from '@/components/motion'
import { welcomeEntrance } from './chat-area-helpers'

describe('welcomeEntrance', () => {
  test('a greeting that stands because the route changed fades on one short step and does not move', () => {
    const { initial, transition } = welcomeEntrance({ readerActed: false, reducedMotion: false })
    expect(initial).toEqual({ opacity: 0 })
    expect(transition).toBe(motionSnap)
    expect(motionSnap.duration).toBeLessThanOrEqual(0.12)
  })

  test('a new chat the reader pressed for rises with the composer', () => {
    const { initial, transition } = welcomeEntrance({ readerActed: true, reducedMotion: false })
    expect(initial).toEqual({ opacity: 0, y: 16 })
    expect(transition).toBe(motionSheetEnter)
  })

  test('reduced motion lands it in one frame either way', () => {
    for (const readerActed of [true, false]) {
      const { initial, transition } = welcomeEntrance({ readerActed, reducedMotion: true })
      expect(initial).toEqual({ opacity: 0 })
      expect(transition).toBe(motionInstant)
    }
  })
})
