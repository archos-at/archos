'use client'

import { useMemo } from 'react'
import { Catalog, MessageProcessor, type SurfaceModel } from '@a2ui/web_core/v0_9'
import { createComponentImplementation, type ReactComponentImplementation } from '@a2ui/react/v0_9'

import type { AnswerCard } from '@/shared/cards/schemas'
import {
  A2UI_PROTOCOL_VERSION,
  cardComponentApi,
  catalogCardSchemas,
  ColumnApi,
  CARDS_CATALOG_ID,
  RowApi,
  TabsApi,
  TextApi,
  useCardRenderer,
  useReportDrawn,
  type CardSchema,
} from './catalog'
import { dataModelStore, ReaderInputsProvider } from './reader-inputs'
import { cardToSurfaceMessages } from './surface-messages'
import { ColumnView, LeafView, RowView, TabsView, TextView, type TabEntry } from './surface-views'

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
      <LeafView type={type}>
        <ReaderInputsProvider store={store}>{render({ ...(props as object), type } as AnswerCard, leafId)}</ReaderInputsProvider>
      </LeafView>
    )
  })
}

const Row = createComponentImplementation(RowApi, ({ props, buildChild }) => (
  <RowView ids={props.children as string[]} buildChild={buildChild} />
))

const Column = createComponentImplementation(ColumnApi, ({ props, buildChild }) => (
  <ColumnView ids={props.children as string[]} buildChild={buildChild} />
))

const Tabs = createComponentImplementation(TabsApi, ({ props, buildChild }) => (
  <TabsView tabs={props.tabs as TabEntry[]} buildChild={buildChild} />
))

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
