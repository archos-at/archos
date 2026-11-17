export interface PageRegion {
  box: [number, number, number, number]
  label?: string
}

export const MAX_PAGE_REGIONS = 6

const isUnit = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1

const asPageRegion = (value: unknown): PageRegion | undefined => {
  if (typeof value !== 'object' || value === null) return undefined
  const { box, label } = value as { box?: unknown; label?: unknown }
  if (!Array.isArray(box) || box.length !== 4 || !box.every(isUnit)) return undefined
  const [x0, y0, x1, y1] = box as [number, number, number, number]
  if (x1 <= x0 || y1 <= y0) return undefined
  const text = typeof label === 'string' ? label.trim() : ''
  return { box: [x0, y0, x1, y1], ...(text ? { label: text } : {}) }
}

export const parsePageRegions = (value: unknown): PageRegion[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const regions = value.flatMap((item) => {
    const region = asPageRegion(item)
    return region ? [region] : []
  })
  return regions.length ? regions.slice(0, MAX_PAGE_REGIONS) : undefined
}

export const mergePageRegions = (
  current: PageRegion[] | undefined,
  incoming: PageRegion[] | undefined,
): PageRegion[] | undefined => {
  if (!incoming?.length) return current
  const merged = [...(current ?? [])]
  for (const region of incoming) {
    if (merged.length >= MAX_PAGE_REGIONS) break
    if (!merged.some((known) => known.box.every((value, index) => value === region.box[index]))) {
      merged.push(region)
    }
  }
  return merged.length ? merged : undefined
}
