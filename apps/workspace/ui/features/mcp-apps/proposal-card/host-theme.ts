import {
  applyDocumentTheme,
  applyHostStyleVariables,
  type McpUiHostContext,
  type McpUiStyleVariableKey,
} from '@modelcontextprotocol/ext-apps/react-with-deps'

export const HOST_TOKEN_MAP = {
  '--background': '--color-background-primary',
  '--card': '--color-background-primary',
  '--popover': '--color-background-primary',
  '--foreground': '--color-text-primary',
  '--card-foreground': '--color-text-primary',
  '--popover-foreground': '--color-text-primary',
  '--muted': '--color-background-secondary',
  '--secondary': '--color-background-secondary',
  '--accent': '--color-background-tertiary',
  '--muted-foreground': '--color-text-secondary',
  '--secondary-foreground': '--color-text-primary',
  '--accent-foreground': '--color-text-primary',
  '--primary': '--color-background-inverse',
  '--primary-foreground': '--color-text-inverse',
  '--destructive': '--color-text-danger',
  '--border': '--color-border-primary',
  '--input': '--color-border-secondary',
  '--ring': '--color-ring-primary',
  '--radius': '--border-radius-lg',
  '--text-color-subtle': '--color-text-tertiary',
  '--text-color-secondary': '--color-text-secondary',
  '--border-color-base': '--color-border-primary',
  '--background-color-surface-base': '--color-background-primary',
  '--background-color-surface-raised': '--color-background-secondary',
  '--background-color-surface-sunken': '--color-background-secondary',
} as const satisfies Record<`--${string}`, McpUiStyleVariableKey>

export type HostToken = keyof typeof HOST_TOKEN_MAP

export function hostTokenOverrides(variables: Readonly<Partial<Record<string, string | undefined>>>): Partial<Record<HostToken, string>> {
  const overrides: Partial<Record<HostToken, string>> = {}
  for (const [token, hostVariable] of Object.entries(HOST_TOKEN_MAP) as [HostToken, McpUiStyleVariableKey][]) {
    const given = variables[hostVariable]
    if (typeof given === 'string' && given.trim() !== '') overrides[token] = `var(${hostVariable})`
  }
  return overrides
}

export function applyHostTheme(context: McpUiHostContext | undefined, root: HTMLElement = document.documentElement): void {
  if (!context) return
  if (context.theme) {
    applyDocumentTheme(context.theme)
    root.classList.toggle('dark', context.theme === 'dark')
  }
  const styles = context.styles
  if (styles?.variables) {
    applyHostStyleVariables(styles.variables, root)
    const overrides = hostTokenOverrides(styles.variables)
    for (const token of Object.keys(HOST_TOKEN_MAP) as HostToken[]) {
      const value = overrides[token]
      if (value) root.style.setProperty(token, value)
      else root.style.removeProperty(token)
    }
  }
}
