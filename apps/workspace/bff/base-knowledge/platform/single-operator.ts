import 'server-only'

export function singleOperator(): boolean {
  return (process.env.KNOWLEDGE_SINGLE_OPERATOR ?? '').trim().toLowerCase() === 'true'
}
