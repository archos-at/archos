import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { BaseSequencer, type TestSpecification } from 'vitest/node'

function recorded(root: string): Record<string, number> {
  try {
    return JSON.parse(readFileSync(join(root, 'tests', 'vitest-durations.json'), 'utf8')) as Record<string, number>
  } catch {
    return {}
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 1
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

// Measured in CI 2026-10-22: 259 files, and the slowest shard is the frontend's time on balance.
export default class DurationSequencer extends BaseSequencer {
  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { config } = this.ctx
    const { index, count } = config.shard!
    const times = recorded(config.root)
    const fallback = median(Object.values(times))
    const keyed = files.map((spec) => {
      const path = relative(config.root, spec.moduleId).replace(/\\/g, '/')
      return { spec, path, time: times[path] ?? fallback }
    })
    keyed.sort((a, b) => b.time - a.time || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    const loads = new Array<number>(count).fill(0)
    const mine: TestSpecification[] = []
    for (const { spec, time } of keyed) {
      let target = 0
      for (let shard = 1; shard < count; shard++) if (loads[shard] < loads[target]) target = shard
      loads[target] += time
      if (target === index - 1) mine.push(spec)
    }
    return mine
  }
}
