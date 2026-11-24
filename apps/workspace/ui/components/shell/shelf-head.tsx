'use client'

import { Fragment, type JSX, type ReactNode } from 'react'

import { CountPill } from '@/components/ui/count-pill'
import { PageHeader } from '@/components/ui/page-header'
import { CLAUSE_JOIN } from '@/lib/format'
import { cn } from '@/lib/utils'
import { SECTION_CONTENT_WIDTH, SECTION_HEADER_CLASS } from './section-layout'
import { SectionPlaceLine, SectionPlaceUp, type SectionPlace } from './section-place'
import { SectionToolRow } from './section-tool-row'

export interface ShelfHeadProps {
  crumb: readonly string[]
  title: string
  count?: number | null
  place: SectionPlace | null
  phone: boolean
  tools: ReactNode
  toolsAtEnd?: boolean
  places?: ReactNode
  placesOnPhone?: boolean
  action?: ReactNode
  titleStart?: ReactNode
  titleStartClassName?: string
  titleEnd?: ReactNode
  'data-testid'?: string
}

export function ShelfHead({
  crumb,
  title,
  count = null,
  place: reached,
  phone,
  tools,
  toolsAtEnd = false,
  places,
  placesOnPhone = true,
  action,
  titleStart,
  titleStartClassName,
  titleEnd,
  'data-testid': testId = 'shelf-head',
}: ShelfHeadProps): JSX.Element {
  const place = phone ? reached : null
  // On a phone the search row stands under the places: they keep their own height, or the tab's rule lands on the field.
  const toolRowUnderPlaces = phone && tools != null && !toolsAtEnd
  const pathPlace = phone ? null : reached
  const row = toolsAtEnd ? (
    <div className="ml-auto flex shrink-0 items-center">{tools}</div>
  ) : (
    <div className="flex min-w-0 flex-1" data-testid="shelf-head-tools">
      {tools}
    </div>
  )
  return (
    <>
      <div className={cn(SECTION_HEADER_CLASS, 'phone:pt-3', SECTION_CONTENT_WIDTH)} data-testid={testId}>
        <PageHeader
          title={
            place ? (
              <BreakableName text={place.title} />
            ) : (
              <span className="inline-flex min-w-0 items-center gap-2">
                {title}
                {count !== null && count > 0 && <CountPill data-testid="shelf-head-count" count={count} />}
              </span>
            )
          }
          titleClassName="line-clamp-2"
          titleTooltip={place ? [place.title, place.count].filter(Boolean).join(CLAUSE_JOIN) : undefined}
          titleAside={place?.count && <span className="text-muted-foreground text-[13px] leading-5 tabular-nums phone:hidden" data-testid="page-header-count">{place.count}</span>}
          crumb={phone ? place?.phoneTrail : crumb.length > 0 ? <CrumbSteps steps={crumb} /> : undefined}
          crumbClassName={phone ? 'text-[13px] leading-5' : 'max-md:hidden'}
          titleStartClassName={place ? undefined : titleStartClassName}
          titleStart={place ? <SectionPlaceUp up={place.up} /> : titleStart}
          titleEnd={
            titleEnd || (phone && toolsAtEnd && tools) ? (
              <>
                {titleEnd}
                {phone && toolsAtEnd ? tools : null}
              </>
            ) : undefined
          }
          action={action}
          actionInline
        />
        {!phone && <SectionToolRow className="mt-6 h-9 phone:hidden">{row}</SectionToolRow>}
        {places && (
          <div
            className={cn('-mb-4 mt-4 min-w-0 phone:mt-4', !placesOnPhone && 'phone:hidden', toolRowUnderPlaces && 'phone:mb-0')}
            data-testid="shelf-head-places"
          >
            {places}
          </div>
        )}
        {toolRowUnderPlaces && <SectionToolRow className={places && placesOnPhone ? 'mt-3' : 'mt-4'}>{row}</SectionToolRow>}
      </div>
      {pathPlace && (
        <div className={cn('shrink-0 px-4 md:px-8', SECTION_CONTENT_WIDTH)}>
          <SectionPlaceLine place={pathPlace} />
        </div>
      )}
    </>
  )
}

function CrumbSteps({ steps: [owner, ...rest] }: { steps: readonly string[] }): JSX.Element {
  return (
    <>
      <span className="max-w-[16rem] shrink-0 truncate" title={owner}>{owner}</span>
      {rest.map((step) => (
        <Fragment key={step}>
          <span aria-hidden>·</span>
          <span className="shrink-0">{step}</span>
        </Fragment>
      ))}
    </>
  )
}

function BreakableName({ text }: { text: string }): JSX.Element {
  const parts = text.split('_')
  return (
    <>
      <span aria-hidden>
        {parts.map((part, index) => (
          <span key={index}>
            {(index < parts.length - 1 ? `${part}_` : part).replaceAll('-', '-\u2060')}
            {index < parts.length - 1 && <wbr />}
          </span>
        ))}
      </span>
      <span className="sr-only">{text}</span>
    </>
  )
}
