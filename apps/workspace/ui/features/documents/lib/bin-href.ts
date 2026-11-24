export const BIN_PARAM = 'bin'

export function binHrefOf(filesHref: string): string {
  return `${filesHref}?${BIN_PARAM}=1`
}
