const LEADER = /^(?:re|aw|antw|antwort|wg|fw|fwd|wtr|tr|sv|vs|rif|r|rv|enc|odp|pd|doorst|vl|ynt)(?:\[\d+\]|\(\d+\))?\s*[:：]\s*/iu
const GATEWAY = /^(?:\[\s*(?:extern|external|ext|extern\s*e-mail|caution)\s*\]|(?:extern|external|caution)\s*[:\-–])\s*/iu
const TRAILER = /\s*\((?:fwd|fw)\)\s*$/iu
const FORWARD_LEADER = /^(?:wg|fw|fwd|wtr|tr|vl|enc|pd|doorst|rv|ynt)(?:\[\d+\]|\(\d+\))?\s*[:：]/iu

export function displaySubject(subject: string | null | undefined): string | null {
  let current = (subject ?? '').replace(/\s+/gu, ' ').trim()
  for (let previous = ''; previous !== current; ) {
    previous = current
    current = current.replace(TRAILER, '').replace(LEADER, '').replace(GATEWAY, '').trim()
  }
  return current === '' ? null : current
}

export function isForwardSubject(subject: string | null | undefined): boolean {
  let current = (subject ?? '').trim()
  for (let previous = ''; previous !== current; ) {
    if (FORWARD_LEADER.test(current)) return true
    previous = current
    current = current.replace(LEADER, '').replace(GATEWAY, '').trim()
  }
  return false
}

const AFTER_NAME = /^\s*[–—\-:|·/]\s*/u

export function subjectWithinThread(subject: string | null, threadName: string): string | null {
  const name = threadName.trim()
  if (subject === null || name === '' || !subject.toLocaleLowerCase('de').startsWith(name.toLocaleLowerCase('de'))) return subject
  const rest = subject.slice(name.length)
  if (!AFTER_NAME.test(rest)) return subject
  const remainder = rest.replace(AFTER_NAME, '').trim()
  return remainder === '' ? subject : remainder
}
