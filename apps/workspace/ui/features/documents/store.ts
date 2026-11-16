import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { DocumentsStore, DocumentsState, TrackedFile } from './types'
import { DEFAULT_JOB_BANNER_STATE } from './types'

const initialState: DocumentsState = {
  currentCollectionName: null,
  collectionInfo: null,
  trackedFiles: [],
  activeJobId: null,
  isCreatingCollection: false,
  isUploading: false,
  isPolling: false,
  isLoadingFiles: false,
  loadedSessionId: null,
  recentlyDeletedIds: new Set<string>(),
  error: null,
  nameStopped: null,
  shownBannersForJobs: {},
}

import { trackedStatusOfJobFile } from './utils'
import { jobFileOfRow } from './lib/job-file-match'

export const useDocumentsStore = create<DocumentsStore>()(
  devtools(
    (set) => ({
      ...initialState,

      setCurrentCollection: (name) => {
        set({ currentCollectionName: name }, false, 'setCurrentCollection')
      },

      setCollectionInfo: (info) => {
        set({ collectionInfo: info }, false, 'setCollectionInfo')
      },

      addTrackedFile: (file) => {
        set(
          (state) => {
            const next = [...state.trackedFiles, file]
            return { trackedFiles: next }
          },
          false,
          'addTrackedFile'
        )
      },

      updateTrackedFile: (id, updates) => {
        set(
          (state) => ({
            trackedFiles: state.trackedFiles.map((f) => (f.id === id ? { ...f, ...updates } : f)),
          }),
          false,
          'updateTrackedFile'
        )
      },

      setUploadProgress: (id, bytesUploaded) => {
        set(
          (state) => {
            const current = state.trackedFiles.find((f) => f.id === id)
            if (!current || current.bytesUploaded === bytesUploaded) return state
            return {
              trackedFiles: state.trackedFiles.map((f) => (f.id === id ? { ...f, bytesUploaded } : f)),
            }
          },
          false,
          'setUploadProgress'
        )
      },

      removeTrackedFile: (id) => {
        set(
          (state) => {
            const file = state.trackedFiles.find((f) => f.id === id)
            const nextDeleted = new Set(state.recentlyDeletedIds)
            if (file) {
              nextDeleted.add(file.id)
              if (file.serverFileId) nextDeleted.add(file.serverFileId)
            }
            return {
              trackedFiles: state.trackedFiles.filter((f) => f.id !== id),
              recentlyDeletedIds: nextDeleted,
            }
          },
          false,
          'removeTrackedFile'
        )
      },

      dismissTrackedFiles: (ids) => {
        set(
          (state) => {
            const dropping = new Set(ids)
            const next = state.trackedFiles.filter((f) => !dropping.has(f.id))
            if (next.length === state.trackedFiles.length) return state
            return { trackedFiles: next }
          },
          false,
          'dismissTrackedFiles'
        )
      },

      unmarkRecentlyDeleted: (file) => {
        set(
          (state) => {
            const nextDeleted = new Set(state.recentlyDeletedIds)
            nextDeleted.delete(file.id)
            if (file.serverFileId) nextDeleted.delete(file.serverFileId)
            return { recentlyDeletedIds: nextDeleted }
          },
          false,
          'unmarkRecentlyDeleted'
        )
      },

      removeRecentlyDeletedIds: (ids: string[]) => {
        set(
          (state) => {
            if (ids.length === 0) return state
            const nextDeleted = new Set(state.recentlyDeletedIds)
            let changed = false
            for (const id of ids) {
              if (id && nextDeleted.delete(id)) changed = true
            }
            if (!changed) return state
            return { recentlyDeletedIds: nextDeleted }
          },
          false,
          'removeRecentlyDeletedIds'
        )
      },

      clearTrackedFiles: () => {
        set({ trackedFiles: [] }, false, 'clearTrackedFiles')
      },

      clearFilesForCollection: (collectionName) => {
        set(
          (state) => ({
            trackedFiles: state.trackedFiles.filter((f) => f.collectionName !== collectionName),
            recentlyDeletedIds: new Set<string>(),
          }),
          false,
          'clearFilesForCollection'
        )
      },

      setActiveJobId: (jobId) => {
        set({ activeJobId: jobId }, false, 'setActiveJobId')
      },

      setCreatingCollection: (loading) => {
        set({ isCreatingCollection: loading }, false, 'setCreatingCollection')
      },

      setUploading: (loading) => {
        set({ isUploading: loading }, false, 'setUploading')
      },

      setPolling: (polling) => {
        set({ isPolling: polling }, false, 'setPolling')
      },

      setLoadingFiles: (loading) => {
        set({ isLoadingFiles: loading }, false, 'setLoadingFiles')
      },

      setError: (error) => {
        set({ error }, false, 'setError')
      },

      clearError: () => {
        set({ error: null, nameStopped: null }, false, 'clearError')
      },

      setNameStopped: (nameStopped) => {
        set({ nameStopped }, false, 'setNameStopped')
      },

      updateFilesFromJobStatus: (jobStatus) => {
        set(
          (state) => {
            const updatedFiles = state.trackedFiles.map((file) => {
              if (file.status === 'deleting' || file.status === 'canceled') return file

              if (file.jobId && file.jobId !== jobStatus.job_id) return file
              if (file.collectionName && file.collectionName !== jobStatus.collection_name) return file

              const jobFile = jobFileOfRow(file, jobStatus.file_details)

              if (!jobFile) return file

              return {
                ...file,
                status: trackedStatusOfJobFile(jobFile),
                progress: jobFile.progress_percent,
                errorMessage: jobFile.error_message,
                quarantine: jobFile.quarantine ?? null,
                serverFileId: jobFile.file_id,
              }
            })

            return { trackedFiles: updatedFiles }
          },
          false,
          'updateFilesFromJobStatus'
        )
      },

      setFilesFromServer: (collectionName, files) => {
        set(
          (state) => {
            const existingFilesMap = new Map(
              state.trackedFiles
                .filter((f) => f.collectionName === collectionName)
                .map((f) => [f.serverFileId || f.id, f])
            )

            const serverFileIds = new Set(files.map((f) => f.file_id))
            const serverFileNames = new Set(files.map((f) => f.file_name))
            const tombstoneIds = state.recentlyDeletedIds
            const transientStatuses = new Set(['uploading', 'ingesting', 'deleting', 'canceled'])
            const preservedTransient = state.trackedFiles.filter(
              (f) =>
                f.collectionName === collectionName &&
                transientStatuses.has(f.status) &&
                !serverFileIds.has(f.serverFileId ?? '') &&
                !serverFileIds.has(f.id)
            )
            const preservedSuccessNotOnServer = state.trackedFiles.filter(
              (f) =>
                f.collectionName === collectionName &&
                f.status === 'success' &&
                (f.serverFileId ?? '') !== '' &&
                !serverFileIds.has(f.serverFileId ?? '') &&
                !serverFileNames.has(f.fileName) &&
                !tombstoneIds.has(f.serverFileId ?? '') &&
                !tombstoneIds.has(f.id)
            )
            const preservedFiles = [...preservedTransient, ...preservedSuccessNotOnServer]

            const otherFiles = state.trackedFiles.filter((f) => f.collectionName !== collectionName)

            const excludedIds = new Set(
              preservedFiles.flatMap((f) => [f.serverFileId ?? '', f.id, f.fileName])
            )

            const serverFiles: TrackedFile[] = files
              .filter(
                (f) =>
                  !tombstoneIds.has(f.file_id) &&
                  !excludedIds.has(f.file_id) &&
                  !excludedIds.has(f.file_name)
              )
              .map((file) => {
                const existingFile = existingFilesMap.get(file.file_id)
                return {
                  id: file.file_id, // Use server ID as local ID
                  fileName: file.file_name,
                  fileSize: file.file_size || 0,
                  status: trackedStatusOfJobFile(file),
                  progress: file.status === 'success' ? 100 : 0,
                  errorMessage: file.error_message,
                  quarantine: file.quarantine ?? null,
                  serverFileId: file.file_id,
                  collectionName, // Use parameter, not file.collection_name, for consistent filtering
                  jobId: existingFile?.jobId,
                  uploadedAt: existingFile?.uploadedAt || file.uploaded_at,
                }
              })

            const resultTrackedFiles = [...otherFiles, ...serverFiles, ...preservedFiles]
            return {
              trackedFiles: resultTrackedFiles,
              loadedSessionId: collectionName,
            }
          },
          false,
          'setFilesFromServer'
        )
      },

      markBannerShown: (jobId, type) => {
        set(
          (state) => {
            const existing = state.shownBannersForJobs[jobId] || DEFAULT_JOB_BANNER_STATE
            return {
              shownBannersForJobs: {
                ...state.shownBannersForJobs,
                [jobId]: {
                  ...existing,
                  [type]: true,
                },
              },
            }
          },
          false,
          'markBannerShown'
        )
      },
    }),
    { name: 'DocumentsStore' }
  )
)

export const selectFilesInProgress = (state: DocumentsState): TrackedFile[] =>
  state.trackedFiles.filter((f) => f.status === 'uploading' || f.status === 'ingesting')

export const selectCompletedFiles = (state: DocumentsState): TrackedFile[] =>
  state.trackedFiles.filter((f) => f.status === 'success')

export const selectFailedFiles = (state: DocumentsState): TrackedFile[] =>
  state.trackedFiles.filter((f) => f.status === 'failed')
