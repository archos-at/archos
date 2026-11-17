declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string
  }
}

if (typeof window !== 'undefined') window.EXCALIDRAW_ASSET_PATH = '/excalidraw/'

export {}
