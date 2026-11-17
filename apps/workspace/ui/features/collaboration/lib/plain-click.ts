export function isPlainClick(event: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; button: number }): boolean {
  return !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) && event.button === 0
}
