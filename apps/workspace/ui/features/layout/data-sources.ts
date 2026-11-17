export type DataSourceCategory = 'web' | 'enterprise' | 'storage' | 'collaboration'

export interface DataSource {
  id: string
  name: string
  description: string
  category: DataSourceCategory
  defaultEnabled: boolean
  requiresAuth: boolean
}
