import type { TrackedFile } from './types'

const STORAGE_KEY = 'documents_active_jobs'

export interface PersistedJob {
  jobId: string
  collectionName: string
  files: Omit<TrackedFile, 'file'>[]
  startedAt: number
}

const MAX_JOB_AGE_MS = 30 * 60 * 1000

export const getPersistedJobs = (): PersistedJob[] => {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    if (!data) return []

    const jobs: PersistedJob[] = JSON.parse(data)

    const now = Date.now()
    const activeJobs = jobs.filter((job) => now - job.startedAt < MAX_JOB_AGE_MS)

    if (activeJobs.length !== jobs.length) {
      savePersistedJobs(activeJobs)
    }

    return activeJobs
  } catch {
    return []
  }
}

export const getPersistedJobForCollection = (collectionName: string): PersistedJob | null => {
  const jobs = getPersistedJobs()
  return jobs.find((job) => job.collectionName === collectionName) || null
}

const savePersistedJobs = (jobs: PersistedJob[]): void => {
  try {
    if (jobs.length === 0) {
      localStorage.removeItem(STORAGE_KEY)
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs))
    }
  } catch {
    // Silently fail if localStorage is not available
  }
}

export const persistJob = (
  jobId: string,
  collectionName: string,
  files: TrackedFile[]
): void => {
  const jobs = getPersistedJobs()

  const persistedFiles: Omit<TrackedFile, 'file'>[] = files.map(({ file: _file, ...rest }) => rest)

  const newJob: PersistedJob = {
    jobId,
    collectionName,
    files: persistedFiles,
    startedAt: Date.now(),
  }

  const existingIndex = jobs.findIndex((j) => j.collectionName === collectionName)
  if (existingIndex >= 0) {
    jobs[existingIndex] = newJob
  } else {
    jobs.push(newJob)
  }

  savePersistedJobs(jobs)
}

export const updatePersistedJobFiles = (jobId: string, files: TrackedFile[]): void => {
  const jobs = getPersistedJobs()
  const jobIndex = jobs.findIndex((j) => j.jobId === jobId)

  if (jobIndex >= 0) {
    const persistedFiles: Omit<TrackedFile, 'file'>[] = files.map(({ file: _file, ...rest }) => rest)
    jobs[jobIndex].files = persistedFiles
    savePersistedJobs(jobs)
  }
}

export const removePersistedJob = (jobId: string): void => {
  const jobs = getPersistedJobs()
  const filtered = jobs.filter((j) => j.jobId !== jobId)
  savePersistedJobs(filtered)
}

export const removePersistedJobForCollection = (collectionName: string): void => {
  const jobs = getPersistedJobs()
  const filtered = jobs.filter((j) => j.collectionName !== collectionName)
  savePersistedJobs(filtered)
}

export const clearAllPersistedJobs = (): void => {
  localStorage.removeItem(STORAGE_KEY)
}

const COLLECTIONS_STORAGE_KEY = 'documents_sessions_with_collections'

const MAX_TRACKED_SESSIONS = 200

const getTrackedSessions = (): string[] => {
  try {
    const data = localStorage.getItem(COLLECTIONS_STORAGE_KEY)
    if (!data) return []
    return JSON.parse(data) as string[]
  } catch {
    return []
  }
}

const saveTrackedSessions = (sessions: string[]): void => {
  try {
    if (sessions.length === 0) {
      localStorage.removeItem(COLLECTIONS_STORAGE_KEY)
    } else {
      localStorage.setItem(COLLECTIONS_STORAGE_KEY, JSON.stringify(sessions))
    }
  } catch {
    // Silently fail if localStorage is not available
  }
}

export const sessionHasKnownCollection = (sessionId: string): boolean => {
  return getTrackedSessions().includes(sessionId)
}

export const markSessionHasCollection = (sessionId: string): void => {
  const sessions = getTrackedSessions()

  if (sessions.includes(sessionId)) return

  sessions.push(sessionId)

  while (sessions.length > MAX_TRACKED_SESSIONS) {
    sessions.shift()
  }

  saveTrackedSessions(sessions)
}

export const unmarkSessionCollection = (sessionId: string): void => {
  const sessions = getTrackedSessions()
  const filtered = sessions.filter((id) => id !== sessionId)
  saveTrackedSessions(filtered)
}
