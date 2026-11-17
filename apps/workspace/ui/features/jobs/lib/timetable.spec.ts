import { describe, expect, test } from 'vitest'
import {
  addDays,
  BLOCK_MINUTES,
  buildTimetable,
  DAY_MINUTES,
  gapMinutes,
  hourMarks,
  minuteOfDay,
  placeableSchedules,
  segmentIndexFor,
  segmentMinutes,
  seriesColorsFor,
  startOfWeek,
} from './timetable'
import type { Occurrence } from './occurrences'

const at = (weekStart: Date, day: number, hour: number, minute = 0, jobId = 'j1'): Occurrence => {
  const date = addDays(weekStart, day)
  date.setHours(hour, minute, 0, 0)
  return { jobId, at: date }
}

describe('startOfWeek', () => {
  test('a week starts on Monday — this product is German and so is its week', () => {
    const monday = startOfWeek(new Date(2026, 8, 16, 13, 45))
    expect(monday.getDay()).toBe(1)
    expect(monday.getDate()).toBe(14)
    expect([monday.getHours(), monday.getMinutes()]).toEqual([0, 0])
  })

  test('Sunday belongs to the week that started six days ago, not to the next one', () => {
    const monday = startOfWeek(new Date(2026, 8, 20, 23, 30))
    expect(monday.getDate()).toBe(14)
  })

  test('is idempotent — a Monday is already the start of its week', () => {
    const monday = startOfWeek(new Date(2026, 8, 14, 9, 0))
    expect(startOfWeek(monday).getTime()).toBe(monday.getTime())
  })
})

describe('buildTimetable columns', () => {
  const weekStart = startOfWeek(new Date(2026, 8, 14))

  test('lays out seven days, Monday first', () => {
    const { days } = buildTimetable([], weekStart)
    expect(days).toHaveLength(7)
    expect(days[0].date.getDay()).toBe(1)
    expect(days[6].date.getDay()).toBe(0)
  })

  test('puts a firing in the column of the calendar day it falls on', () => {
    const { days } = buildTimetable([at(weekStart, 2, 6)], weekStart)
    expect(days[2].blocks).toHaveLength(1)
    expect(days[2].blocks[0].startMinute).toBe(6 * 60)
    expect(days.filter((day) => day.blocks.length > 0)).toHaveLength(1)
  })

  test('drops anything outside the shown week rather than folding it into an edge', () => {
    const before = { jobId: 'j1', at: addDays(weekStart, -1) }
    const after = { jobId: 'j1', at: addDays(weekStart, 8) }
    const { days } = buildTimetable([before, after], weekStart)
    expect(days.every((day) => day.blocks.length === 0)).toBe(true)
  })
})

describe('lane packing', () => {
  const weekStart = startOfWeek(new Date(2026, 8, 14))

  test('firings at the same minute get one column each, all the same width', () => {
    const { days } = buildTimetable(
      [at(weekStart, 0, 6, 0, 'a'), at(weekStart, 0, 6, 0, 'b'), at(weekStart, 0, 6, 0, 'c')],
      weekStart,
    )
    const blocks = days[0].blocks
    expect(blocks.map((block) => block.lane).sort()).toEqual([0, 1, 2])
    expect(blocks.every((block) => block.lanes === 3)).toBe(true)
  })

  test('firings inside the block window still count as a collision', () => {
    const { days } = buildTimetable(
      [at(weekStart, 0, 6, 0, 'a'), at(weekStart, 0, 6, BLOCK_MINUTES - 1, 'b')],
      weekStart,
    )
    expect(days[0].blocks.every((block) => block.lanes === 2)).toBe(true)
  })

  test('firings a full block apart do not — each gets the whole column', () => {
    const { days } = buildTimetable(
      [at(weekStart, 0, 6, 0, 'a'), at(weekStart, 0, 6, BLOCK_MINUTES, 'b')],
      weekStart,
    )
    expect(days[0].blocks.every((block) => block.lanes === 1)).toBe(true)
  })

  test('ties break on the schedule id, so a re-render never reshuffles the columns', () => {
    const forwards = buildTimetable(
      [at(weekStart, 0, 6, 0, 'b'), at(weekStart, 0, 6, 0, 'a')],
      weekStart,
    )
    const backwards = buildTimetable(
      [at(weekStart, 0, 6, 0, 'a'), at(weekStart, 0, 6, 0, 'b')],
      weekStart,
    )
    expect(forwards.days[0].blocks.map((block) => block.jobId)).toEqual(['a', 'b'])
    expect(backwards.days[0].blocks.map((block) => block.jobId)).toEqual(['a', 'b'])
  })
})

describe('the hour band', () => {
  const weekStart = startOfWeek(new Date(2026, 8, 14))

  test('crops to the hours something happens in, padded by an hour either side', () => {
    const { segments, cropped } = buildTimetable(
      [at(weekStart, 0, 6), at(weekStart, 3, 8, 30)],
      weekStart,
    )
    expect(cropped).toBe(true)
    expect(segments).toEqual([{ start: 5 * 60, end: 10 * 60 }])
  })

  test('a morning and an afternoon become TWO segments, not one long emptiness', () => {
    const { segments } = buildTimetable(
      [at(weekStart, 0, 6), at(weekStart, 1, 16, 30)],
      weekStart,
    )
    expect(segments).toHaveLength(2)
    expect(segments[0].end).toBeLessThan(segments[1].start)
    expect(gapMinutes(segments, 0)).toBe(segments[1].start - segments[0].end)
  })

  test('a gap short enough to draw is drawn — the rhythm is the point', () => {
    const { segments } = buildTimetable(
      [at(weekStart, 0, 6), at(weekStart, 0, 8)],
      weekStart,
    )
    expect(segments).toHaveLength(1)
  })

  test('segments whose padding made them meet are merged, so no break covers nothing', () => {
    const { segments } = buildTimetable(
      [at(weekStart, 0, 6), at(weekStart, 0, 9, 30)],
      weekStart,
    )
    expect(segments).toHaveLength(1)
  })

  test('a single early schedule still gets a segment with shape around it', () => {
    const { segments } = buildTimetable([at(weekStart, 0, 6)], weekStart)
    expect(segmentMinutes(segments[0])).toBeGreaterThanOrEqual(3 * 60)
    expect(segments[0].start).toBeLessThan(6 * 60)
    expect(segments[0].end).toBeGreaterThan(6 * 60 + BLOCK_MINUTES)
  })

  test('fullDay overrides the crop AND the breaks, and says it is not cropped', () => {
    const { segments, cropped } = buildTimetable(
      [at(weekStart, 0, 6), at(weekStart, 1, 16, 30)],
      weekStart,
      true,
    )
    expect(segments).toEqual([{ start: 0, end: DAY_MINUTES }])
    expect(cropped).toBe(false)
  })

  test('an empty week is the whole day — there is nothing to crop to', () => {
    const { segments, cropped } = buildTimetable([], weekStart)
    expect(segments).toEqual([{ start: 0, end: DAY_MINUTES }])
    expect(cropped).toBe(false)
  })

  test('no segment ever runs past midnight at either end', () => {
    const { segments } = buildTimetable(
      [at(weekStart, 0, 0, 5), at(weekStart, 0, 23, 55)],
      weekStart,
    )
    expect(segments[0].start).toBe(0)
    expect(segments[segments.length - 1].end).toBe(DAY_MINUTES)
  })

  test('every placed block falls inside a segment — the grid draws all of them', () => {
    const { segments, days } = buildTimetable(
      [at(weekStart, 0, 6), at(weekStart, 1, 16, 30), at(weekStart, 2, 21)],
      weekStart,
    )
    for (const day of days) {
      for (const block of day.blocks) {
        expect(segmentIndexFor(segments, block.startMinute)).toBeGreaterThanOrEqual(0)
      }
    }
  })
})

describe('hourMarks', () => {
  test('one mark per hour, from the segment start, none past the end', () => {
    expect(hourMarks({ start: 5 * 60, end: 8 * 60 })).toEqual([300, 360, 420])
  })
})

describe('minuteOfDay', () => {
  test('counts from local midnight', () => {
    expect(minuteOfDay(new Date(2026, 8, 14, 6, 30))).toBe(390)
  })
})

describe('placeableSchedules', () => {
  const job = (
    id: string,
    over: Partial<{ scheduleCron: string | null; dueAt: string | null; enabled: boolean }> = {},
  ) => ({ id, scheduleCron: null, dueAt: null, enabled: true, ...over })

  test('a one-shot is on the week, exactly as a recurring task is', () => {
    const once = job('b', { dueAt: '2026-10-02T07:00:00.000Z' })
    const weekly = job('a', { scheduleCron: '0 6 * * 1' })
    expect(placeableSchedules([once, weekly]).map((j) => j.id)).toEqual(['a', 'b'])
  })

  test('a manual task has nowhere to go, and a paused one is not going', () => {
    const manual = job('a')
    const paused = job('b', { scheduleCron: '0 6 * * 1', enabled: false })
    expect(placeableSchedules([manual, paused])).toEqual([])
  })

  test('the order is the id, so a rename never moves a colour', () => {
    const jobs = [job('c', { scheduleCron: '0 6 * * 1' }), job('a', { scheduleCron: '0 7 * * 1' })]
    expect(placeableSchedules(jobs).map((j) => j.id)).toEqual(['a', 'c'])
  })
})

describe('seriesColorsFor', () => {
  const weekly = (id: string) => ({ id, scheduleCron: '0 6 * * 1', dueAt: null, enabled: true })

  test('a one-shot takes a slot rather than shifting everyone else’s', () => {
    const colors = seriesColorsFor(
      [weekly('a'), { id: 'b', scheduleCron: null, dueAt: '2026-10-02T07:00:00.000Z', enabled: true }, weekly('c')],
      8,
    )
    expect(colors.get('a')).toBe('var(--chart-series-1)')
    expect(colors.get('b')).toBe('var(--chart-series-2)')
    expect(colors.get('c')).toBe('var(--chart-series-3)')
  })

  test('past the palette everything shares one tone, and a manual task has none', () => {
    const many = Array.from({ length: 4 }, (_, i) => weekly(`job-${i}`))
    const colors = seriesColorsFor([...many, { id: 'manual', scheduleCron: null, dueAt: null, enabled: true }], 3)
    expect(colors.get('job-3')).toBe('var(--chart-series-other)')
    expect(colors.has('manual')).toBe(false)
  })
})
