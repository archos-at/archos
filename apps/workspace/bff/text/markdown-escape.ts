// eslint-disable-next-line no-control-regex -- the separators are the point: Python's splitlines ends a line at them
const MARKER_AT_START = /(?<=^|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029])([^\S\n\r\v\f\u2028\u2029]*)(#{1,6}|[+-])(?=[\s\x1c-\x1f\x85]|[+-]|$)/g
// eslint-disable-next-line no-control-regex -- as above
const ORDINAL_AT_START = /(?<=^|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029])([^\S\n\r\v\f\u2028\u2029]*\d{1,9})([.)])(?=[\s\x1c-\x1f\x85]|$)/g
// eslint-disable-next-line no-control-regex -- as above
const SETEXT_LINE = /(?<=^|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029])([^\S\n\r\v\f\u2028\u2029]*)(=+[^\S\n\r\v\f\u2028\u2029]*)(?=$|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029])/g

export function escapeInline(text: string): string {
  return text.replace(/[\\`*_[\]<>|~]/g, (char) => `\\${char}`)
}

export function escapeLineStarts(text: string): string {
  return text
    .replace(MARKER_AT_START, (_match, indent: string, marker: string) => `${indent}\\${marker}`)
    .replace(ORDINAL_AT_START, (_match, digits: string, mark: string) => `${digits}\\${mark}`)
    .replace(SETEXT_LINE, (_match, indent: string, rule: string) => `${indent}\\${rule}`)
}

export function escapeMarkdown(text: string): string {
  return escapeLineStarts(escapeInline(text))
}
