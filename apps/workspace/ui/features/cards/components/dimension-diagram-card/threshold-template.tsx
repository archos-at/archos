import type { Translator } from '@/i18n'
import type { DimensionCheckData } from '@/shared/cards/schemas'
import { DimensionArrow, ExtensionLine, fitScale } from '../../schematics/kit'
import { sketchRect } from '../../schematics/rough'
import { label, pick } from '../../lib/diagram-dimensions'
import { HATCH_LIGHT } from './hatch-styles'
import type { Template } from './template'

export const thresholdTemplate = (dims: DimensionCheckData[], t: Translator): Template => {
  const heightDim = pick(dims, ['höhe', 'hoehe', 'schwelle', 'height'])
  const sillCm = heightDim?.value ?? 2
  const k = Math.min(fitScale(40, Math.max(sillCm, 2) + 12, 250, 120), 9)
  const x0 = 60
  const spanCm = 40
  const bumpW = 8 * k
  const bumpH = Math.max(sillCm, 0.4) * k
  const doorW = 4 * k
  const doorH = 9 * k
  const padTop = doorH + bumpH + 26
  const floorY = padTop + 8
  const bumpX = x0 + (spanCm * k - bumpW) / 2
  const doorX = bumpX + (bumpW - doorW) / 2
  const doorBottom = floorY - bumpH - 1.5

  return {
    viewW: x0 + spanCm * k + 66,
    viewH: floorY + 34,
    node: (
      <g>
        {/* floor slab both sides */}
        <line
          x1={x0 - 20}
          y1={floorY}
          x2={x0 + spanCm * k + 20}
          y2={floorY}
          stroke="var(--foreground)"
          strokeWidth={1.4}
        />
        {Array.from({ length: 8 }, (_, i) => {
          const x = x0 - 12 + i * ((spanCm * k + 24) / 7)
          return (
            <line
              key={`fh-${i}`}
              x1={x}
              y1={floorY}
              x2={x - 6}
              y2={floorY + 6}
              stroke="var(--muted-foreground)"
              strokeWidth={0.8}
              opacity={0.5}
            />
          )
        })}
        {/* threshold bump */}
        {sketchRect(bumpX, floorY - bumpH, bumpW, bumpH, 'threshold-bump', {
          strokeWidth: 1.3,
          ...HATCH_LIGHT,
        })}
        {/* door leaf above, cut off with a break line */}
        {sketchRect(doorX, doorBottom - doorH, doorW, doorH, 'threshold-door', {
          strokeWidth: 1,
          stroke: 'var(--muted-foreground)',
        })}
        <line
          x1={doorX - 5}
          y1={doorBottom - doorH + 3}
          x2={doorX + doorW + 5}
          y2={doorBottom - doorH - 3}
          stroke="var(--card)"
          strokeWidth={5}
        />
        <line
          x1={doorX - 5}
          y1={doorBottom - doorH + 3}
          x2={doorX + doorW + 5}
          y2={doorBottom - doorH - 3}
          stroke="var(--muted-foreground)"
          strokeWidth={0.9}
        />
        {/* threshold height */}
        {heightDim && (
          <g>
            <ExtensionLine
              x1={bumpX + bumpW}
              y1={floorY - bumpH}
              x2={bumpX + bumpW + 26}
              y2={floorY - bumpH}
            />
            <DimensionArrow
              x1={bumpX + bumpW + 22}
              y1={floorY}
              x2={bumpX + bumpW + 22}
              y2={floorY - bumpH}
              label={label(heightDim, t)}
              status={heightDim.status}
              labelOffset={13}
              fontSize={9.5}
            />
          </g>
        )}
      </g>
    ),
  }
}
