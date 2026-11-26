import type { BimModelHeaderView } from './model-header'

export const AUTOLOAD_MAX_BYTES = 20_000_000
export const AUTOLOAD_MAX_ELEMENTS = 15_000

type GateInput = Pick<BimModelHeaderView, 'elementCount' | 'summary'>

export function loadsOnSight(model: GateInput): boolean {
  const bytes = model.summary?.fileSizeBytes ?? 0
  return bytes <= AUTOLOAD_MAX_BYTES && model.elementCount <= AUTOLOAD_MAX_ELEMENTS
}
