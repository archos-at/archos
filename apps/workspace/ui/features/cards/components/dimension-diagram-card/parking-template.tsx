import type { Translator } from '@/i18n'
import type { DimensionCheckData } from '@/shared/cards/schemas'
import { DimensionArrow, ExtensionLine, fitScale, SvgLabel } from '../../schematics/kit'
import { sketchRect } from '../../schematics/rough'
import { label, pick } from '../../lib/diagram-dimensions'
import type { Template } from './template'

export const parkingTemplate = (dims: DimensionCheckData[], t: Translator): Template => {
  const widthDim = pick(dims, ['breite', 'width'])
  const lengthDim = pick(dims, ['länge', 'laenge', 'tiefe', 'length'])
  const w = widthDim?.value ?? 350
  const l = lengthDim?.value ?? 500
  const k = fitScale(l, w, 280, 165)
  const x0 = 56
  const y0 = 18
  const W = l * k
  const H = w * k

  return {
    viewW: x0 + W + 34,
    viewH: y0 + H + 38,
    node: (
      <g>
        {sketchRect(x0, y0, W, H, 'parking-bay', { strokeWidth: 1.5 })}
        <SvgLabel
          x={x0 + W / 2}
          y={y0 + H / 2}
          anchor="middle"
          size={26}
          weight={700}
          fill="color-mix(in oklch, var(--muted-foreground) 55%, transparent)"
        >
          P
        </SvgLabel>
        {widthDim && (
          <g>
            <ExtensionLine x1={x0} y1={y0} x2={x0 - 20} y2={y0} />
            <ExtensionLine x1={x0} y1={y0 + H} x2={x0 - 20} y2={y0 + H} />
            <DimensionArrow
              x1={x0 - 16}
              y1={y0 + H}
              x2={x0 - 16}
              y2={y0}
              label={label(widthDim, t)}
              status={widthDim.status}
              labelOffset={-13}
              fontSize={9.5}
            />
          </g>
        )}
        {lengthDim && (
          <g>
            <ExtensionLine x1={x0} y1={y0 + H} x2={x0} y2={y0 + H + 22} />
            <ExtensionLine x1={x0 + W} y1={y0 + H} x2={x0 + W} y2={y0 + H + 22} />
            <DimensionArrow
              x1={x0}
              y1={y0 + H + 18}
              x2={x0 + W}
              y2={y0 + H + 18}
              label={label(lengthDim, t)}
              status={lengthDim.status}
              labelOffset={9}
              fontSize={9.5}
            />
          </g>
        )}
      </g>
    ),
  }
}
