import { buildModelHref, parseModelView, type BimModelView } from './model-link'

export interface BimElementRef {
  globalId: string
  ifcType: string
  name: string | null
  storeyName?: string | null
}

function readableType(ifcType: string): string {
  return ifcType.replace(/^Ifc/, '').replace(/StandardCase$/, '')
}

export function describeElement(element: BimElementRef): string {
  const type = readableType(element.ifcType)
  const named = element.name?.trim()
  const base = named ? `${type} „${named}“` : type
  return element.storeyName ? `${base} (${element.storeyName})` : base
}

export function buildElementQuestion(
  element: BimElementRef,
  options: { modelFilename?: string | null } = {}
): string {
  const parts = [`Was gilt für ${describeElement(element)} im Modell?`]
  const context = [`GlobalId ${element.globalId}`]
  if (options.modelFilename) context.push(`Modell ${options.modelFilename}`)
  parts.push(`(${context.join(', ')})`)
  return parts.join(' ')
}

export function elementQuestionHref(
  projectId: string,
  element: BimElementRef,
  options: { modelFilename?: string | null } = {}
): string {
  const params = new URLSearchParams({ ask: buildElementQuestion(element, options) })
  return `/app/projects/${projectId}/chat?${params.toString()}`
}

export interface BimElementLink {
  projectId: string
  view: BimModelView
}

const MODEL_PATH = /^\/app\/projects\/([^/?#]+)\/(files|model)(?:\?([^#]*))?$/

const VIEW_PARAMS = ['model', 'element', 'storey', 'hl', 'xray', 'tab', 'view', 'cut']

export function parseElementLink(href: string | undefined): BimElementLink | null {
  if (!href) return null
  let path = href
  if (/^https?:\/\//i.test(href)) {
    try {
      const url = new URL(href)
      path = `${url.pathname}${url.search}`
    } catch {
      return null
    }
  }
  const match = MODEL_PATH.exec(path)
  if (!match) return null
  let projectId: string
  try {
    projectId = decodeURIComponent(match[1])
  } catch {
    return null
  }
  if (!projectId) return null

  const search = match[3] ?? ''
  if (match[2] === 'files') {
    const params = new URLSearchParams(search)
    if (!VIEW_PARAMS.some((name) => params.has(name))) return null
  }
  return { projectId, view: parseModelView(search) }
}

export function elementLinkHref(link: BimElementLink): string {
  return buildModelHref(link.projectId, link.view)
}
