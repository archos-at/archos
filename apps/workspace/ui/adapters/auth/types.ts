export interface AuthState {
  isAuthenticated: boolean
  isLoading: boolean
  authRequired: boolean
  user: {
    id?: string
    email?: string | null
    name?: string | null
    image?: string | null
  } | null
  accessToken?: string
  idToken?: string
  organizationId?: string
  error?: string
}

export interface AuthActions {
  signIn: () => Promise<void>
  signOut: () => Promise<void>
  getAccessToken?: () => Promise<string | undefined>
}

export type AuthContext = AuthState & AuthActions
