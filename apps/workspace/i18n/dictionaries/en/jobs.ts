export const jobs = {
  title: 'Tasks',
  backToList: 'Back to list',
  loadError: 'The tasks could not be loaded.',
  tryAgain: 'Try again',

  list: {
    heading: 'Tasks',
    empty: {
      title: 'No tasks yet',
      description:
        'A task is a request with or without a rhythm. Write it once, say when it runs, and let {productName} research and file the report while you are somewhere else.',
      action: 'New task',
    },
    manualOnly: 'Manual only',
    onceOn: 'Once on {time}',
    onceDone: 'Done',
    nextRun: 'Next {time}',
    lastRun: 'Last {time}',
    neverRun: 'Never run',
    disabled: 'Paused',
    enableAria: 'Resume task “{name}”',
    disableAria: 'Pause task “{name}”',
    toggleError: 'The task could not be updated.',
    withSkill: 'Skill: {name}',
    noSkill: 'No skill',
    output: {
      chat: 'Chat',
      'deep-research': 'Report',
    },
  },

  card: {
    openAria: 'Open task “{name}”',
  },

  actions: {
    edit: 'Edit',
    runNow: 'Run now',
    delete: 'Delete',
  },

  timetable: {
    title: 'The week',
    legend: 'Tasks on this grid',
    thisWeek: 'This week',
    today: 'Today',
    previousWeek: 'Previous week',
    nextWeek: 'Next week',
    showFullDay: 'Show all 24 hours',
    showActiveHours: 'Show active hours only',
    nothing: 'Nothing',
    gap: '{hours} h',
    unplaceable: 'Not shown on the grid: {names}',
    emptyNoSchedules: 'Nothing scheduled yet',
    emptyNoSchedulesHint: 'Create a task with a rhythm and this week fills in.',
    emptyThisWeek: 'Nothing fires this week',
  },

  schedule: {
    frequency: {
      hourly: 'Hourly',
      daily: 'Daily',
      weekly: 'Weekly',
      monthly: 'Monthly',
    },
    summaryHourly: 'Hourly at :{minute}',
    summaryDaily: 'Daily at {time}',
    summaryWeekly: 'Every {weekday} at {time}',
    summaryWeekdays: 'Weekdays at {time}',
    summaryMonthly: 'Monthly on the {day}. at {time}',
    summaryCustom: 'Custom ({cron})',
    inTimezone: '{summary} · {timezone}',
  },

  run: {
    submitted: 'Started.',
    submittedDetail: 'It is running now — follow it under Tasks.',
    skipped: 'Skipped',
    error: 'That could not be started.',
    disabled: 'Resume the task before running it.',
  },

  deleteDialog: {
    title: 'Delete task',
    description: 'This permanently deletes “{name}” and its history. This cannot be undone.',
    confirm: 'Delete task',
    cancel: 'Cancel',
    error: 'The task could not be deleted.',
  },

  builder: {
    stepsLabel: 'Steps',
    stepProgress: 'Step {current} of {total}',
    steps: {
      task: 'Task',
      schedule: 'When',
      review: 'Review',
      taskTitle: 'What should {productName} do?',
      taskHint:
        'Write it exactly as you would type it into a new chat. {productName} starts with no other context.',
      scheduleTitle: 'When should it run?',
      scheduleHint:
        'Once, recurring or on request — the next times are shown underneath, to check before you commit.',
      reviewTitle: 'Ready',
      reviewHint: 'This is what will happen. Nothing has been saved yet.',
    },
    next: 'Continue',
    back: 'Back',
    cancel: 'Cancel',
    create: 'Create task',
    save: 'Save task',
    saving: 'Saving…',

    nameLabel: 'Name',
    namePlaceholder: 'e.g. Weekly OIB fire-safety scan',
    nameHint: 'What this is called in the list. Left empty, the first line above is used.',
    nameRequired: 'A name is required.',
    nameTooLong: 'The name is too long (max 200 characters).',

    promptLabel: 'The request',
    promptPlaceholder:
      'Check the current project documents for open fire-safety points and list every deviation with its OIB clause.',
    promptHint: 'This is what fires, word for word, every time.',
    promptRequired: 'A request is required.',
    promptTooLong: 'The request is too long (max 8000 characters).',

    advancedSources: 'Data sources',
    advancedSchedule: 'Timezone and cron',

    sourcesSection: 'Data sources',
    sourcesSummary: '{count} extra sources',
    knowledgeAlways:
      'Project documents, the OIB knowledge base and Austrian law (RIS) — always included in every run',
    additionalSourcesLabel: 'Additional sources',
    sourcesHint:
      'Add sources beyond the knowledge base. Leave all unchecked to allow every available source.',
    sourcesAll: 'All available sources',
    sourcesLoading: 'Loading sources…',
    sourcesError: 'Sources could not be loaded — the task will use all available sources.',

    scheduleSection: 'When',
    cadence: {
      label: 'When should this task run',
      once: 'Once',
      onceHint: 'On a date you choose. After that it is done.',
      recurring: 'Recurring',
      recurringHint: 'On a rhythm, again and again.',
      manual: 'Manual only',
      manualHint: 'Runs only when you press “Run now”.',
    },
    dueAtLabel: 'Due date',
    dueAtHint: 'In your local time. The task runs exactly once.',
    presetLabel: 'How often',
    timeLabel: 'At',
    minuteLabel: 'At minute',
    minutePast: '{minute} past the hour',
    weekdayLabel: 'On',
    weekdayHint: 'Pick as many days as you need — Mon to Fri reads as “weekdays”.',
    monthDayLabel: 'On the',
    monthDayValue: '{day}.',
    upcomingLabel: 'Next times',
    upcomingNone: 'This never fires — it only runs when started by hand.',

    customCronLabel: 'Write a cron expression',
    customCronHint: 'For rhythms the four options above cannot express.',
    cronLabel: 'Cron expression',
    cronPlaceholder: '0 6 * * 1',
    cronHint: 'Five fields: minute hour day-of-month month day-of-week.',
    cronInvalid: 'Enter a valid 5-field cron expression.',
    timezoneLabel: 'Timezone',
    timezoneHint: 'The task fires by the clock in this zone, daylight saving included.',

    enabledLabel: 'Active',
    enabledHint: 'A paused task never fires and cannot be run by hand.',

    reviewSentence: '{productName} researches a report {cadence} and files it in the project.',
    reviewSentenceOnce: '{productName} researches a report and files it in the project — once, on {dueAt}.',
    reviewSentenceManual:
      '{productName} researches a report and files it in the project, each time you start it by hand.',

    createAndRun: 'Create and run now',
    saveAndRun: 'Save and run now',
    runNowFailed: 'The task is saved; the first run could not be started.',

    createSuccess: 'Task created.',
    updateSuccess: 'Task saved.',
    saveError: 'The task could not be saved.',

    preview: {
      title: 'What the agent receives',
      subtitle:
        'The exact text submitted. The server builds this same prompt at fire time.',
    },
  },

  history: {
    title: 'Task history',
    loading: 'Loading tasks…',
    loadError: 'The history could not be loaded.',
    empty: 'This task has not run yet.',
    openChat: 'Open chat',
    viewProgress: 'View progress',
    scheduler: 'Scheduler',
    trigger: {
      manual: 'Manual',
      schedule: 'Scheduled',
      delegated: 'From chat',
    },
  },
}
