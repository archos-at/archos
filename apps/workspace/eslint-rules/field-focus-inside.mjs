const FOCUS = /^(?:[^:[\]]+:)*focus(?:-visible|-within)?:/
const OUTWARD = [/^ring(?:-[0-9]+)?$/, /^ring-offset-[1-9][0-9]*$/, /^outline-offset-[1-9][0-9]*$/]

function outwardFocus(text) {
  const tokens = text.split(/\s+/).filter(Boolean)
  const inset = tokens.some((token) => /(?:^|:)ring-inset!?$/.test(token))
  return tokens.filter((token) => {
    if (!FOCUS.test(token)) return false
    const base = token.replace(FOCUS, '').replace(/!$/, '')
    if (/^ring(?:-[0-9]+)?$/.test(base)) return !inset && base !== 'ring-0'
    return OUTWARD.some((pattern) => pattern.test(base))
  })
}

function stringsInClassName(node, out = []) {
  if (!node || typeof node !== 'object') return out
  if (node.type === 'Literal' && typeof node.value === 'string') out.push({ node, text: node.value })
  else if (node.type === 'TemplateElement') out.push({ node, text: node.value.cooked ?? node.value.raw ?? '' })
  for (const key of Object.keys(node)) {
    if (key === 'parent' || key === 'loc' || key === 'range') continue
    const child = node[key]
    if (Array.isArray(child)) child.forEach((item) => stringsInClassName(item, out))
    else if (child && typeof child.type === 'string') stringsInClassName(child, out)
  }
  return out
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: "A native <input> or <textarea> draws its focus inside its own box, where no clipping ancestor can cut it" },
    schema: [],
    messages: {
      outward:
        '`{{utility}}` draws the field\'s focus outside its box, where a scroll box or clipped card cuts it (the rail\'s rename field, 2026-11-24). Use `Input`/`Textarea`, or `FIELD_FOCUS_RING` from `@/components/ui/focus-ring`, or `ring-inset`.',
    },
  },

  create(context) {
    return {
      JSXOpeningElement(element) {
        if (element.name.type !== 'JSXIdentifier' || !['input', 'textarea'].includes(element.name.name)) return
        const className = element.attributes.find((attribute) => attribute.type === 'JSXAttribute' && attribute.name.name === 'className')
        if (!className?.value) return
        for (const { node, text } of stringsInClassName(className.value)) {
          for (const utility of outwardFocus(text)) context.report({ node, messageId: 'outward', data: { utility } })
        }
      },
    }
  },
}
