export function report(line: string): void {
  // oxlint-disable-next-line no-console -- info on stdout, the worker's log; warnings and errors use console.warn/error
  console.log(`[scheduling] ${line}`)
}
