export interface ComposerCaret {
  start: number
  end: number
}

export interface InsertedTranscript {
  value: string
  caret: number
}

const ABUTS_AFTER = /^[\s.,;:!?)\]}»“"']/
const ABUTS_BEFORE = /[\s([{„«"']$/

export function insertTranscript(
  value: string,
  transcript: string,
  caret: ComposerCaret | null,
): InsertedTranscript | null {
  const text = transcript.trim()
  if (!text) return null
  const at = caret === null ? value.length : Math.min(Math.max(caret.end, 0), value.length)
  const before = value.slice(0, at)
  const after = value.slice(at)
  const lead = before.length > 0 && !ABUTS_BEFORE.test(before) ? ' ' : ''
  const trail = after.length > 0 && !ABUTS_AFTER.test(after) ? ' ' : ''
  return {
    value: `${before}${lead}${text}${trail}${after}`,
    caret: before.length + lead.length + text.length,
  }
}
