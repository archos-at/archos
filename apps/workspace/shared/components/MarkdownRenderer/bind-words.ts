import type { Element, Root, RootContent } from 'hast'

const NBSP = ' '

const UNIT = String.raw`(?:m²|m³|m|cm|mm|km|kN|kg|kW|dB|Pa|%|°C|min|Min\.|Std\.|l)`
const AFTER = String.raw`(?=[\s.,;:)!? ]|$)`
const LABEL = String.raw`(?:Abs\.|Art\.|Z\.|Nr\.|lit\.|Tab\.|Tabelle|Kap\.|Anh\.|Anhang|Punkt|Pkt\.|Seite|S\.|Stand|Index|GK|REI|RE|EI|R|F|OIB-RL)`
const ORDINAL = String.raw`(?:OG|Obergeschoß|Obergeschoss|Stock|Geschoß|Geschoss|UG|Untergeschoß|Absatz)`

const RULES: [RegExp, string][] = [
  [new RegExp(String.raw`(\d) (?=${UNIT}${AFTER})`, 'g'), `$1${NBSP}`],
  [/(§§?) (?=\d)/g, `$1${NBSP}`],
  [new RegExp(String.raw`(^|[\s( ])(${LABEL}) (?=\d)`, 'g'), `$1$2${NBSP}`],
  [new RegExp(String.raw`(\d\.) (?=${ORDINAL}${AFTER})`, 'g'), `$1${NBSP}`],
]

export const bindWords = (text: string): string => RULES.reduce((out, [pattern, to]) => out.replace(pattern, to), text)

const KEEP = new Set(['code', 'pre', 'table', 'ul', 'ol', 'a', 'button', 'svg', 'math'])

const bindIn = (node: Element | Root, inProse: boolean): void => {
  for (const child of node.children as RootContent[]) {
    if (child.type === 'text') {
      if (inProse) child.value = bindWords(child.value)
      continue
    }
    if (child.type !== 'element') continue
    if (KEEP.has(child.tagName)) continue
    const classes = child.properties?.className
    if (Array.isArray(classes) && classes.some((name) => String(name).startsWith('katex'))) continue
    bindIn(child, inProse || child.tagName === 'p')
  }
}

export const rehypeBindWords = () => (tree: Root): void => bindIn(tree, false)
