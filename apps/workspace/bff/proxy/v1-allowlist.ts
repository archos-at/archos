type Segment = string | ((segment: string) => boolean)

interface ProxyRoute {
  method: 'GET' | 'POST' | 'DELETE'
  shape: readonly Segment[]
}

const ANY: Segment = (segment) => segment.length > 0

const PROXY_ROUTES: readonly ProxyRoute[] = [
  { method: 'GET', shape: ['data_sources'] },
  { method: 'GET', shape: ['documents', ANY, 'status'] },
  { method: 'POST', shape: ['collections'] },
  { method: 'GET', shape: ['collections', ANY] },
  { method: 'GET', shape: ['collections', ANY, 'documents'] },
]

function matches(route: ProxyRoute, method: string, path: readonly string[]): boolean {
  if (route.method !== method || route.shape.length !== path.length) return false
  return route.shape.every((segment, index) =>
    typeof segment === 'string' ? segment === path[index] : segment(path[index])
  )
}

export function isForwardableV1Request(method: string, path: readonly string[]): boolean {
  const upper = method.toUpperCase()
  return PROXY_ROUTES.some((route) => matches(route, upper, path))
}
