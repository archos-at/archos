'use client'

import { createContext, useContext, useLayoutEffect, type ReactNode } from 'react'
import { z } from 'zod'
import { z as z3 } from 'zod-v3'
import { Catalog, componentId, type ComponentApi } from '@a2ui/web_core/v0_9'

import { answerCardSchema, type AnswerCard } from '@/shared/cards/schemas'
import { MarkdownRenderer } from '@/shared/components/MarkdownRenderer/MarkdownRenderer'
import { useNestedMarkdownPlugins } from '@/shared/components/MarkdownRenderer/nested-plugins-context'

export const CARDS_CATALOG_ID = 'https://piloti.at/a2ui/catalogs/cards/v1'

export const A2UI_PROTOCOL_VERSION = '0.9'

export const LAYOUT_COMPONENTS = ['Row', 'Column', 'Tabs'] as const

export const TEXT_COMPONENT = 'Text'

export type CardRenderer = (card: AnswerCard, leafId: string) => ReactNode

const CardRendererContext = createContext<CardRenderer | null>(null)
export const CardRendererProvider = CardRendererContext.Provider
export const useCardRenderer = () => useContext(CardRendererContext)

const DrawnContext = createContext<(() => void) | null>(null)
export const DrawnProvider = DrawnContext.Provider
export const useDrawnReporter = () => useContext(DrawnContext)

export function useReportDrawn() {
  const report = useDrawnReporter()
  useLayoutEffect(() => report?.(), [report])
}

export type CardSchema = (typeof answerCardSchema.options)[number]

export function cardTypeOf(schema: CardSchema): string {
  const field: z.ZodType = schema.shape.type
  const literal = field instanceof z.ZodDefault ? field.unwrap() : field
  return (literal as z.ZodLiteral<string>).value
}

function forA2ui(schema: z.ZodType): z3.ZodType {
  return z3.unknown().superRefine((value, ctx) => {
    const result = schema.safeParse(value)
    if (result.success) return
    for (const issue of result.error.issues) {
      ctx.addIssue({ code: z3.ZodIssueCode.custom, message: issue.message, path: issue.path.filter((step) => typeof step !== 'symbol') })
    }
  })
}

export function cardComponentApi(schema: CardSchema): ComponentApi {
  const props = (schema as z.ZodObject).omit({ type: true })
  return { name: cardTypeOf(schema), schema: forA2ui(props) }
}

export const RowApi = {
  name: 'Row',
  schema: z3
    .object({
      children: z3.array(componentId()),
      justify: z3.enum(['start', 'center', 'end', 'spaceBetween', 'spaceAround', 'spaceEvenly', 'stretch']).optional(),
      align: z3.enum(['start', 'center', 'end', 'stretch']).optional(),
    })
    .strict(),
}
export const ColumnApi = { ...RowApi, name: 'Column' }
export const TabsApi = {
  name: 'Tabs',
  schema: z3
    .object({
      tabs: z3.array(z3.object({ title: z3.string().trim().min(1), child: componentId() }).strict()).min(1),
    })
    .strict(),
}

export const TextApi = { name: TEXT_COMPONENT, schema: z3.object({ text: z3.string().trim().min(1) }).strict() }

export function TextBlock({ text }: { text: string }) {
  const plugins = useNestedMarkdownPlugins()
  return (
    <div className="min-w-0" data-a2ui-node={TEXT_COMPONENT}>
      <MarkdownRenderer content={text} remarkPlugins={plugins} />
    </div>
  )
}

export function catalogCardSchemas(): CardSchema[] {
  return answerCardSchema.options.filter((schema) => cardTypeOf(schema) !== 'surface')
}

let catalogApi: Catalog<ComponentApi> | null = null

export function cardsCatalogApi(): Catalog<ComponentApi> {
  catalogApi ??= new Catalog(CARDS_CATALOG_ID, A2UI_PROTOCOL_VERSION, [
    ...catalogCardSchemas().map(cardComponentApi),
    RowApi,
    ColumnApi,
    TabsApi,
    TextApi,
  ])
  return catalogApi
}

export const SURFACE_EXCLUDED_LEAVES: ReadonlySet<string> = new Set([
  'surface',
  'memory_proposal',
  'document_grid',
  'document_draft',
  'task_created',
  'file_operation_proposal',
  'operation_proposal',
  'project_profile_patch',
  'canvas_activity',
  'look',
  'revision_compare',
])

export function preflight(components: Record<string, unknown>[], { surface = true } = {}): string | null {
  const registry = cardsCatalogApi().components
  for (const { id, component, ...props } of components) {
    if (surface && SURFACE_EXCLUDED_LEAVES.has(String(component))) {
      return `'${String(id)}': a '${String(component)}' cannot sit inside a surface`
    }
    const api = registry.get(String(component))
    if (!api) return `'${String(id)}': no component '${String(component)}' in the catalog`
    const result = api.schema.safeParse(props)
    if (!result.success) return `'${String(id)}' (${String(component)}): ${result.error.issues[0]?.message ?? 'invalid'}`
  }
  return structuralRefusal(components)
}

function childIds(component: Record<string, unknown>): string[] {
  if (Array.isArray(component.children)) return component.children.map(String)
  if (!Array.isArray(component.tabs)) return []
  return component.tabs.map((tab) => String((tab as { child?: unknown }).child))
}

export function structuralRefusal(components: Record<string, unknown>[]): string | null {
  const byId = new Map<string, Record<string, unknown>>()
  for (const component of components) {
    const id = String(component.id)
    if (byId.has(id)) return `'${id}': the id is used twice`
    byId.set(id, component)
  }
  if (!byId.has('root')) return "no 'root' component"
  const referenced = new Set<string>()
  for (const [id, component] of byId) {
    for (const child of childIds(component)) {
      if (!byId.has(child)) return `'${id}': child '${child}' does not exist`
      if (referenced.has(child)) return `'${child}': referenced more than once`
      referenced.add(child)
    }
  }
  const reached = new Set<string>()
  const pending = ['root']
  while (pending.length > 0) {
    const id = pending.pop() as string
    if (reached.has(id)) return `'${id}': the surface has a cycle`
    reached.add(id)
    pending.push(...childIds(byId.get(id) as Record<string, unknown>))
  }
  const orphan = [...byId.keys()].find((id) => !reached.has(id))
  return orphan ? `'${orphan}': not reachable from 'root'` : null
}
