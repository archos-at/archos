/** Presence: the shell's connection dot, and on whose behalf Piloti is present on a shared canvas. */
export const presence = {
  status: {
    connected: 'Connected',
    reconnecting: 'Connection interrupted',
    offline: 'No connection',
  },
  tooltip: {
    connected: 'You are connected. Everything is up to date.',
    reconnecting: 'The server is not answering right now. Retrying on its own.',
    offline: 'This device has no network. The page reconnects on its own once it is back.',
  },
  /**
   * Whose request Piloti is working on, wherever it is present (ADR-0105; EU AI
   * Act Art. 50). `{name}` is the person it acts for.
   */
  piloti: {
    /** The tooltip on Piloti's face in a presence stack. */
    onBehalfOf: '{productName} · for {name}',
    /** After the words on Piloti's cursor tag („Piloti“, „Treppe“), never clipped: „Treppe · für Anna“. */
    forSuffix: '· for {name}',
    /** What Piloti's cursor says while it reads a page or a box on it, after its name. */
    reading: 'reading page {page}',
  },
}
