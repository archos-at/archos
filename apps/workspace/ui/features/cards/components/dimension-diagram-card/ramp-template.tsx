import type { Translator } from '@/i18n'
import type { DimensionCheckData } from '@/shared/cards/schemas'
import { DimensionArrow, ExtensionLine, fitScale, SvgLabel, statusColor } from '../../schematics/kit'
import { sketchPolygon } from '../../schematics/rough'
import { label, pick, toMetres } from '../../lib/diagram-dimensions'
import { HATCH_LIGHT } from './hatch-styles'
import type { Template } from './template'

export const rampTemplate = (dims: DimensionCheckData[], t: Translator): Template => {
  const slopeDim = pick(dims, ['neigung', 'gefälle', 'gefaelle', 'steigung'], '%')
  const lengthDim = pick(dims, ['länge', 'laenge', 'length'])
  const heightDim = pick(dims, ['höhe', 'hoehe', 'height', 'niveau'])

  const slopePct = slopeDim?.value ?? 6
  const Lm = toMetres(lengthDim) ?? 6
  const riseM = toMetres(heightDim) ?? (Lm * slopePct) / 100

  const k = fitScale(Lm, Math.max(riseM, 0.6), 320, 100)
  const railH = Math.min(1.0 * k, 34)
  const x0 = 44
  const padTop = railH + 30
  const groundY = padTop + Math.max(riseM, 0.6) * k
  const endX = x0 + Lm * k
  const topY = groundY - riseM * k

  const yOnRamp = (t: number): number => groundY - riseM * k * t
  const xOnRamp = (t: number): number => x0 + Lm * k * t

  const angle = (Math.atan2(topY - groundY, endX - x0) * 180) / Math.PI
  const midX = (x0 + endX) / 2
  const midY = (groundY + topY) / 2

  return {
    viewW: endX + 68,
    viewH: groundY + 40,
    node: (
      <g>
        {/* ground with hatch ticks */}
        <line
          x1={x0 - 26}
          y1={groundY}
          x2={endX + 52}
          y2={groundY}
          stroke="var(--foreground)"
          strokeWidth={1.4}
        />
        {Array.from({ length: 9 }, (_, i) => {
          const x = x0 - 20 + i * ((endX + 44 - x0) / 8)
          return (
            <line
              key={`gh-${i}`}
              x1={x}
              y1={groundY}
              x2={x - 6}
              y2={groundY + 6}
              stroke="var(--muted-foreground)"
              strokeWidth={0.8}
              opacity={0.5}
            />
          )
        })}
        {/* ramp wedge */}
        {sketchPolygon(
          [
            [x0, groundY],
            [endX, groundY],
            [endX, topY],
          ],
          'ramp-wedge',
          { strokeWidth: 1.4, ...HATCH_LIGHT }
        )}
        {/* handrail hint: posts standing on the ramp surface, rail along the slope */}
        <g opacity={0.45}>
          {[0.08, 0.31, 0.54, 0.77, 1].map((t) => (
            <line
              key={`post-${t}`}
              x1={xOnRamp(t)}
              y1={yOnRamp(t)}
              x2={xOnRamp(t)}
              y2={yOnRamp(t) - railH}
              stroke="var(--muted-foreground)"
              strokeWidth={1}
            />
          ))}
          <line
            x1={xOnRamp(0.08)}
            y1={yOnRamp(0.08) - railH}
            x2={xOnRamp(1)}
            y2={yOnRamp(1) - railH}
            stroke="var(--muted-foreground)"
            strokeWidth={1.2}
          />
        </g>
        {/* slope, annotated along the incline */}
        {slopeDim && (
          <SvgLabel
            x={midX}
            y={midY - 10}
            anchor="middle"
            fill={statusColor(slopeDim.status)}
            weight={600}
            mono={slopeDim.value != null}
            italic={slopeDim.value == null}
            transform={`rotate(${angle} ${midX} ${midY - 10})`}
          >
            {label(slopeDim, t)}
          </SvgLabel>
        )}
        {/* length along the ground */}
        {lengthDim && (
          <g>
            <ExtensionLine x1={x0} y1={groundY} x2={x0} y2={groundY + 22} />
            <ExtensionLine x1={endX} y1={groundY} x2={endX} y2={groundY + 22} />
            <DimensionArrow
              x1={x0}
              y1={groundY + 18}
              x2={endX}
              y2={groundY + 18}
              label={label(lengthDim, t)}
              status={lengthDim.status}
              labelOffset={9}
              fontSize={9.5}
            />
          </g>
        )}
        {/* height to overcome, at the high end */}
        {heightDim && (
          <g>
            <ExtensionLine x1={endX} y1={topY} x2={endX + 20} y2={topY} />
            <DimensionArrow
              x1={endX + 16}
              y1={groundY}
              x2={endX + 16}
              y2={topY}
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
