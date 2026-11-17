import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import type {
  LayoutState,
  LayoutStore,
  DataSourcesPanelTab,
  SourcePresetId,
  ThemeMode,
} from './types'
import { createDataSourcesClient, type DataSourceFromAPI } from '@/adapters/api'

const initialState: LayoutState = {
  isSessionsPanelOpen: false,
  dataSourcesPanelTab: 'connections',
  enabledDataSourceIds: [], // Start empty, populated when data sources are fetched
  theme: 'system',
  showTechnicalReasoning: false,
  availableDataSources: null,
  knowledgeLayerAvailable: false, // Default to false until API confirms availability
  vlmAvailable: false, // Default to false until API confirms the VLM capability
  dataSourcesLoading: false,
  dataSourcesError: null,
  activeSourcePreset: null,
  dataSourcePanelTab: 'connections',
}

export const useLayoutStore = create<LayoutStore>()(
  devtools(
    persist(
      (set) => ({
        ...initialState,

      toggleSessionsPanel: () =>
        set(
          (state) => ({ isSessionsPanelOpen: !state.isSessionsPanelOpen }),
          false,
          'toggleSessionsPanel'
        ),

      setSessionsPanelOpen: (open: boolean) =>
        set({ isSessionsPanelOpen: open }, false, 'setSessionsPanelOpen'),

      setDataSourcesPanelTab: (tab: DataSourcesPanelTab) =>
        set({ dataSourcesPanelTab: tab }, false, 'setDataSourcesPanelTab'),

      toggleDataSource: (id: string) =>
        set(
          (state) => {
            const isEnabled = state.enabledDataSourceIds.includes(id)
            return {
              enabledDataSourceIds: isEnabled
                ? state.enabledDataSourceIds.filter((sourceId) => sourceId !== id)
                : [...state.enabledDataSourceIds, id],
              activeSourcePreset: null,
            }
          },
          false,
          'toggleDataSource'
        ),

      setEnabledDataSources: (ids: string[]) =>
        set({ enabledDataSourceIds: ids, activeSourcePreset: null }, false, 'setEnabledDataSources'),

      setTheme: (theme: ThemeMode) => set({ theme }, false, 'setTheme'),


      setShowTechnicalReasoning: (on: boolean) =>
        set({ showTechnicalReasoning: on }, false, 'setShowTechnicalReasoning'),

      applySourcePreset: (preset: SourcePresetId | null, enabledIds: string[]) =>
        set(
          { activeSourcePreset: preset, enabledDataSourceIds: enabledIds },
          false,
          'applySourcePreset'
        ),

      fetchDataSources: async (authToken?: string) => {
        set({ dataSourcesLoading: true, dataSourcesError: null }, false, 'fetchDataSources/start')

        try {
          const client = createDataSourcesClient({ authToken })
          const response = await client.getDataSources()

          const enabledIds = response.data_sources.map((source) => source.id)

          set(
            {
              availableDataSources: response.data_sources,
              knowledgeLayerAvailable: response.knowledge_layer,
              vlmAvailable: response.vlm_available,
              enabledDataSourceIds: enabledIds,
              activeSourcePreset: null,
              dataSourcesLoading: false,
              dataSourcesError: null,
            },
            false,
            'fetchDataSources/success'
          )
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to fetch data sources'
          set(
            {
              dataSourcesLoading: false,
              dataSourcesError: errorMessage,
            },
            false,
            'fetchDataSources/error'
          )
        }
      },

      disableAuthRequiredSources: () =>
        set(
          (state) => ({
            enabledDataSourceIds: state.enabledDataSourceIds.filter((id) => {
              const source = state.availableDataSources?.find((s) => s.id === id)
              return !source?.requires_auth
            }),
          }),
          false,
          'disableAuthRequiredSources'
        ),

      setAvailableDataSources: (sources: DataSourceFromAPI[]) =>
        set({ availableDataSources: sources }, false, 'setAvailableDataSources'),

      setKnowledgeLayerAvailable: (available: boolean) =>
        set({ knowledgeLayerAvailable: available }, false, 'setKnowledgeLayerAvailable'),

      setVlmAvailable: (available: boolean) =>
        set({ vlmAvailable: available }, false, 'setVlmAvailable'),

      setDataSourcePanelTab: (tab: DataSourcesPanelTab) =>
        set(
          { dataSourcesPanelTab: tab, dataSourcePanelTab: tab },
          false,
          'setDataSourcePanelTab'
        ),
    }),
      {
        name: 'layout',
        partialize: (state) => ({
          theme: state.theme,
          showTechnicalReasoning: state.showTechnicalReasoning,
        }),
      }
    ),
    { name: 'LayoutStore' }
  )
)
