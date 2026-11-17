export const tasks = {
  cadence: {
    once: 'One-off',
  },
  create: {
    delegate: 'Delegate',
    delegateHint: 'Delegation happens in chat: ask {productName} to take something on.',
    task: 'New task',
  },
  view: {
    label: 'View',
    list: 'List',
    timetable: 'Timetable',
  },
  standing: {
    heading: 'Standing tasks',
    emptyTitle: 'No standing tasks yet',
    emptyDescription:
      'Create a task — with a rhythm it runs on its own, without one it waits for you.',
  },
  filters: {
    label: 'Filter tasks',
    all: 'All',
    active: 'Running',
    unreviewed: 'Unreviewed',
    failed: 'Failed',
    showAll: 'Show all tasks',
  },
  buckets: {
    today: 'Today',
    yesterday: 'Yesterday',
    week: 'This week',
    earlier: 'Earlier',
  },
  card: {
    openAria: 'Open “{title}”',
    unreviewed: 'Not reviewed yet',
    toReview: 'To review',
  },
  result: {
    document: 'Open document',
    conversation: 'Continue in chat',
  },
  detail: {
    close: 'Close details',
    edit: 'Edit',
    result: 'Result',
    request: 'Request',
    schedule: 'Schedule',
    prompt: 'Prompt',
    runs: 'Tasks',
    promote: 'Save as a standing task',
    promoteHint: 'Opens the task wizard with this request filled in. Nothing is saved until the last step, and this run stays as it is.',
    gone: 'This no longer exists. It may have been deleted.',
    goneUnresolved:
      'This could not be found here. The link may point to another project, or the item was deleted.',
    goneTitle: 'Not found',
    loadingTitle: 'Loading',
    runLoading: 'Loading what this run did…',
    runUnavailable: 'The full account of this run could not be loaded.',
    openThread: 'Open in the conversation',
  },
  list: {
    emptyTitle: 'Nothing delegated yet',
    emptyDescription:
      'Ask {productName} to take something on in a chat, or send a draft back for revision — it turns up here.',
    emptyFiltered: {
      active: 'Nothing is running right now',
      unreviewed: 'Everything finished has been reviewed',
      failed: 'Nothing has failed',
    },
    errorTitle: 'The task list could not be loaded',
    errorDescription: 'The rest of the project is unaffected. Try again in a moment.',
    retry: 'Try again',
  },
  kind: {
    'deep-research': 'Research',
    chat: 'Chat',
    compliance_check: 'Compliance check',
    submission_check: 'Submission check',
    document: 'Document',
    revision: 'Revision',
  },
  status: {
    queued: 'Queued',
    running: 'Running',
    succeeded: 'Done',
    failed: 'Failed',
    interrupted: 'Stopped',
    skipped: 'Skipped',
    error: 'Submission failed',
  },
  review: {
    accepted: 'Accepted',
    rejected: 'Sent back',
  },
  meta: {
    byOn: '{name} · {when}',
    on: '{when}',
  },
}
