// drop after release 2026-W51
const WRITTEN_AS: Readonly<Record<string, string>> = {
  'agent.mark.decided': 'piloti.mark.decided',
  'agent.wake.started': 'piloti.wake.started',
  'agent.wake.ended': 'piloti.wake.ended',
  'agent.wake.stopped': 'piloti.wake.stopped',
  'agent.wake.suppressed': 'piloti.wake.suppressed',
  'agent.change.applied': 'piloti.change.applied',
  'agent.change.undone': 'piloti.change.undone',
  'agent.proposal.created': 'piloti.proposal.created',
  'agent.proposal.decided': 'piloti.proposal.decided',
}

export function writtenAuditAction(action: string): string {
  return WRITTEN_AS[action] ?? action
}
