export type Round = {
  startedAt: number
  endedAt: number | null
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  requests: number
  tools: number
  subagentTokens: number
}

export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type Meter = {
  limits: Limit[]
  contextPercent: number | null
  contextTokens: number | null
  contextWindow: number
}

export type Git = {
  branch: string
  ahead: number
  behind: number
  staged: number
  modified: number
  untracked: number
}

export type ModelInfo = { id: string; effort: string | null }

declare module 'claude-code' {
  interface PluginState {
    'usage-band': {
      round: Round | null
      meter: Meter | null
      now: number
      git: Git | null
      model: ModelInfo | null
    }
  }
}
