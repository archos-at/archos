const INTERACTIVE_TAGS = new Set(['a', 'button', 'summary', 'Link'])
const CARRIES_COARSE_SIZE = new Set(['Button', 'BusyButton'])
const INTERACTIVE_ROLES = new Set(['button', 'link', 'tab', 'checkbox', 'radio', 'switch', 'menuitem', 'option'])
const FLOOR = 11
const SIZE = /^(?:h|size|min-h)-(\d+(?:\.\d+)?)$/
const SIZE_PX = /^(?:h|size|min-h)-\[(\d+(?:\.\d+)?)px\]$/
const PHONE_PREFIX = /^(?:max-(?:sm|md|lg):|dark:)*/

function stringsInClassName(node, out = []) {
  if (!node || typeof node !== 'object') return out
  if (node.type === 'Literal' && typeof node.value === 'string') out.push(node.value)
  else if (node.type === 'TemplateElement') out.push(node.value.cooked ?? node.value.raw ?? '')
  for (const key of Object.keys(node)) {
    if (key === 'parent' || key === 'loc' || key === 'range') continue
    const child = node[key]
    if (Array.isArray(child)) child.forEach((item) => stringsInClassName(item, out))
    else if (child && typeof child.type === 'string') stringsInClassName(child, out)
  }
  return out
}

function steps(base) {
  const scale = SIZE.exec(base)
  if (scale) return Number(scale[1])
  const px = SIZE_PX.exec(base)
  return px ? Number(px[1]) / 4 : null
}

export function undersized(tokens) {
  if (tokens.some((token) => token === 'touch-target' || token === 'h-auto')) return null
  const coarse = tokens.some((token) => {
    if (!token.startsWith('pointer-coarse:')) return false
    const base = token.slice('pointer-coarse:'.length).replace(/!$/, '')
    if (base === 'h-auto' || base === 'touch-target') return true
    const value = steps(base)
    return value != null && value >= FLOOR
  })
  if (coarse) return null
  for (const token of tokens) {
    const prefix = PHONE_PREFIX.exec(token)[0]
    const base = token.slice(prefix.length).replace(/!$/, '')
    if (base.includes(':')) continue
    const value = steps(base)
    if (value != null && value < FLOOR) return token
  }
  return null
}

function attribute(element, name) {
  return element.attributes.find((item) => item.type === 'JSXAttribute' && item.name.name === name)
}

function interactive(element) {
  if (element.name.type === 'JSXIdentifier' && CARRIES_COARSE_SIZE.has(element.name.name)) return false
  if (element.name.type === 'JSXIdentifier' && INTERACTIVE_TAGS.has(element.name.name)) return true
  const role = attribute(element, 'role')?.value
  if (role?.type === 'Literal' && INTERACTIVE_ROLES.has(role.value)) return true
  return Boolean(attribute(element, 'onClick'))
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'A control a finger presses is at least 44px on a touch screen' },
    schema: [],
    messages: {
      small:
        '`{{token}}` makes this control smaller than 44px under a finger (WCAG 2.5.8). Add `pointer-coarse:size-11`/`pointer-coarse:min-h-11`, `touch-target` on a leaf control, or use `Button`\'s sizes, which carry it.',
    },
  },

  create(context) {
    return {
      JSXOpeningElement(element) {
        if (!interactive(element)) return
        const className = attribute(element, 'className')
        if (!className?.value) return
        const tokens = stringsInClassName(className.value).flatMap((text) => text.split(/\s+/)).filter(Boolean)
        const token = undersized(tokens)
        if (token) context.report({ node: className, messageId: 'small', data: { token } })
      },
    }
  },
}
