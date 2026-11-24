export { SearchWorkspace, type SearchWorkspaceProps } from './components/search-workspace'
export { SearchWorkspaceView, type SearchWorkspaceViewProps } from './components/search-workspace-view'
export { ShelfSearchBack } from './components/shelf-search-toggle'
export {
  PALETTE_ALL_RESULTS_VALUE,
  PALETTE_LATE_ANSWER_MS,
  PALETTE_LATE_HOLD_MS,
  PALETTE_RETRY_VALUE,
  PaletteSearchResults,
  PaletteRecentOpened,
  paletteFilter,
  isPaletteHitValue,
  paletteHitValue,
  paletteHitHref,
  paletteHits,
} from './components/palette-search'
export { usePaletteSearch, useRecentOpened } from './hooks/use-palette-search'
export { PaletteKinds, paletteKindQuery, type PaletteKind } from './components/palette-kinds'
export {
  ComposerSearchPicker,
  type ComposerSearchPickerAria,
  type ComposerSearchPickerHandle,
} from './components/composer-search-picker'
export { useDocumentReference } from './hooks/use-document-reference'
export { searchHref, searchPageHref } from './lib/search-hrefs'
export { useShelfSearchMode } from './hooks/use-shelf-search-mode'
export type { SearchSurface } from './lib/search-surface'
export { EMPTY_SEARCH_STATE, parseSearchParams, writeSearchParams, type SearchUrlState } from './lib/search-url'
