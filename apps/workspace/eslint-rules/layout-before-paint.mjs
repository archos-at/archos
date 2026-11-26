const HOOK = 'useIsMobile'

const isHookCall = (node) =>
  node?.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === HOOK && node.arguments.length === 0

const isJsx = (node) => {
  if (!node) return false
  if (node.type === 'JSXElement' || node.type === 'JSXFragment') return true
  if (node.type === 'ConditionalExpression') return isJsx(node.consequent) || isJsx(node.alternate)
  if (node.type === 'LogicalExpression') return isJsx(node.right)
  return false
}

const isNull = (node) => node?.type === 'Literal' && node.value === null

const isJsxChild = (node) =>
  node.parent?.type === 'JSXExpressionContainer' && (node.parent.parent?.type === 'JSXElement' || node.parent.parent?.type === 'JSXFragment')

const rendersWhat = (node) => node.parent?.type === 'JSXExpressionContainer' || node.parent?.type === 'ReturnStatement'

const returnsTree = (statement) => {
  if (!statement) return false
  if (statement.type === 'ReturnStatement') return isNull(statement.argument) || isJsx(statement.argument)
  if (statement.type === 'BlockStatement') return statement.body.some(returnsTree)
  return false
}

function structuralUse(start) {
  let node = start
  for (let parent = node.parent; parent; node = parent, parent = parent.parent) {
    if (parent.type === 'UnaryExpression' && parent.operator === '!') continue
    if (parent.type === 'LogicalExpression') {
      if (parent.left === node && parent.operator === '&&' && isJsx(parent.right)) return parent
      if (parent.left === node && isJsxChild(parent)) return parent
      continue
    }
    if (parent.type === 'ConditionalExpression') {
      if (parent.test !== node) return null
      const nullBranch = isNull(parent.consequent) || isNull(parent.alternate)
      return isJsx(parent.consequent) || isJsx(parent.alternate) || isJsxChild(parent) || (nullBranch && rendersWhat(parent)) ? parent : null
    }
    if (parent.type === 'IfStatement') {
      return parent.test === node && (returnsTree(parent.consequent) || returnsTree(parent.alternate)) ? parent : null
    }
    return null
  }
  return null
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'A phone and a desktop tree are chosen by CSS before the first paint, never by useIsMobile()' },
    schema: [],
    messages: {
      structural:
        'useIsMobile() is false on the server and in the hydration render, so this paints the desktop tree on a phone and swaps it after the bundle boots (the search register, 2026-11-25). Render both with `MobileLayoutOnly` / `DesktopLayoutOnly` from `@/components/ui/layout-only`, or `md:hidden` / `max-md:hidden`. An overlay that only opens on a click may read `useIsMobileOnceKnown()`.',
    },
  },

  create(context) {
    const names = new Set()
    const report = (node) => {
      const use = structuralUse(node)
      if (use) context.report({ node: use, messageId: 'structural' })
    }
    return {
      VariableDeclarator(declarator) {
        if (declarator.id.type !== 'Identifier') return
        const init = declarator.init?.type === 'UnaryExpression' && declarator.init.operator === '!' ? declarator.init.argument : declarator.init
        if (isHookCall(init)) names.add(declarator.id.name)
      },
      CallExpression(call) {
        if (isHookCall(call)) report(call)
      },
      Identifier(identifier) {
        if (names.has(identifier.name) && identifier.parent?.type !== 'VariableDeclarator') report(identifier)
      },
    }
  },
}
