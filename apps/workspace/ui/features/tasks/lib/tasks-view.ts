export const TASKS_VIEWS = ['list', 'timetable'] as const
export type TasksView = (typeof TASKS_VIEWS)[number]

export function parseTasksView(value: string | undefined): TasksView {
  return (TASKS_VIEWS as readonly string[]).includes(value ?? '')
    ? (value as TasksView)
    : 'list'
}
