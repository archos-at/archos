export const LINEAR_BOUND = 40

export function elapsedMs(run: () => void): number {
  const started = performance.now()
  run()
  return performance.now() - started
}

export interface GrowthOptions {
  size: number
  factor?: number
  samples?: number
  floorMs?: number
}

export function growthRatio(
  timeOnce: (size: number) => number,
  { size, factor = 8, samples = 9, floorMs = 0.5 }: GrowthOptions
): number {
  const large = size * factor
  timeOnce(size)
  timeOnce(large)
  let fastSmall = Number.POSITIVE_INFINITY
  let fastLarge = Number.POSITIVE_INFINITY
  for (let i = 0; i < samples; i++) {
    fastSmall = Math.min(fastSmall, timeOnce(size))
    fastLarge = Math.min(fastLarge, timeOnce(large))
  }
  return fastLarge / Math.max(fastSmall, floorMs)
}
