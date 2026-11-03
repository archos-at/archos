/** The scheduling tasks' info lines: what a sweep or a repair changed, on stdout as the scheduler logged them. */
export function report(line: string): void {
  // oxlint-disable-next-line no-console -- info on stdout, the worker's log; warnings and errors use console.warn/error
  console.log(`[scheduling] ${line}`)
}
