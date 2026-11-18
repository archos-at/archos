import type { DataSourceFromAPI } from '@/adapters/api'


export type ThemeMode = 'light' | 'dark' | 'system'

export type DataSourcesPanelTab = 'connections' | 'files'

export type SourcePresetId = 'law' | 'project' | 'office'

export interface LayoutState {
  isSessionsPanelOpen: boolean
  dataSourcesPanelTab: DataSourcesPanelTab
  enabledDataSourceIds: string[]
  theme: ThemeMode
  availableDataSources: DataSourceFromAPI[] | null
  knowledgeLayerAvailable: boolean
  vlmAvailable: boolean
  dataSourcesLoading: boolean
  dataSourcesError: string | null
  showTechnicalReasoning: boolean
  activeSourcePreset: SourcePresetId | null
  dataSourcePanelTab: DataSourcesPanelTab
}

export interface LayoutActions {
  toggleSessionsPanel: () => void
  setSessionsPanelOpen: (open: boolean) => void
  setDataSourcesPanelTab: (tab: DataSourcesPanelTab) => void
  toggleDataSource: (id: string) => void
  setEnabledDataSources: (ids: string[]) => void
  setTheme: (theme: ThemeMode) => void
  setShowTechnicalReasoning: (on: boolean) => void
  applySourcePreset: (preset: SourcePresetId | null, enabledIds: string[]) => void
  fetchDataSources: (authToken?: string) => Promise<void>
  disableAuthRequiredSources: () => void
  setAvailableDataSources: (sources: DataSourceFromAPI[]) => void
  setKnowledgeLayerAvailable: (available: boolean) => void
  setVlmAvailable: (available: boolean) => void
  setDataSourcePanelTab: (tab: DataSourcesPanelTab) => void
}

export type LayoutStore = LayoutState & LayoutActions

export interface Session {
  id: string
  title: string
  date: Date
  hasActiveDeepResearch?: boolean
  hasCompletedReport?: boolean
  contentLocked?: boolean
  temporary?: boolean
  activity?: 'working' | 'waiting' | 'answered' | null
}
