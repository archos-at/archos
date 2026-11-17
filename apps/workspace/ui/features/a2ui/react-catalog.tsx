'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Catalog, MessageProcessor, type SurfaceModel } from '@a2ui/web_core/v0_9'
import { createComponentImplementation, type ReactComponentImplementation } from '@a2ui/react/v0_9'

import type { AnswerCard } from '@/shared/cards/schemas'
import { Tabs as UiTabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useHeightGlide } from '@/components/motion/height-glide'
import { cn } from '@/lib/utils'
import {
  A2UI_PROTOCOL_VERSION,
  cardComponentApi,
  catalogCardSchemas,
  ColumnApi,
  CARDS_CATALOG_ID,
  RowApi,
  TabsApi,
  TextApi,
  TextBlock,
  useCardRenderer,
  useReportDrawn,
  type CardSchema,
} from './catalog'
import { dataModelStore, ReaderInputsProvider } from './reader-inputs'
import { cardToSurfaceMessages } from './surface-messages'

export { A2uiSurface } from '@a2ui/react/v0_9'

function cardComponent(schema: CardSchema): ReactComponentImplementation {
  const api = cardComponentApi(schema)
  const type = api.name
  return createComponentImplementation(api, function A2uiCardComponent({ props, context }) {
    const render = useCardRenderer()
    useReportDrawn()
    const leafId = context.componentModel.id
    const store = useMemo(() => dataModelStore(context.dataContext, leafId), [context.dataContext, leafId])
    if (!render) return null
    return (
      <div className="contents" data-a2ui-node={type}>
        <ReaderInputsProvider store={store}>{render({ ...(props as object), type } as AnswerCard, leafId)}</ReaderInputsProvider>
      </div>
    )
  })
}

function RowView({ ids, buildChild }: { ids: string[]; buildChild: (id: string) => ReactNode }) {
  useReportDrawn()
  return (
    <div className="@container" data-a2ui-node="Row">
      <div className="grid items-start gap-3 @[44rem]:grid-flow-col @[44rem]:auto-cols-fr">
        {ids.map((id) => (
          <div key={id} className="min-w-0">
            {buildChild(id)}
          </div>
        ))}
      </div>
    </div>
  )
}

const Row = createComponentImplementation(RowApi, ({ props, buildChild }) => (
  <RowView ids={props.children as string[]} buildChild={buildChild} />
))

function ColumnView({ ids, buildChild }: { ids: string[]; buildChild: (id: string) => ReactNode }) {
  useReportDrawn()
  return (
    <div className="flex flex-col gap-3" data-a2ui-node="Column">
      {ids.map((id) => (
        <div key={id} className="min-w-0">
          {buildChild(id)}
        </div>
      ))}
    </div>
  )
}

const Column = createComponentImplementation(ColumnApi, ({ props, buildChild }) => (
  <ColumnView ids={props.children as string[]} buildChild={buildChild} />
))

function TabsView({ tabs, buildChild }: { tabs: { title: string; child: string }[]; buildChild: (id: string) => ReactNode }) {
  useReportDrawn()
  const [value, setValue] = useState(tabs[0]?.child)
  const [switched, setSwitched] = useState(false)
  const panelsRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  useHeightGlide(panelsRef, value)

  useEffect(() => {
    if (!switched) return
    const list = listRef.current
    const tab = list?.querySelector<HTMLElement>('[data-state="active"]')
    if (!list || !tab) return
    const listBox = list.getBoundingClientRect()
    const tabBox = tab.getBoundingClientRect()
    const overflowLeft = tabBox.left - listBox.left
    const overflowRight = tabBox.right - listBox.right
    if (overflowLeft >= 0 && overflowRight <= 0) return
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    list.scrollTo({
      left: list.scrollLeft + (overflowLeft < 0 ? overflowLeft : overflowRight),
      behavior: reduced ? 'auto' : 'smooth',
    })
  }, [value, switched])

  return (
    <UiTabs
      value={value}
      onValueChange={(next) => {
        setSwitched(true)
        setValue(next)
      }}
      className="gap-3"
      data-a2ui-node="Tabs"
    >
      <TabsList ref={listRef} className="max-w-full justify-start overflow-x-auto">
        {tabs.map((tab) => (
          <TabsTrigger key={tab.child} value={tab.child} className="flex-none">
            {tab.title}
          </TabsTrigger>
        ))}
      </TabsList>
      <div ref={panelsRef}>
        {tabs.map((tab) => (
          <TabsContent
            key={tab.child}
            value={tab.child}
            className={cn(
              'mt-0 min-w-0',
              switched && 'animate-in fade-in-0 duration-quick ease-out motion-reduce:animate-none'
            )}
          >
            {buildChild(tab.child)}
          </TabsContent>
        ))}
      </div>
    </UiTabs>
  )
}

const Tabs = createComponentImplementation(TabsApi, ({ props, buildChild }) => (
  <TabsView tabs={props.tabs as { title: string; child: string }[]} buildChild={buildChild} />
))

function TextView({ text }: { text: string }) {
  useReportDrawn()
  return <TextBlock text={text} />
}

const Text = createComponentImplementation(TextApi, ({ props }) => <TextView text={String(props.text)} />)

let catalog: Catalog<ReactComponentImplementation> | null = null

export function agentCatalog(): Catalog<ReactComponentImplementation> {
  catalog ??= new Catalog(CARDS_CATALOG_ID, A2UI_PROTOCOL_VERSION, [
    ...catalogCardSchemas().map(cardComponent),
    Row,
    Column,
    Tabs,
    Text,
  ])
  return catalog
}

export function buildSurface(card: AnswerCard, surfaceId: string): SurfaceModel<ReactComponentImplementation> | null {
  const processor = new MessageProcessor<ReactComponentImplementation>([agentCatalog()])
  processor.processMessages(cardToSurfaceMessages(card, surfaceId))
  return processor.model.getSurface(surfaceId) ?? null
}
