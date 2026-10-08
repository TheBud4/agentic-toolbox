export type RouteTier = 'leve' | 'medio' | 'pesado' | 'maximo'
export type RouteModel = 'haiku' | 'sonnet' | 'opus' | 'fable'
export type RouteEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type RouteTarget = { model: RouteModel; effort: RouteEffort }
export type RouteMode = null | 'eco' | 'boost' | { force: RouteTier }
export type RouteSource = 'tag' | 'force' | 'sonnet' | 'classificador' | 'reserva'
export type RouteStats = {
  porNivel: Record<RouteTier, number>
  porFonte: Record<RouteSource | 'limite', number>
  fork: number
  foraDaTabela: number
}
export type LastRoute = {
  model: string
  effort: string
  tier: RouteTier | null
  reason: string
  description: string
}

declare module 'claude-code' {
  interface PluginState {
    'subagent-routing': {
      mode: RouteMode
      turnTag: RouteTier | null
      lastRoute: LastRoute | null
      sessionStats: RouteStats
    }
  }
}
