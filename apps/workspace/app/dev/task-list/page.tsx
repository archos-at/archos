import { notFound } from 'next/navigation'
import { TaskListPreview } from './task-list-preview'

export default function TaskListPreviewPage() {
  if (process.env.NODE_ENV !== 'development') notFound()
  return <TaskListPreview now={Date.now()} />
}
