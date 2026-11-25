'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

import type { AnswerCard } from '@/shared/cards/schemas'
import { Tabs as UiTabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useHeightGlide } from '@/components/motion/height-glide'
import { cn } from '@/lib/utils'
import { TEXT_COMPONENT, TextBlock, useReportDrawn, type CardRenderer } from './catalog'
import { surfaceComponents } from './surface-messages'

type BuildChild = (id: string) => ReactNode

export function LeafView({ type, children }: { type: string; children: ReactNode }) {
  return (
    <div className="contents" data-a2ui-node={type}>
      {children}
    </div>
  )
}

export function RowView({ ids, buildChild }: { ids: string[]; buildChild: BuildChild }) {
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

export function ColumnView({ ids, buildChild }: { ids: string[]; buildChild: BuildChild }) {
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

export type TabEntry = { title: string; child: string }

export function TabsView({ tabs, buildChild }: { tabs: TabEntry[]; buildChild: BuildChild }) {
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

export function TextView({ text }: { text: string }) {
  useReportDrawn()
  return <TextBlock text={text} />
}

export function SurfaceLayout({ card, render }: { card: AnswerCard; render: CardRenderer }) {
  const byId = new Map(surfaceComponents(card).map((component) => [String(component.id), component]))
  const build = (id: string): ReactNode => {
    const node = byId.get(id)
    if (!node) return null
    const { id: _id, component, ...props } = node
    if (component === 'Row') return <RowView ids={(props.children as unknown[]).map(String)} buildChild={build} />
    if (component === 'Column') return <ColumnView ids={(props.children as unknown[]).map(String)} buildChild={build} />
    if (component === 'Tabs') return <TabsView tabs={props.tabs as TabEntry[]} buildChild={build} />
    if (component === TEXT_COMPONENT) return <TextView text={String(props.text)} />
    const type = String(component)
    return <LeafView type={type}>{render({ ...props, type } as AnswerCard, id)}</LeafView>
  }
  return <>{build('root')}</>
}
