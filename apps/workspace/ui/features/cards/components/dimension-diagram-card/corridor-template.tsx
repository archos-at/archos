import type { Translator } from '@/i18n'
import type { DimensionCheckData } from '@/shared/cards/schemas'
import { DimensionArrow, fitScale } from '../../schematics/kit'
import { sketchRect } from '../../schematics/rough'
import { label, pick } from '../../lib/diagram-dimensions'
import { POCHE } from './hatch-styles'
import type { Template } from './template'

export const corridorTemplate = (dims: DimensionCheckData[], t: Translator): Template => {
  const widthDim = pick(dims, ['breite', 'width'])
  const w = widthDim?.value ?? 120
  const wallCm = 25
  const Lc = Math.max(w * 2.6, 280)
  const k = fitScale(Lc, w + 2 * wallCm, 330, 132)
  const x0 = 38
  const y0 = 18
  const wallT = wallCm * k
  const innerTop = y0 + wallT
  const innerBottom = innerTop + w * k
  const endX = x0 + Lc * k
  const dimX = x0 + Lc * k * 0.5

  return {
    viewW: endX + 40,
    viewH: innerBottom + wallT + 22,
    node: (
      <g>
        {sketchRect(x0, y0, Lc * k, wallT, 'corridor-wall-top', POCHE)}
        {sketchRect(x0, innerBottom, Lc * k, wallT, 'corridor-wall-bottom', POCHE)}
        {/* open ends marked with light break lines */}
        {[x0, endX].map((x) => (
          <line
            key={`end-${x}`}
            x1={x}
            y1={innerTop}
            x2={x}
            y2={innerBottom}
            stroke="var(--muted-foreground)"
            strokeWidth={0.8}
            strokeDasharray="3 4"
            opacity={0.6}
          />
        ))}
        {widthDim && (
          <DimensionArrow
            x1={dimX}
            y1={innerBottom}
            x2={dimX}
            y2={innerTop}
            label={label(widthDim, t)}
            status={widthDim.status}
            labelOffset={13}
            fontSize={9.5}
          />
        )}
      </g>
    ),
  }
}
