import type { Translator } from '@/i18n'
import type { DimensionCheckData } from '@/shared/cards/schemas'
import { DimensionArrow, fitScale, statusColor } from '../../schematics/kit'
import { sketchCircle, sketchRect } from '../../schematics/rough'
import { label, pick } from '../../lib/diagram-dimensions'
import { POCHE } from './hatch-styles'
import type { Template } from './template'

export const turningCircleTemplate = (dims: DimensionCheckData[], t: Translator): Template => {
  const diaDim = pick(dims, ['durchmesser', 'wende', 'breite', 'diameter'])
  const d = diaDim?.value ?? 150
  const k = fitScale(d, d, 168, 168)
  const D = d * k
  const wallT = 11
  const x0 = 44
  const y0 = 34
  const cx = x0 + D / 2
  const cy = y0 + D / 2

  return {
    viewW: x0 + D + 46,
    viewH: y0 + D + 26,
    node: (
      <g>
        {/* room corner: top + left cut walls */}
        {sketchRect(x0 - 26, y0 - 26, D + 62, wallT, 'tc-wall-top', POCHE)}
        {/* The left wall stops inside the viewBox: an SVG clips at its own
            viewBox, and a poché that runs past the bottom edge is cut off
            square rather than ending as a wall. */}
        {sketchRect(x0 - 26, y0 - 26 + wallT, wallT, D + 32, 'tc-wall-left', POCHE)}
        {/* turning circle */}
        {sketchCircle(cx, cy, D, 'tc-circle', {
          stroke: diaDim ? statusColor(diaDim.status) : 'var(--foreground)',
          strokeWidth: 1.5,
        })}
        {/* centre cross */}
        <line x1={cx - 6} y1={cy} x2={cx + 6} y2={cy} stroke="var(--muted-foreground)" strokeWidth={0.9} />
        <line x1={cx} y1={cy - 6} x2={cx} y2={cy + 6} stroke="var(--muted-foreground)" strokeWidth={0.9} />
        {diaDim && (
          <DimensionArrow
            x1={cx - D / 2}
            y1={cy}
            x2={cx + D / 2}
            y2={cy}
            label={`Ø ${label(diaDim, t)}`}
            status={diaDim.status}
            labelOffset={-11}
            fontSize={9.5}
          />
        )}
      </g>
    ),
  }
}
