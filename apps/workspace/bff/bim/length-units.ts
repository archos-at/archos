export function toMetres(value: number | null, scale?: number | null): number | null {
  if (value === null) return null
  if (typeof scale === 'number' && Number.isFinite(scale) && scale > 0) return value * scale
  return value > 20 ? value / 1000 : value
}

export function toCentimetres(value: number | null, scale?: number | null): number | null {
  const metres = toMetres(value, scale)
  return metres === null ? null : metres * 100
}
