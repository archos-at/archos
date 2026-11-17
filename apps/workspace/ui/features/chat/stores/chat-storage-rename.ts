const belongsTo = (key: string, name: string): boolean => key === name || key.startsWith(`${name}:`)

export function moveStoredChat(from: string, to: string): void {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key !== null && belongsTo(key, from)) keys.push(key)
  }
  if (keys.length === 0) return
  const moveTo = localStorage.getItem(`${to}:index`) === null
  const index = `${from}:index`
  for (const key of [...keys.filter((k) => k !== index), ...keys.filter((k) => k === index)]) {
    const value = localStorage.getItem(key)
    localStorage.removeItem(key)
    if (!moveTo || value === null) continue
    try {
      localStorage.setItem(`${to}${key.slice(from.length)}`, value)
    } catch {
      // Out of room: this key's messages are fetched again when the
    }
  }
}
