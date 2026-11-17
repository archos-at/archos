'use client'

import type { CSSProperties, FC } from 'react'
import type { PageRegion } from '../lib/page-region'

export interface RegionMarksProps {
  regions: readonly PageRegion[]
  color?: string
  ping?: number
}

export const RegionMarks: FC<RegionMarksProps> = ({ regions, color, ping = 0 }) => (
  <>
    {regions.map((region, index) => {
      const [x0, y0, x1, y1] = region.box
      return (
        <span
          key={`${ping}-${index}`}
          data-testid="region-mark"
          className="pointer-events-none absolute"
          style={
            {
              left: `${x0 * 100}%`,
              top: `${y0 * 100}%`,
              width: `${(x1 - x0) * 100}%`,
              height: `${(y1 - y0) * 100}%`,
              ...(color ? { ['--passage-tint' as string]: color } : {}),
            } as CSSProperties
          }
        >
          <span
            aria-hidden
            className="passage-highlight region-highlight animate-passage-ping motion-reduce:animate-none absolute inset-0"
          />
          {region.label && (
            <span className="region-label absolute bottom-full left-0 mb-1 max-w-full truncate rounded-sm bg-card px-1.5 py-0.5 text-xs font-medium text-foreground shadow-sm">
              {region.label}
            </span>
          )}
        </span>
      )
    })}
  </>
)
