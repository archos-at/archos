import type { Occurrence } from './occurrences'

export const BLOCK_MINUTES = 30

export const DAY_MINUTES = 24 * 60

const MIN_SEGMENT_MINUTES = 3 * 60

const SEGMENT_PADDING_MINUTES = 60

const MIN_GAP_TO_BREAK_MINUTES = 3 * 60

export interface TimetableBlock {
  jobId: string
  at: Date
  startMinute: number
  lane: number
  lanes: number
}

export interface TimetableDay {
  date: Date
  blocks: TimetableBlock[]
}

export interface BandSegment {
  start: number
  end: number
}

export interface Timetable {
  days: TimetableDay[]
  segments: BandSegment[]
  cropped: boolean
}

export function startOfWeek(date: Date): Date {
  const out = new Date(date)
  out.setHours(0, 0, 0, 0)
  const shift = (out.getDay() + 6) % 7
  out.setDate(out.getDate() - shift)
  return out
}

export function addDays(from: Date, count: number): Date {
  const out = new Date(from)
  out.setDate(out.getDate() + count)
  return out
}

export function minuteOfDay(at: Date): number {
  return at.getHours() * 60 + at.getMinutes()
}

export function buildTimetable(
  occurrences: readonly Occurrence[],
  weekStart: Date,
  fullDay = false,
): Timetable {
  const days: TimetableDay[] = Array.from({ length: 7 }, (_, index) => ({
    date: addDays(weekStart, index),
    blocks: [],
  }))

  const weekEnd = addDays(weekStart, 7)
  const placed: { dayIndex: number; block: TimetableBlock }[] = []

  for (const occurrence of occurrences) {
    const at = occurrence.at
    if (at < weekStart || at >= weekEnd) continue
    const dayIndex = dayIndexOf(weekStart, at)
    if (dayIndex < 0 || dayIndex > 6) continue
    placed.push({
      dayIndex,
      block: { jobId: occurrence.jobId, at, startMinute: minuteOfDay(at), lane: 0, lanes: 1 },
    })
  }

  for (const entry of placed) {
    days[entry.dayIndex].blocks.push(entry.block)
  }
  for (const day of days) {
    packLanes(day.blocks)
  }

  const segments = segmentsFor(placed.map((entry) => entry.block.startMinute), fullDay)
  const cropped =
    segments.length > 1 || segments[0].start > 0 || segments[0].end < DAY_MINUTES
  return { days, segments, cropped }
}

export function segmentIndexFor(segments: readonly BandSegment[], minute: number): number {
  return segments.findIndex((segment) => minute >= segment.start && minute < segment.end)
}

export function segmentMinutes(segment: BandSegment): number {
  return segment.end - segment.start
}

export function gapMinutes(segments: readonly BandSegment[], index: number): number {
  const before = segments[index]
  const after = segments[index + 1]
  return before && after ? after.start - before.end : 0
}

function dayIndexOf(weekStart: Date, at: Date): number {
  for (let index = 0; index < 7; index += 1) {
    const dayStart = addDays(weekStart, index)
    const dayEnd = addDays(weekStart, index + 1)
    if (at >= dayStart && at < dayEnd) return index
  }
  return -1
}

function packLanes(blocks: TimetableBlock[]): void {
  blocks.sort((a, b) => a.startMinute - b.startMinute || a.jobId.localeCompare(b.jobId))

  let cluster: TimetableBlock[] = []
  let clusterEnd = -1

  const closeCluster = (): void => {
    for (const block of cluster) block.lanes = cluster.length
    cluster = []
    clusterEnd = -1
  }

  for (const block of blocks) {
    if (cluster.length > 0 && block.startMinute >= clusterEnd) closeCluster()
    block.lane = cluster.length
    cluster.push(block)
    clusterEnd = Math.max(clusterEnd, block.startMinute + BLOCK_MINUTES)
  }
  if (cluster.length > 0) closeCluster()
}

function segmentsFor(startMinutes: readonly number[], fullDay: boolean): BandSegment[] {
  if (fullDay || startMinutes.length === 0) {
    return [{ start: 0, end: DAY_MINUTES }]
  }

  const sorted = [...new Set(startMinutes)].sort((a, b) => a - b)
  const clusters: number[][] = [[sorted[0]]]
  for (const minute of sorted.slice(1)) {
    const current = clusters[clusters.length - 1]
    const previous = current[current.length - 1]
    if (minute - (previous + BLOCK_MINUTES) >= MIN_GAP_TO_BREAK_MINUTES) clusters.push([minute])
    else current.push(minute)
  }

  const segments: BandSegment[] = clusters.map((cluster) => {
    const earliest = cluster[0]
    const latest = cluster[cluster.length - 1] + BLOCK_MINUTES
    let start = clampToHour(earliest - SEGMENT_PADDING_MINUTES, 'down')
    let end = clampToHour(latest + SEGMENT_PADDING_MINUTES, 'up')
    while (end - start < MIN_SEGMENT_MINUTES) {
      if (start > 0) start -= 60
      else if (end < DAY_MINUTES) end += 60
      else break
    }
    return { start: Math.max(0, start), end: Math.min(DAY_MINUTES, end) }
  })

  return mergeTouching(segments)
}

function mergeTouching(segments: readonly BandSegment[]): BandSegment[] {
  const merged: BandSegment[] = []
  for (const segment of segments) {
    const last = merged[merged.length - 1]
    if (last && segment.start <= last.end) last.end = Math.max(last.end, segment.end)
    else merged.push({ ...segment })
  }
  return merged
}

function clampToHour(minute: number, direction: 'up' | 'down'): number {
  const bounded = Math.max(0, Math.min(DAY_MINUTES, minute))
  return direction === 'down'
    ? Math.floor(bounded / 60) * 60
    : Math.ceil(bounded / 60) * 60
}

export function hourMarks(segment: BandSegment): number[] {
  const marks: number[] = []
  for (let minute = segment.start; minute < segment.end; minute += 60) marks.push(minute)
  return marks
}

export function placeableSchedules<T extends { id: string; scheduleCron: string | null; dueAt: string | null; enabled: boolean }>(
  jobs: readonly T[],
): T[] {
  return jobs
    .filter((job) => (job.scheduleCron !== null || job.dueAt !== null) && job.enabled)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
}

export function seriesColorsFor(
  jobs: readonly { id: string; scheduleCron: string | null; dueAt: string | null; enabled: boolean }[],
  slotCount: number,
): Map<string, string> {
  const slots = new Map<string, string>()
  placeableSchedules(jobs).forEach((job, index) => {
    slots.set(
      job.id,
      index < slotCount ? `var(--chart-series-${index + 1})` : 'var(--chart-series-other)',
    )
  })
  return slots
}
